import {
	link,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout } from "node:timers/promises";
import { afterEach, describe, expect, test } from "vitest";
import { createPersistence } from "../rootfs/opt/agentbox/persistence/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
	);
	tempDirs.length = 0;
});

describe("persistence policy", () => {
	test("excludes volatile paths, control-plane paths, and volume path", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentbox-live-"));
		const volume = await mkdtemp(join(tmpdir(), "agentbox-volume-"));
		tempDirs.push(root, volume);
		const persistence = createPersistence({
			rootPath: root,
			volumePath: volume,
		});

		expect(persistence.shouldPersist(join(root, "proc/cpuinfo"))).toBe(false);
		expect(persistence.shouldPersist(join(root, "etc/supervisor/conf.d"))).toBe(
			false,
		);
		expect(
			persistence.shouldPersist(join(volume, "rootfs/files/etc/passwd")),
		).toBe(false);
		expect(persistence.shouldPersist(join(root, "custom-persist"))).toBe(true);
	});

	test("keeps selected image defaults user-persistable and excludes control-plane desktop entry", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentbox-live-"));
		const volume = await mkdtemp(join(tmpdir(), "agentbox-volume-"));
		tempDirs.push(root, volume);
		const persistence = createPersistence({
			rootPath: root,
			volumePath: volume,
		});

		expect(persistence.shouldPersist(join(root, "etc/sudoers.d/user"))).toBe(
			true,
		);
		expect(persistence.shouldPersist(join(root, "etc/mailcap"))).toBe(true);
		expect(persistence.shouldPersist(join(root, "etc/xdg/mimeapps.list"))).toBe(
			true,
		);
		expect(
			persistence.shouldPersist(
				join(root, "usr/share/applications/agentbox.desktop"),
			),
		).toBe(false);
	});

	test("rejects direct changes outside the configured root", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentbox-live-"));
		const volume = await mkdtemp(join(tmpdir(), "agentbox-volume-"));
		const sibling = `${root}-sibling`;
		tempDirs.push(root, volume, sibling);
		await mkdir(sibling, { recursive: true });
		const outsideFile = join(sibling, "file.txt");
		await writeFile(outsideFile, "outside");
		const persistence = createPersistence({
			rootPath: root,
			volumePath: volume,
		});

		await expect(
			persistence.record({ type: "present", livePath: outsideFile }),
		).rejects.toThrow("outside");
	});
});

