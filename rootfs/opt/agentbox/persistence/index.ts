import { spawn } from "node:child_process";
import { link, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PERSISTENCE_HEARTBEAT_PATH } from "./constants.ts";
export {
	PERSISTENCE_EVENT_BATCH_WINDOW_MS,
	PERSISTENCE_HEARTBEAT_INTERVAL_MS,
	PERSISTENCE_HEARTBEAT_MAX_AGE_MS,
	PERSISTENCE_HEARTBEAT_PATH,
	PERSISTENCE_RECONCILE_INTERVAL_MS,
} from "./constants.ts";
import {
	copyFileConsistently,
	copyMetadata,
	copyPersistedRoot,
	isStoredFile,
} from "./copy.ts";
import {
	applyRemovalMarkers,
	isExcludedPath,
	isWithinRoot,
	markRemoved,
	prepareRootfsStorage,
	removeStoredPath,
	rootfsPaths,
	storedPathForLivePath,
	type RootfsPaths,
	unmarkRemoved,
} from "./rootfs.ts";
import type {
	Persistence,
	PersistenceChange,
	PersistenceOptions,
	PersistenceWatcher,
} from "./types.ts";
export type {
	Persistence,
	PersistenceChange,
	PersistenceHeartbeat,
	PersistenceOptions,
	PersistenceWatcher,
	PersistenceWatcherFailure,
} from "./types.ts";
import { runPersistenceWatch } from "./watch.ts";

class PersistenceImpl implements Persistence {
	private readonly paths: RootfsPaths;
	private readonly heartbeatPath: string;
	private readonly hardlinks = new Map<string, string>();

	constructor(options: PersistenceOptions = {}) {
		this.paths = rootfsPaths(options);
		this.heartbeatPath = options.heartbeatPath ?? PERSISTENCE_HEARTBEAT_PATH;
	}

	async restore(): Promise<void> {
		await prepareRootfsStorage(this.paths);
		await run("rsync", [
			"-a",
			"-H",
			"--numeric-ids",
			`${this.paths.filesPath}/`,
			this.paths.rootPath,
		]).catch(async (error: unknown) => {
			if (String(error).includes("ENOENT")) {
				await copyPersistedRoot(this.paths.filesPath, this.paths.rootPath);
				return;
			}
			throw error;
		});
		await applyRemovalMarkers(this.paths);
	}

	async record(change: PersistenceChange): Promise<void> {
		this.requireInsideRoot(change.livePath);
		if (!this.shouldPersist(change.livePath)) {
			return;
		}
		await prepareRootfsStorage(this.paths);
		if (change.type === "present") {
			await this.store(change.livePath);
		} else {
			await this.remove(change.livePath);
		}
	}

	async watch(): Promise<PersistenceWatcher> {
		await prepareRootfsStorage(this.paths);
		return await runPersistenceWatch({
			paths: this.paths,
			heartbeatPath: this.heartbeatPath,
			record: (change) => this.record(change),
			shouldPersist: (livePath) => this.shouldPersist(livePath),
			log,
		});
	}

	shouldPersist(livePath: string): boolean {
		return (
			isWithinRoot(livePath, resolve(this.paths.rootPath)) &&
			!isExcludedPath(livePath, this.paths)
		);
	}

	private requireInsideRoot(livePath: string): void {
		if (!isWithinRoot(livePath, resolve(this.paths.rootPath))) {
			throw new Error(`${livePath} is outside ${this.paths.rootPath}`);
		}
	}

	private async store(livePath: string): Promise<void> {
		const stats = await lstat(livePath);
		if (
			stats.isSocket() ||
			stats.isFIFO() ||
			stats.isBlockDevice() ||
			stats.isCharacterDevice()
		) {
			return;
		}

		await this.storeAncestorMetadata(livePath);
		const storedPath = storedPathForLivePath(livePath, this.paths);
		await rm(storedPath, { recursive: true, force: true });
		await mkdir(dirname(storedPath), { recursive: true });

		if (stats.isSymbolicLink()) {
			await symlink(await readlink(livePath), storedPath);
		} else if (stats.isDirectory()) {
			await mkdir(storedPath, { recursive: true, mode: stats.mode });
			await copyMetadata(livePath, storedPath);
		} else if (stats.isFile()) {
			const hardlinkKey = `${stats.dev}:${stats.ino}`;
			const existingHardlink = this.hardlinks.get(hardlinkKey);
			if (
				stats.nlink > 1 &&
				existingHardlink &&
				existingHardlink !== storedPath &&
				(await isStoredFile(existingHardlink))
			) {
				await link(existingHardlink, storedPath);
			} else {
				await copyFileConsistently(livePath, storedPath);
				if (stats.nlink > 1) {
					this.hardlinks.set(hardlinkKey, storedPath);
				}
			}
			await copyMetadata(livePath, storedPath);
		}

		await unmarkRemoved(livePath, this.paths);
	}

	private async remove(livePath: string): Promise<void> {
		await removeStoredPath(livePath, this.paths);
		await markRemoved(livePath, this.paths);
	}

	private async storeAncestorMetadata(livePath: string): Promise<void> {
		let current = dirname(resolve(livePath));
		const root = resolve(this.paths.rootPath);
		const ancestors: string[] = [];
		while (current !== root && isWithinRoot(current, root)) {
			ancestors.push(current);
			current = dirname(current);
		}
		for (const ancestor of ancestors.reverse()) {
			await this.storeOnePath(ancestor);
		}
	}

	private async storeOnePath(livePath: string): Promise<void> {
		const stats = await lstat(livePath);
		if (!stats.isDirectory()) {
			return;
		}
		const storedPath = storedPathForLivePath(livePath, this.paths);
		await mkdir(storedPath, { recursive: true, mode: stats.mode });
		await copyMetadata(livePath, storedPath);
	}
}

export function createPersistence(
	options: PersistenceOptions = {},
): Persistence {
	return new PersistenceImpl(options);
}

async function run(command: string, args: readonly string[]): Promise<void> {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.on("exit", (code) => {
			if (code === 0) {
				resolvePromise();
			} else {
				rejectPromise(new Error(`${command} exited with ${code ?? "unknown"}`));
			}
		});
		child.on("error", rejectPromise);
	});
}

export async function runPersistenceCommand(
	args: readonly string[] = process.argv.slice(2),
): Promise<void> {
	const flag = args.length === 1 ? args[0] : undefined;
	const persistence = createPersistence();
	if (flag === "--restore" || flag === "-r") {
		await persistence.restore().catch((error: unknown) => {
			log(`restore failed: ${String(error)}`);
			process.exit(1);
		});
		return;
	}
	if (flag === "--watch" || flag === "-w") {
		await persistence.watch().catch((error: unknown) => {
			log(`watch failed: ${String(error)}`);
			process.exit(1);
		});
		return;
	}
	console.error(
		"usage: node /opt/agentbox/persistence/index.ts --restore|-r | --watch|-w",
	);
	process.exit(64);
}

function log(message: string): void {
	console.log(`[agentbox-persistence] ${message}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await runPersistenceCommand();
}
