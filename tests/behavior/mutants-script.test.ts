import { afterEach, describe, expect, test, vi } from "vitest";

// `check:mutants` is the load-bearing check in this repository - the only one a
// test that merely runs cannot satisfy - so the way it fails matters as much as
// the way it passes. Reporting a Rust pass on a machine without cargo-mutants
// would be the exact shape of failure the script exists to prevent: green
// because nothing ran.
//
// The script has no exported entry point, so this drives it the way
// setup.test.ts drives setup.mjs - every side effect mocked, then imported.

const host = vi.hoisted(() => ({
	// `git <args>` -> stdout. Anything unlisted returns a failure, which is what
	// the real script sees for a ref that does not exist.
	git: new Map<string, string>(),
	cargoInstalled: true,
	// What the mutation config's globs resolve to in the checkout.
	mutable: [] as string[],
	spawns: [] as string[],
	exits: [] as number[],
	errors: [] as string[],
	writes: [] as { path: string; contents: string }[]
}));

vi.mock("node:child_process", () => ({
	spawnSync: (command: string, args: string[]) => {
		host.spawns.push([command, ...args].join(" "));
		if (command === "git") {
			const stdout = host.git.get(args.join(" "));
			return stdout === undefined ? { status: 1 } : { status: 0, stdout };
		}
		if (command === "cargo" && args[0] === "mutants") {
			return { status: host.cargoInstalled ? 0 : 1 };
		}
		return { status: 0 };
	}
}));

vi.mock("node:fs", () => ({
	mkdirSync: () => undefined,
	writeFileSync: (path: string, contents: string) =>
		host.writes.push({ path: String(path), contents: String(contents) }),
	readFileSync: () =>
		JSON.stringify({
			mutate: ["packages/web/convex/**/*.ts", "!**/_generated/**"],
			thresholds: { high: 80, low: 60, break: 0 }
		}),
	// A glob is Node's to resolve. What this file constrains is the step after:
	// which of the changed files the run is allowed to mutate.
	globSync: () => host.mutable
}));

function arrange(changed: string[]) {
	host.git.clear();
	host.git.set("merge-base origin/main HEAD", "abc1234def\n");
	host.git.set(
		"diff --name-only --diff-filter=d abc1234def",
		`${changed.join("\n")}\n`
	);
	host.git.set("diff abc1234def -- packages/cli", "a diff\n");
	host.spawns = [];
	host.exits = [];
	host.errors = [];
	host.writes = [];

	vi.spyOn(console, "error").mockImplementation((message: unknown) => {
		host.errors.push(String(message));
	});
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
		host.exits.push(code ?? 0);
		// The real script stops here; the mock has to as well, or the lines after
		// the guard run and the test asserts about a state that cannot happen.
		throw new Exited();
	}) as never);
}

afterEach(() => {
	vi.restoreAllMocks();
});

// A distinct type rather than a message string: catching by message would also
// swallow a genuine failure that happened to say "exit".
class Exited extends Error {}

async function runScript() {
	vi.resetModules();
	try {
		// @ts-expect-error The behavior-tested JavaScript entry point has no declaration file.
		await import("../../scripts/mutants.mjs");
	} catch (error) {
		if (!(error instanceof Exited)) throw error;
	}
}

describe("check:mutants", () => {
	test("refuses to report a Rust pass when cargo-mutants is missing", async () => {
		host.cargoInstalled = false;
		arrange(["packages/cli/crates/persistence/src/apply.rs"]);

		await runScript();

		expect(host.exits).toEqual([1]);
		expect(host.errors.join("\n")).toContain("cargo-mutants is not installed");
		// The point of the guard: it must not have gone on to claim a result.
		expect(
			host.spawns.some((call) =>
				call.startsWith("cargo mutants --manifest-path")
			)
		).toBe(false);
	});

	test("runs cargo-mutants over the changed Rust when it is installed", async () => {
		host.cargoInstalled = true;
		arrange(["packages/cli/crates/persistence/src/apply.rs"]);

		await runScript();

		expect(host.exits).toEqual([]);
		expect(
			host.spawns.some((call) =>
				call.startsWith("cargo mutants --manifest-path")
			)
		).toBe(true);
		// Scoped to the diff, which is what keeps a per-change run affordable.
		expect(host.spawns.join("\n")).toContain("--in-diff");
	});

	test("mutates no Rust when the change touches none", async () => {
		host.cargoInstalled = true;
		arrange(["docs/configuration.md"]);

		await runScript();

		expect(host.spawns.some((call) => call.startsWith("cargo"))).toBe(false);
		expect(host.exits).toEqual([]);
	});

	test("mutates only the changed files the mutation config already claims", async () => {
		host.mutable = ["packages/web/convex/boxes/operation/record.ts"];
		arrange([
			"packages/web/convex/boxes/operation/record.ts",
			// Real source, changed, and deliberately outside the `mutate` set: no
			// test covers it, so every mutant would survive by construction and the
			// gate would fail on a list nobody could ever kill.
			"packages/web/app/(site)/page.tsx"
		]);

		await runScript();

		const written = host.writes.find((w) => w.path.endsWith(".json"));
		expect(JSON.parse(written?.contents ?? "{}")).toMatchObject({
			mutate: ["packages/web/convex/boxes/operation/record.ts"],
			// Raised for the diff run: a change may not introduce a survivor.
			thresholds: { break: 100 }
		});
	});

	test("runs no mutation when every changed file is outside the mutate set", async () => {
		host.mutable = [];
		arrange(["packages/web/app/(site)/page.tsx"]);

		await runScript();

		expect(host.spawns.some((call) => call.includes("stryker"))).toBe(false);
		expect(host.exits).toEqual([]);
	});
});
