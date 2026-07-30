import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// One vitest run for the whole repo. Separate root and recursive package
// invocations each sized their worker pool to the
// full machine, so they oversubscribed it and timed each other out - a slow test
// read as a broken one. Every project is declared here instead, so there is one
// scheduler and one place that knows what a project is.
//
// A project is a (package, kind) pair, derived rather than listed: adding a kind
// or a package cannot leave a suite silently unscheduled. Kinds and what belongs
// in each are docs/developing/testing.md; `tests/invariants/tests.test.ts`
// enforces the layout this file assumes.

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const SUITES = [
	// The repository as an artifact, plus the agreement between packages.
	{ name: "repo", root: "." },
	{ name: "ide", root: "packages/ide" },
	{ name: "shared", root: "packages/shared" },
	// `@` mirrors each package's tsconfig `paths`, so a test imports its subject
	// exactly as the package's own source does and never through a chain of `..`
	// that a move would invalidate.
	{ name: "web", root: "packages/web", alias: "packages/web" }
];

// Behaviour runs product code; invariants read the checkout. The timeout is a
// property of the kind rather than a global: repo-inspection copies trees, shells
// out and walks the upstream working copy, so its runtime tracks how busy the
// machine is more than what it asserts. Granting that budget to every test lets a
// slow behaviour test hide in it, so the two are sized apart and a test that
// needs the larger one has to move to the directory that admits why.
//
// Hang detectors, not budgets - sized against measured worst cases with the same
// margin smoke.yml uses, because the failure mode of a tight one is a healthy run
// reported as broken and nobody trusts a suite that cries wolf. Today's slowest
// invariant is the fuzz=0 patch-stack apply at ~11.7s on an idle machine; a loaded runner is
// several times that. A single test that genuinely needs longer passes its own
// timeout as vitest's third argument rather than lifting the ceiling for all of
// them - there is always a way out, and it is per test.
const KINDS = {
	behavior: 15_000,
	invariants: 120_000
};

export default defineConfig({
	test: {
		// Order dependence between tests is a defect that surfaces months later as
		// a mystery. Shuffling finds it the day it lands; the seed is reported with
		// the run so a failure is reproducible.
		sequence: { shuffle: true },
		coverage: {
			provider: "v8",
			// Behaviour projects only. An invariants test proves a string exists in
			// a file; counting it here would report code as exercised when nothing
			// ran it - the one direction a coverage number must never be wrong in.
			include: [
				"packages/ide/overlay/**/*.{ts,js}",
				"packages/shared/**/*.{ts,mjs}",
				"packages/web/{app,components,convex,hooks,lib}/**/*.{ts,tsx}",
				"scripts/**/*.mjs"
			],
			exclude: [
				"**/_generated/**",
				"**/tests/**",
				"**/*.d.ts",
				"packages/web/components/base/**",
				// Nothing under `app/` is instrumented, because nothing in this repo can
				// run it. Every vitest project here is `environment: "node"`, and these
				// are React server and client components reading Convex and Clerk through
				// hooks: covering one would mean a jsdom project, a React renderer and a
				// mock per hook, and the test that fell out would assert back the markup
				// it was written from - the "run the line, assert nothing" this whole
				// configuration is arranged to prevent, dressed as coverage.
				//
				// The rule that replaces it is where a decision is allowed to live. A
				// page or component here is wiring and JSX; anything decidable belongs in
				// `lib/` or `convex/`, which are instrumented and tested. When a
				// component starts making a decision, the fix is to move the decision,
				// not to build a harness to reach it. What can drift in the prose pages
				// is whether the copy still describes the service, and that is pinned
				// where wording belongs: `packages/web/tests/invariants/legal`.
				"packages/web/app/**",
				"packages/web/components/**",
				// A box workflow handler is a sequence of `step.runAction` calls against
				// a durable execution engine, Hetzner, Cloudflare, and SSH. Covering one
				// means standing up the workflow component and mocking all four, and
				// what the test then asserts is the order it called its own mocks in -
				// the handler restated as an expectation, which fails when the code is
				// edited rather than when it is wrong.
				//
				// What is decidable about a workflow is deliberately not in the handler,
				// and every piece of it is covered elsewhere: where a failure leaves the
				// box (`OPERATION_FAILURE_STATUS`), which states may begin an operation
				// (`OPERATION_ALLOWED_STATUSES`), what a plan provisions
				// (`lib/box-plan`). The handler is the wiring between them.
				//
				// The real check on that wiring is the system smoke, not a unit test.
				"packages/web/convex/boxes/workflows/**"
			],
			// Reported, never thresholded. A global percentage is the one number that
			// can be met while the suite gets worse - run the line, assert nothing - and
			// it fails for reasons unrelated to the change in front of you: delete a
			// well-covered file and the figure drops. `check:coverage` gates the lines a
			// change actually adds, which is the question with an answer, and the report
			// below is for finding what nothing touches at all.
			reporter: ["text-summary", "json", "lcov"]
		},
		projects: SUITES.flatMap((suite) =>
			Object.entries(KINDS).map(([kind, testTimeout]) => ({
				test: {
					name: `${suite.name}:${kind}`,
					root: path(suite.root),
					include: [`tests/${kind}/**/*.test.ts`],
					environment: "node",
					testTimeout,
					// Setup is where a harness boots - a backend, a prebuild, a
					// container fixture - so a hook that inherited vitest's stock 10s
					// while its tests had longer would fail the whole file for being
					// slow at the one step that has most right to be.
					hookTimeout: testTimeout
				},
				...(suite.alias
					? { resolve: { alias: { "@": path(suite.alias) } } }
					: {})
			}))
		)
	}
});
