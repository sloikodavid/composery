import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Mutation testing over the current change. Coverage says a line ran; this says
// whether anything would have noticed if the line were wrong. It changes the
// code - flips a comparison, drops a call, empties a block - and reports which
// mutants no test killed.
//
// Every line in this repository is written by an agent, and usually the same
// agent writes the test, so this is the load-bearing check rather than a nicety:
// it is the only one that cannot be satisfied by a test that merely runs.
//
// Scoped to the diff on purpose. A full sweep is a nightly job (mutants.yaml);
// per-change it has to be fast enough that nobody is tempted to skip it.
//
// A surviving mutant is killed by a test or annotated as equivalent with a
// reason - `// Stryker disable next-line <mutator>: <why>` for TypeScript,
// `#[mutants::skip]` with a comment for Rust. An untriaged survivor list is a
// coverage percentage wearing a different hat.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIFF = resolve(REPO_ROOT, "tmp/mutants/changed.diff");
const STRYKER_CONFIG = resolve(REPO_ROOT, "tmp/mutants/stryker.diff.json");

const git = (args) => {
	const out = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
	return out.status === 0 ? out.stdout : undefined;
};

function baseRef() {
	for (const candidate of ["origin/main", "main"]) {
		const merged = git(["merge-base", candidate, "HEAD"]);
		if (merged) return merged.trim();
	}
	const parent = git(["rev-parse", "HEAD~1"]);
	if (parent) return parent.trim();
	console.error(
		"No base commit to diff against. Fetch history (actions/checkout needs\n" +
			"fetch-depth: 0) - a mutation run over nothing reports success forever."
	);
	process.exit(1);
}

const base = baseRef();
const changed = (git(["diff", "--name-only", "--diff-filter=d", base]) ?? "")
	.split("\n")
	.filter(Boolean);

// Only source is worth mutating: a mutated test proves nothing, and a mutated
// generated file is not code anyone wrote.
const ts = changed.filter(
	(f) =>
		/\.(ts|tsx|mjs)$/.test(f) &&
		!/(^|\/)tests\//.test(f) &&
		!/\.test\.[cm]?tsx?$/.test(f) &&
		!/_generated\//.test(f) &&
		!/^packages\/ide\/(upstream|build)\//.test(f)
);
const rust = changed.filter(
	(f) => f.startsWith("packages/cli/") && f.endsWith(".rs")
);

let failed = false;

function run(label, command, args, options = {}) {
	console.log(`\n=== ${label} ===\n$ ${[command, ...args].join(" ")}`);
	const result = spawnSync(command, args, {
		cwd: REPO_ROOT,
		stdio: "inherit",
		shell: process.platform === "win32",
		...options
	});
	if (result.status !== 0) failed = true;
}

if (ts.length) {
	// Stryker has no CLI flag for the break threshold, so the run gets a generated
	// config that is the committed one plus this run's scope. Writing it out beats
	// mutating stryker.config.json in place: nothing here can leave the checked-in
	// config holding a diff-shaped `mutate` list.
	const base = JSON.parse(
		readFileSync(resolve(REPO_ROOT, "stryker.config.json"), "utf8")
	);
	mkdirSync(dirname(STRYKER_CONFIG), { recursive: true });
	writeFileSync(
		STRYKER_CONFIG,
		JSON.stringify(
			{
				...base,
				mutate: ts,
				// Nothing may survive on a line this change introduced. Equivalent
				// mutants are real, so the escape is a disable comment carrying its
				// reason - a decision in the diff rather than a threshold lowered.
				thresholds: { ...base.thresholds, break: 100 }
			},
			null,
			"	"
		)
	);
	run("TypeScript mutants", "pnpm", ["exec", "stryker", "run", STRYKER_CONFIG]);
} else {
	console.log("No TypeScript source changed; nothing to mutate.");
}

if (rust.length) {
	const diff = git(["diff", base, "--", "packages/cli"]) ?? "";
	mkdirSync(dirname(DIFF), { recursive: true });
	writeFileSync(DIFF, diff);
	const installed =
		spawnSync("cargo", ["mutants", "--version"], { stdio: "ignore" }).status ===
		0;
	if (!installed) {
		console.error(
			"cargo-mutants is not installed. `cargo install cargo-mutants` (CI does\n" +
				"this in mutants.yaml). Refusing to report a Rust pass without running."
		);
		process.exit(1);
	}
	run("Rust mutants", "cargo", [
		"mutants",
		"--manifest-path",
		"packages/cli/Cargo.toml",
		"--in-diff",
		DIFF,
		"--no-times"
	]);
} else {
	console.log("No Rust source changed; nothing to mutate.");
}

if (!ts.length && !rust.length) {
	console.log(
		`\nThis change touches no mutable source (base ${base.slice(0, 8)}).`
	);
}

if (failed) {
	console.error(
		"\nMutants survived. Kill them with a test, or annotate the equivalent ones\n" +
			"with the reason they cannot be killed. Do not widen the exclusion set."
	);
	process.exit(1);
}
console.log("\nNo surviving mutants in the changed source.");
