/**
 * The instance list: pure reducers plus a thin AsyncStorage adapter.
 *
 * Pure: no React Native imports, so the reducers and the adapter run in Vitest
 * in plain Node. The AsyncStorage backend is injected as a `Storage` port —
 * production passes @react-native-async-storage/async-storage, tests pass an
 * in-memory fake. `id` and `now` are injected too, so reducers are deterministic
 * in tests.
 *
 * The store holds only URLs and labels — no secrets. Composery's session cookie
 * lives inside the WebView's own cookie store; the app never touches it. So
 * unencrypted AsyncStorage is correct here (PLAN.md: no expo-secure-store in v1).
 */
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

/**
 * AsyncStorage-shaped port. The adapter takes this so this module has no React
 * Native imports.
 */
export type Storage = {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
};

const STORAGE_KEY = "composery.instances";

/**
 * Builds a default label from the instance's host (with port), used when the
 * user does not supply one.
 */
function hostLabel(url: string): string {
	return new URL(url).host;
}

/**
 * Creates a new Instance from raw input. Normalizes the URL (throwing on
 * invalid), derives a label from the host when none is given, and throws if the
 * normalized URL is already in `list`. Returns the new instance — the caller
 * prepends it to the list and persists.
 */
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
	const label = input.label?.trim() || hostLabel(url);
	return { id: id(), label, url, createdAt: now() };
}

/** Returns a new list without the instance with the given id. */
export function remove(list: Instance[], id: string): Instance[] {
	return list.filter((instance) => instance.id !== id);
}

/** Returns a new list with `lastOpenedAt` updated on the matching instance. */
export function touch(
	list: Instance[],
	id: string,
	now: () => number = Date.now
): Instance[] {
	return list.map((instance) =>
		instance.id === id ? { ...instance, lastOpenedAt: now() } : instance
	);
}

/** Returns the instance with the given id, or undefined. */
export function get(list: Instance[], id: string): Instance | undefined {
	return list.find((instance) => instance.id === id);
}

/**
 * Thin persistence adapter over the injected `Storage` port. JSON-serializes the
 * list under the `composery.instances` key. `loadAll` tolerates a missing or
 * corrupt blob (returns []).
 */
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
