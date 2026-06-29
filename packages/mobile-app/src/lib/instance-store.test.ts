import { describe, expect, test } from "vitest";

import {
	add,
	createInstanceStore,
	get,
	remove,
	touch,
	update,
	type Instance,
	type Storage
} from "./instance-store";

function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (key) => Promise.resolve(map.get(key) ?? null),
		setItem: (key, value) => {
			map.set(key, value);
			return Promise.resolve();
		}
	};
}

const fixedId = () => "abc";
const fixedNow = () => 1000;

describe("instance-store reducers", () => {
	test("add normalizes the URL and stamps id/createdAt", () => {
		const instance = add([], { url: "mybox.com" }, fixedId, fixedNow);
		expect(instance).toEqual({
			id: "abc",
			label: "",
			url: "https://mybox.com/",
			createdAt: 1000
		});
	});

	test("add leaves the label empty when omitted (no host backfill)", () => {
		const instance = add(
			[],
			{ url: "https://host:8443/code/" },
			fixedId,
			fixedNow
		);
		expect(instance.label).toBe("");
		expect(instance.url).toBe("https://host:8443/code/");
	});

	test("add uses a provided, trimmed label", () => {
		const instance = add(
			[],
			{ url: "mybox.com", label: "  My Box  " },
			fixedId,
			fixedNow
		);
		expect(instance.label).toBe("My Box");
	});

	test("add rejects an invalid URL", () => {
		expect(() => add([], { url: "ftp://x" }, fixedId, fixedNow)).toThrow();
		expect(() => add([], { url: "" }, fixedId, fixedNow)).toThrow();
	});

	test("add throws on a duplicate URL (after normalization)", () => {
		const list: Instance[] = [
			{ id: "x", label: "old", url: "https://mybox.com/", createdAt: 0 }
		];
		// `mybox.com` normalizes to the same href as the existing entry.
		expect(() =>
			add(list, { url: "https://MyBox.com/" }, fixedId, fixedNow)
		).toThrow();
	});

	test("add does not mutate the input list", () => {
		const list: Instance[] = [];
		add(list, { url: "mybox.com" }, fixedId, fixedNow);
		expect(list).toEqual([]);
	});

	test("remove drops the matching id and keeps the rest", () => {
		const list: Instance[] = [
			{ id: "a", label: "a", url: "https://a/", createdAt: 0 },
			{ id: "b", label: "b", url: "https://b/", createdAt: 0 }
		];
		expect(remove(list, "a")).toEqual([list[1]]);
		// Does not mutate.
		expect(list).toHaveLength(2);
		expect(remove(list, "missing")).toEqual(list);
	});

	test("touch sets lastOpenedAt on only the matching instance", () => {
		const list: Instance[] = [
			{ id: "a", label: "a", url: "https://a/", createdAt: 0 },
			{ id: "b", label: "b", url: "https://b/", createdAt: 0 }
		];
		const touched = touch(list, "b", () => 5000);
		expect(touched[0].lastOpenedAt).toBeUndefined();
		expect(touched[1].lastOpenedAt).toBe(5000);
		expect(list[1].lastOpenedAt).toBeUndefined();
	});

	test("get returns the instance or undefined", () => {
		const list: Instance[] = [
			{ id: "a", label: "a", url: "https://a/", createdAt: 0 }
		];
		expect(get(list, "a")?.url).toBe("https://a/");
		expect(get(list, "missing")).toBeUndefined();
	});

	test("update changes url + label, preserving createdAt/lastOpenedAt", () => {
		const list: Instance[] = [
			{
				id: "a",
				label: "old",
				url: "https://a/",
				createdAt: 1,
				lastOpenedAt: 9
			}
		];
		const next = update(list, "a", { url: "newbox.com", label: "  New  " });
		expect(next[0]).toEqual({
			id: "a",
			label: "New",
			url: "https://newbox.com/",
			createdAt: 1,
			lastOpenedAt: 9
		});
		// Does not mutate.
		expect(list[0].url).toBe("https://a/");
	});

	test("update rejects a URL already used by a different instance", () => {
		const list: Instance[] = [
			{ id: "a", label: "a", url: "https://a/", createdAt: 0 },
			{ id: "b", label: "b", url: "https://b/", createdAt: 0 }
		];
		expect(() => update(list, "a", { url: "https://b/" })).toThrow();
		// Re-saving an instance's own URL is allowed.
		expect(() => update(list, "a", { url: "https://a/" })).not.toThrow();
	});

	test("update rejects a missing id", () => {
		const list: Instance[] = [
			{ id: "a", label: "a", url: "https://a/", createdAt: 0 }
		];
		expect(() => update(list, "missing", { url: "https://b/" })).toThrow(
			"Instance not found: missing"
		);
	});
});

