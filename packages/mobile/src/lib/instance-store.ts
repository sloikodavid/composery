// The instance list: pure reducers (id/now injected, so tests are deterministic)
// plus a thin adapter over an injected Storage port. Holds only URLs and labels,
// no secrets — the session cookie lives in the WebView's own cookie store — so
// plain AsyncStorage is correct (PLAN.md: no expo-secure-store in v1).
import { normalizeInstanceUrl } from "./normalize-url";
import { createId } from "./id";

export type Instance = {
	id: string;
	label: string;
	url: string;
	createdAt: number;
	lastOpenedAt?: number;
};

export type InstanceInput = {
	url: string;
	label?: string;
};

// AsyncStorage-shaped port, so this module has no React Native imports.
export type Storage = {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
};

export type InstanceStoreOptions = {
	id?: () => string;
	now?: () => number;
};

const STORAGE_KEY = "composery.instances";

// Normalizes the URL (throws on invalid/duplicate). The label is never
// backfilled from the host, so an unlabeled instance shows its URL as identity
// and the two can't drift. Caller prepends the result and persists.
export function add(
	list: Instance[],
	input: InstanceInput,
	id: () => string = createId,
	now: () => number = Date.now
): Instance {
	const url = normalizeInstanceUrl(input.url).href;
	if (list.some((instance) => instance.url === url)) {
		throw new Error(`Instance already added: ${url}`);
	}
	return { id: id(), label: input.label?.trim() ?? "", url, createdAt: now() };
}

// Re-normalizes the URL and rejects one already used by a *different* instance;
// preserves createdAt/lastOpenedAt.
export function update(
	list: Instance[],
	id: string,
	input: InstanceInput
): Instance[] {
	if (!list.some((instance) => instance.id === id)) {
		throw new Error(`Instance not found: ${id}`);
	}
	const url = normalizeInstanceUrl(input.url).href;
	if (list.some((instance) => instance.id !== id && instance.url === url)) {
		throw new Error(`Instance already added: ${url}`);
	}
	const label = input.label?.trim() ?? "";
	return list.map((instance) =>
		instance.id === id ? { ...instance, url, label } : instance
	);
}

export function remove(list: Instance[], id: string): Instance[] {
	return list.filter((instance) => instance.id !== id);
}

export function touch(
	list: Instance[],
	id: string,
	now: () => number = Date.now
): Instance[] {
	return list.map((instance) =>
		instance.id === id ? { ...instance, lastOpenedAt: now() } : instance
	);
}

export function get(list: Instance[], id: string): Instance | undefined {
	return list.find((instance) => instance.id === id);
}

// JSON adapter over the Storage port; loadAll tolerates a missing/corrupt blob.
export function createInstanceStore(
	storage: Storage,
	options: InstanceStoreOptions = {}
) {
	const id = options.id ?? createId;
	const now = options.now ?? Date.now;
	const addToList = add;
	const updateList = update;
	const removeFromList = remove;
	const touchList = touch;
	let writeQueue: Promise<void> = Promise.resolve();

	async function readAll(): Promise<Instance[]> {
		const raw = await storage.getItem(STORAGE_KEY);
		if (!raw) return [];
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) return [];
			const urls = new Set<string>();
			const instances: Instance[] = [];
			for (const item of parsed) {
				if (!item || typeof item !== "object") continue;
				const record = item as Record<string, unknown>;
				if (typeof record.id !== "string" || !record.id) continue;
				if (typeof record.url !== "string") continue;
				let url: string;
				try {
					url = normalizeInstanceUrl(record.url).href;
				} catch {
					continue;
				}
				if (urls.has(url)) continue;
				urls.add(url);
				const instance: Instance = {
					id: record.id,
					label: typeof record.label === "string" ? record.label : "",
					url,
					createdAt:
						typeof record.createdAt === "number" &&
						Number.isFinite(record.createdAt)
							? record.createdAt
							: 0
				};
				if (
					typeof record.lastOpenedAt === "number" &&
					Number.isFinite(record.lastOpenedAt)
				) {
					instance.lastOpenedAt = record.lastOpenedAt;
				}
				instances.push(instance);
			}
			return instances;
		} catch {
			return [];
		}
	}

	async function writeAll(list: Instance[]): Promise<void> {
		await storage.setItem(STORAGE_KEY, JSON.stringify(list));
	}

	function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
		const run = writeQueue.then(operation, operation);
		writeQueue = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	async function mutate<T>(
		operation: (list: Instance[]) => { next: Instance[]; value: T }
	): Promise<T> {
		return enqueueWrite(async () => {
			const list = await readAll();
			const { next, value } = operation(list);
			await writeAll(next);
			return value;
		});
	}

	return {
		async loadAll(): Promise<Instance[]> {
			await writeQueue;
			return readAll();
		},
		async persist(list: Instance[]): Promise<void> {
			await enqueueWrite(() => writeAll(list));
		},
		async get(id: string): Promise<Instance | undefined> {
			await writeQueue;
			return get(await readAll(), id);
		},
		async create(input: InstanceInput): Promise<Instance> {
			return mutate((list) => {
				const instance = addToList(list, input, id, now);
				return { next: [instance, ...list], value: instance };
			});
		},
		async update(id: string, input: InstanceInput): Promise<Instance> {
			return mutate((list) => {
				const next = updateList(list, id, input);
				const instance = get(next, id);
				if (!instance) throw new Error(`Instance not found: ${id}`);
				return { next, value: instance };
			});
		},
		async remove(id: string): Promise<Instance[]> {
			return mutate((list) => {
				const next = removeFromList(list, id);
				return { next, value: next };
			});
		},
		async touch(id: string): Promise<Instance[]> {
			return mutate((list) => {
				const next = touchList(list, id, now);
				return { next, value: next };
			});
		}
	};
}