describe("persistence", () => {
	test("records files and symlinks, then restores them", async () => {
		const { root, persistence, volume } = await createTempPersistence();
		const liveFile = join(root, "etc/config.txt");
		await mkdir(join(root, "etc"), { recursive: true });
		await writeFile(liveFile, "hello");
		await persistence.record({ type: "present", livePath: liveFile });

		const linkPath = join(root, "etc/link.txt");
		await symlink("config.txt", linkPath);
		await persistence.record({ type: "present", livePath: linkPath });

		const dangling = join(root, "etc/dangling.txt");
		await symlink("missing.txt", dangling);
		await persistence.record({ type: "present", livePath: dangling });

		await rm(join(root, "etc"), { recursive: true, force: true });
		await persistence.restore();

		expect(await readFile(join(root, "etc/config.txt"), "utf8")).toBe("hello");
		expect(await readlink(join(root, "etc/link.txt"))).toBe("config.txt");
		expect(await readlink(join(root, "etc/dangling.txt"))).toBe("missing.txt");
		expect(
			persistence.shouldPersist(join(volume, "rootfs/files/etc/config.txt")),
		).toBe(false);
	});

	test("migrates legacy rootfs-persistence storage into rootfs storage", async () => {
		const root = await mkdtemp(join(tmpdir(), "agentbox-live-"));
		const volume = await mkdtemp(join(tmpdir(), "agentbox-volume-"));
		tempDirs.push(root, volume);
		const legacyFile = join(volume, "rootfs-persistence/files/etc/legacy.txt");
		await mkdir(join(volume, "rootfs-persistence/files/etc"), {
			recursive: true,
		});
		await writeFile(legacyFile, "legacy");
		const persistence = createPersistence({
			rootPath: root,
			volumePath: volume,
		});

		await persistence.restore();

		expect(await readFile(join(root, "etc/legacy.txt"), "utf8")).toBe("legacy");
		expect(
			await readFile(join(volume, "rootfs/files/etc/legacy.txt"), "utf8"),
		).toBe("legacy");
	});

	test("records removals, then applies them on restore", async () => {
		const { root, persistence } = await createTempPersistence();
		const liveFile = join(root, "removed.txt");
		await writeFile(liveFile, "persisted");
		await persistence.record({ type: "present", livePath: liveFile });

		await rm(liveFile);
		await persistence.record({ type: "removed", livePath: liveFile });
		await writeFile(liveFile, "stale image content");

		await persistence.restore();

		await expect(readFile(liveFile, "utf8")).rejects.toThrow();
	});

	test("keeps a descendant that returns after an ancestor was removed", async () => {
		const { root, persistence } = await createTempPersistence();
		const parent = join(root, "opt/app");
		const child = join(parent, "config.json");

		await mkdir(parent, { recursive: true });
		await writeFile(child, "old");
		await persistence.record({ type: "present", livePath: child });

		await rm(join(root, "opt"), { recursive: true });
		await persistence.record({
			type: "removed",
			livePath: join(root, "opt"),
		});

		await mkdir(parent, { recursive: true });
		await writeFile(child, "{}\n");
		await persistence.record({ type: "present", livePath: child });

		await rm(join(root, "opt"), { recursive: true });
		await persistence.restore();

		expect(await readFile(child, "utf8")).toBe("{}\n");
	});

	test("preserves hardlinks within one persistence instance", async () => {
		const { root, persistence } = await createTempPersistence();
		const first = join(root, "first.txt");
		const second = join(root, "second.txt");
		await writeFile(first, "linked");
		await link(first, second);

		await persistence.record({ type: "present", livePath: first });
		await persistence.record({ type: "present", livePath: second });
		await rm(first);
		await rm(second);

		await persistence.restore();

		const firstStats = await stat(first);
		const secondStats = await stat(second);
		expect(firstStats.ino).toBe(secondStats.ino);
		expect(await readFile(second, "utf8")).toBe("linked");
	});

	test("watches later changes under user-created root directories", async () => {
		const { root, persistence, volume } = await createTempPersistence();
		const mirror = await mkdtemp(join(tmpdir(), "agentbox-mirror-"));
		tempDirs.push(mirror);
		const mirrorPersistence = createPersistence({
			rootPath: mirror,
			volumePath: volume,
		});
		const watcher = await persistence.watch();
		try {
			expect(watcher.status().watcherCount).toBeGreaterThan(0);
			const customDirectory = join(root, "foo123");
			const nestedFile = join(customDirectory, "nested.txt");
			const mirrorFile = join(mirror, "foo123/nested.txt");

			await mkdir(customDirectory);
			await writeFile(nestedFile, "first");
			await waitForRestoredFileContent(mirrorPersistence, mirrorFile, "first");

			await writeFile(nestedFile, "changed");
			await waitForRestoredFileContent(
				mirrorPersistence,
				mirrorFile,
				"changed",
			);

			await rm(nestedFile);
			await waitForRestoredPathRemoval(mirrorPersistence, mirrorFile);
		} finally {
			await watcher.stop();
		}
	});
});

async function createTempPersistence(): Promise<{
	readonly root: string;
	readonly volume: string;
	readonly persistence: ReturnType<typeof createPersistence>;
}> {
	const root = await mkdtemp(join(tmpdir(), "agentbox-live-"));
	const volume = await mkdtemp(join(tmpdir(), "agentbox-volume-"));
	tempDirs.push(root, volume);
	return {
		root,
		volume,
		persistence: createPersistence({
			rootPath: root,
			volumePath: volume,
			heartbeatPath: join(volume, "persistence.ready"),
		}),
	};
}

async function waitForRestoredFileContent(
	persistence: ReturnType<typeof createPersistence>,
	path: string,
	expected: string,
): Promise<void> {
	await waitFor(async () => {
		await persistence.restore();
		return (await readFile(path, "utf8")) === expected;
	});
}

async function waitForRestoredPathRemoval(
	persistence: ReturnType<typeof createPersistence>,
	path: string,
): Promise<void> {
	await waitFor(async () => {
		await persistence.restore();
		try {
			await readFile(path);
			return false;
		} catch {
			return true;
		}
	});
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			if (await check()) {
				return;
			}
		} catch (error) {
			lastError = error;
		}
		await setTimeout(100);
	}
	throw new Error(`timed out waiting for condition: ${String(lastError)}`);
}