describe("instance-store adapter", () => {
	test("loadAll returns [] when nothing is persisted", async () => {
		const store = createInstanceStore(fakeStorage());
		expect(await store.loadAll()).toEqual([]);
	});

	test("persist then loadAll round-trips the list", async () => {
		const storage = fakeStorage();
		const store = createInstanceStore(storage);
		const list: Instance[] = [
			{ id: "a", label: "A", url: "https://a/", createdAt: 1, lastOpenedAt: 2 }
		];
		await store.persist(list);
		expect(await store.loadAll()).toEqual(list);
	});

	test("create prepends a normalized instance and persists it", async () => {
		const storage = fakeStorage();
		const store = createInstanceStore(storage, {
			id: fixedId,
			now: fixedNow
		});
		const existing: Instance = {
			id: "old",
			label: "Old",
			url: "https://old.com/",
			createdAt: 1
		};
		await store.persist([existing]);

		const instance = await store.create({
			url: "new.com",
			label: "  New  "
		});

		expect(instance).toEqual({
			id: "abc",
			label: "New",
			url: "https://new.com/",
			createdAt: 1000
		});
		expect(await store.loadAll()).toEqual([instance, existing]);
	});

	test("update persists changes through the store interface", async () => {
		const storage = fakeStorage();
		const store = createInstanceStore(storage);
		await store.persist([
			{
				id: "a",
				label: "Old",
				url: "https://old.com/",
				createdAt: 1,
				lastOpenedAt: 2
			}
		]);

		const instance = await store.update("a", {
			url: "new.com",
			label: "  New  "
		});

		expect(instance).toEqual({
			id: "a",
			label: "New",
			url: "https://new.com/",
			createdAt: 1,
			lastOpenedAt: 2
		});
		expect(await store.loadAll()).toEqual([instance]);
	});

	test("concurrent creates serialize instead of overwriting each other", async () => {
		const storage = fakeStorage();
		let count = 0;
		const store = createInstanceStore(storage, {
			id: () => `id-${++count}`,
			now: () => count
		});

		const [first, second] = await Promise.all([
			store.create({ url: "first.com" }),
			store.create({ url: "second.com" })
		]);

		expect(first.id).toBe("id-1");
		expect(second.id).toBe("id-2");
		expect(await store.loadAll()).toEqual([
			{
				id: "id-2",
				label: "",
				url: "https://second.com/",
				createdAt: 2
			},
			{
				id: "id-1",
				label: "",
				url: "https://first.com/",
				createdAt: 1
			}
		]);
	});

	test("a rejected write does not block later writes", async () => {
		const storage = fakeStorage();
		let count = 0;
		const store = createInstanceStore(storage, {
			id: () => `id-${++count}`,
			now: () => count
		});

		await store.create({ url: "first.com" });
		await expect(store.create({ url: "first.com" })).rejects.toThrow(
			"Instance already added: https://first.com/"
		);
		await store.create({ url: "second.com" });

		expect(await store.loadAll()).toEqual([
			{
				id: "id-2",
				label: "",
				url: "https://second.com/",
				createdAt: 2
			},
			{
				id: "id-1",
				label: "",
				url: "https://first.com/",
				createdAt: 1
			}
		]);
	});

	test("loadAll returns [] on corrupt JSON", async () => {
		const storage = fakeStorage();
		await storage.setItem("composery.instances", "{not json");
		const store = createInstanceStore(storage);
		expect(await store.loadAll()).toEqual([]);
	});

	test("loadAll returns [] on a non-array blob", async () => {
		const storage = fakeStorage();
		await storage.setItem(
			"composery.instances",
			JSON.stringify({ nope: true })
		);
		const store = createInstanceStore(storage);
		expect(await store.loadAll()).toEqual([]);
	});

	test("loadAll drops malformed rows and normalizes legacy URLs", async () => {
		const storage = fakeStorage();
		await storage.setItem(
			"composery.instances",
			JSON.stringify([
				{
					id: "a",
					label: "A",
					url: "mybox.com",
					createdAt: 1,
					lastOpenedAt: 2
				},
				{ id: "bad-url", label: "Bad", url: "ftp://example.com", createdAt: 3 },
				{ id: "missing-url", label: "Missing", createdAt: 4 },
				"not an instance"
			])
		);
		const store = createInstanceStore(storage);
		expect(await store.loadAll()).toEqual([
			{
				id: "a",
				label: "A",
				url: "https://mybox.com/",
				createdAt: 1,
				lastOpenedAt: 2
			}
		]);
	});

	test("loadAll keeps the first duplicate normalized URL", async () => {
		const storage = fakeStorage();
		await storage.setItem(
			"composery.instances",
			JSON.stringify([
				{ id: "a", label: "A", url: "https://mybox.com/", createdAt: 1 },
				{ id: "b", label: "B", url: "mybox.com", createdAt: 2 }
			])
		);
		const store = createInstanceStore(storage);
		expect(await store.loadAll()).toEqual([
			{ id: "a", label: "A", url: "https://mybox.com/", createdAt: 1 }
		]);
	});

	test("persist writes under the composery.instances key", async () => {
		const storage = fakeStorage();
		const store = createInstanceStore(storage);
		await store.persist([
			{ id: "a", label: "A", url: "https://a/", createdAt: 1 }
		]);
		const raw = await storage.getItem("composery.instances");
		expect(raw).toBe(
			'[{"id":"a","label":"A","url":"https://a/","createdAt":1}]'
		);
	});
});
