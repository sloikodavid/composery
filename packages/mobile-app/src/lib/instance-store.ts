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
export function createInstanceStore(storage: Storage) {
	return {
		async loadAll(): Promise<Instance[]> {
			const raw = await storage.getItem(STORAGE_KEY);
			if (!raw) return [];
			try {
				const parsed = JSON.parse(raw) as unknown;
				return Array.isArray(parsed) ? (parsed as Instance[]) : [];
			} catch {
				return [];
			}
		},
		async persist(list: Instance[]): Promise<void> {
			await storage.setItem(STORAGE_KEY, JSON.stringify(list));
		}
	};
}
