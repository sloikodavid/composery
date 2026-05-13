import {
	lstat,
	mkdir,
	readdir,
	rename,
	writeFile,
	watch,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	QueuedPersistenceEvent,
	PersistenceChange,
	PersistenceHeartbeat,
	PersistenceWatcher,
	PersistenceWatcherFailure,
} from "./types.ts";
import type { RootfsPaths } from "./rootfs.ts";
import { isTopLevelEntry } from "./rootfs.ts";
import { walk } from "./copy.ts";
import {
	PERSISTENCE_EVENT_BATCH_WINDOW_MS,
	PERSISTENCE_HEARTBEAT_INTERVAL_MS,
	PERSISTENCE_RECONCILE_INTERVAL_MS,
} from "./constants.ts";

interface ActiveWatcher {
	readonly controller: AbortController;
	closing: boolean;
}

export async function runPersistenceWatch(options: {
	readonly paths: RootfsPaths;
	readonly heartbeatPath: string;
	readonly record: (change: PersistenceChange) => Promise<void>;
	readonly shouldPersist: (livePath: string) => boolean;
	readonly log: (message: string) => void;
}): Promise<PersistenceWatcher> {
	const paths = options.paths;
	const queue = new Map<string, QueuedPersistenceEvent>();
	const topLevelWatchers = new Map<string, ActiveWatcher>();
	const watcherFailures: PersistenceWatcherFailure[] = [];
	let rootWatcher: ActiveWatcher | undefined;
	let timer: NodeJS.Timeout | undefined;
	let heartbeatTimer: NodeJS.Timeout | undefined;
	let rootReconcileTimer: NodeJS.Timeout | undefined;
	let flushing: Promise<void> = Promise.resolve();
	let rootEntrySnapshot = new Set<string>();
	let stopping = false;
	let heartbeatWriteId = 0;
	let lastHeartbeat: PersistenceHeartbeat = {
		updatedAt: new Date(0).toISOString(),
		watcherCount: 0,
		failedWatchers: [],
	};

	await mkdir(paths.filesPath, { recursive: true });
	await mkdir(paths.removedFilesPath, { recursive: true });
	await mkdir(dirname(options.heartbeatPath), { recursive: true });

	const beat = async (): Promise<void> => {
		lastHeartbeat = {
			updatedAt: new Date().toISOString(),
			watcherCount: (rootWatcher ? 1 : 0) + topLevelWatchers.size,
			failedWatchers: [...watcherFailures],
		};
		const tempPath = `${options.heartbeatPath}.${process.pid}.${heartbeatWriteId++}.tmp`;
		await writeFile(tempPath, `${JSON.stringify(lastHeartbeat)}\n`);
		await rename(tempPath, options.heartbeatPath);
	};

	const recordWatchFailure = (livePath: string, error: unknown): void => {
		const message = String(error);
		if (
			!watcherFailures.some(
				(failure) => failure.path === livePath && failure.message === message,
			)
		) {
			watcherFailures.push({ path: livePath, message });
		}
		options.log(`watch failed for ${livePath}: ${message}`);
	};

	const recordSafely = async (event: QueuedPersistenceEvent): Promise<void> => {
		try {
			await options.record(event);
		} catch (error) {
			recordWatchFailure(event.livePath, error);
		}
	};

	const flushQueuedEvents = async (): Promise<void> => {
		const events = [...queue.values()];
		queue.clear();
		const removals = events.filter((event) => event.type === "removed");
		const stores = events.filter((event) => event.type === "present");
		for (const event of removals) {
			await recordSafely(event);
		}
		for (const event of stores) {
			await recordSafely(event);
		}
		await beat();
	};

	const flush = async (): Promise<void> => {
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
		const run = flushing.then(flushQueuedEvents, flushQueuedEvents);
		flushing = run.catch(() => {});
		await run;
	};

	const schedule = (event: QueuedPersistenceEvent): void => {
		if (stopping || !options.shouldPersist(event.livePath)) {
			return;
		}
		queue.set(event.livePath, event);
		timer ??= setTimeout(() => {
			flush().catch((error: unknown) =>
				options.log(`flush failed: ${String(error)}`),
			);
		}, PERSISTENCE_EVENT_BATCH_WINDOW_MS);
	};

	const queueRecursiveContentsSafely = async (
		livePath: string,
	): Promise<void> => {
		try {
			await queueRecursiveContents(livePath, schedule);
		} catch (error) {
			recordWatchFailure(livePath, error);
		}
	};

	const watchDirectory = (
		livePath: string,
		recursive: boolean,
	): ActiveWatcher | undefined => {
		if (
			resolve(livePath) !== resolve(paths.rootPath) &&
			!options.shouldPersist(livePath)
		) {
			return undefined;
		}
		try {
			const controller = new AbortController();
			const activeWatcher: ActiveWatcher = { controller, closing: false };
			const watcher = watch(livePath, {
				recursive,
				signal: controller.signal,
			});
			void (async () => {
				for await (const event of watcher) {
					if (!event.filename) {
						continue;
					}
					const changedPath = resolve(livePath, event.filename.toString());
					try {
						const stats = await lstat(changedPath);
						schedule({ livePath: changedPath, type: "present" });
						if (stats.isDirectory()) {
							if (isTopLevelEntry(changedPath, paths)) {
								watchTopLevelDirectory(changedPath);
							}
							await queueRecursiveContentsSafely(changedPath);
						}
					} catch {
						schedule({ livePath: changedPath, type: "removed" });
						if (isTopLevelEntry(changedPath, paths)) {
							disposeTopLevelWatcher(changedPath);
						}
					}
				}
			})().catch((error: unknown) => {
				if (!stopping && !activeWatcher.closing) {
					recordWatchFailure(livePath, error);
				}
			});
			return activeWatcher;
		} catch (error) {
			recordWatchFailure(livePath, error);
			return undefined;
		}
	};

	const watchTopLevelDirectory = (livePath: string): void => {
		const path = resolve(livePath);
		if (topLevelWatchers.has(path) || !options.shouldPersist(path)) {
			return;
		}
		const watcher = watchDirectory(path, true);
		if (watcher) {
			topLevelWatchers.set(path, watcher);
		}
	};

	const disposeTopLevelWatcher = (livePath: string): void => {
		const path = resolve(livePath);
		const watcher = topLevelWatchers.get(path);
		if (!watcher) {
			return;
		}
		topLevelWatchers.delete(path);
		watcher.closing = true;
		watcher.controller.abort();
	};

	const reconcileRootEntries = async (
		mode: "initial" | "changes",
	): Promise<void> => {
		const currentEntries = new Set<string>();
		for (const entry of await readdir(paths.rootPath)) {
			const livePath = resolve(paths.rootPath, entry);
			if (!options.shouldPersist(livePath)) {
				continue;
			}
			currentEntries.add(livePath);
			if (mode === "changes" && rootEntrySnapshot.has(livePath)) {
				continue;
			}
			try {
				const stats = await lstat(livePath);
				schedule({ livePath, type: "present" });
				if (stats.isDirectory()) {
					watchTopLevelDirectory(livePath);
					await queueRecursiveContentsSafely(livePath);
				}
			} catch {
				schedule({ livePath, type: "removed" });
				disposeTopLevelWatcher(livePath);
			}
		}
		for (const livePath of rootEntrySnapshot) {
			if (!currentEntries.has(livePath)) {
				schedule({ livePath, type: "removed" });
				disposeTopLevelWatcher(livePath);
			}
		}
		rootEntrySnapshot = currentEntries;
	};

	const stop = async (): Promise<void> => {
		stopping = true;
		process.off("SIGTERM", handleSigterm);
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}
		if (rootReconcileTimer) {
			clearInterval(rootReconcileTimer);
			rootReconcileTimer = undefined;
		}
		const watchers = [
			...(rootWatcher ? [rootWatcher] : []),
			...topLevelWatchers.values(),
		];
		rootWatcher = undefined;
		topLevelWatchers.clear();
		for (const watcher of watchers) {
			watcher.closing = true;
			watcher.controller.abort();
		}
		await flush();
	};

	const handleSigterm = (): void => {
		stop()
			.then(() => process.exit(0))
			.catch(() => process.exit(1));
	};

	rootWatcher = watchDirectory(paths.rootPath, false);
	await reconcileRootEntries("initial");
	rootReconcileTimer = setInterval(() => {
		reconcileRootEntries("changes").catch((error: unknown) =>
			options.log(`root reconcile failed: ${String(error)}`),
		);
	}, PERSISTENCE_RECONCILE_INTERVAL_MS);
	rootReconcileTimer.unref();

	await beat();
	heartbeatTimer = setInterval(() => {
		beat().catch((error: unknown) =>
			options.log(`heartbeat update failed: ${String(error)}`),
		);
	}, PERSISTENCE_HEARTBEAT_INTERVAL_MS);
	heartbeatTimer.unref();

	process.once("SIGTERM", handleSigterm);

	return {
		stop,
		status: () => lastHeartbeat,
	};
}

async function queueRecursiveContents(
	livePath: string,
	schedule: (event: QueuedPersistenceEvent) => void,
): Promise<void> {
	await walk(livePath, (path) => schedule({ livePath: path, type: "present" }));
}
