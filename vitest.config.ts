import { defineConfig } from "vitest/config";

import { projects } from "./vitest.projects.ts";

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
			//
			// Named rather than left to default. Vitest 4 reports only the files a
			// test imported unless this list exists, and the one honest question
			// coverage answers is the opposite one - what nothing touches - which a
			// file has to appear at zero to answer.
			include: [
				"packages/ide/overlay/**/*.{ts,js}",
				"packages/shared/**/*.{ts,mjs}",
				// `app/` and `components/` are absent on purpose. They are React
				// server and client components: wiring and JSX, where a test that
				// reached one would assert back the markup it was written from - the
				// "run the line, assert nothing" this whole configuration is arranged
				// to prevent, dressed as coverage.
				//
				// The rule that replaces the number is where a decision may live.
				// Anything decidable belongs in `lib/` or `convex/`, which are here.
				// When a component starts deciding, move the decision rather than
				// build a harness to reach it. Where one already decides - the dialogs
				// under `components/boxes/` - there is a behaviour test that drives it
				// through `// @vitest-environment jsdom` and @testing-library/react;
				// those tests earn their keep from their assertions, not from a
				// percentage. What can rot in the prose pages is whether the copy
				// still describes the service, and that is pinned where wording
				// belongs: `packages/web/tests/invariants/legal`.
				"packages/web/{convex,hooks,lib}/**/*.{ts,tsx}",
				// Every pattern is anchored at the repository root, including the ones
				// naming a package. That is not style: the sweep that finds files no
				// test loaded walks from here, so a pattern that only resolves against
				// some project's root finds nothing, and the file then appears solely
				// because a test happened to import it - present when covered, absent
				// when not, which is precisely backwards. Measured: with
				// `packages/*/scripts` missing, `packages/ide/scripts/rebrand.mjs`
				// still reported (a test imports it) while `types.mjs` beside it
				// vanished.
				"scripts/**/*.mjs",
				"packages/*/scripts/**/*.mjs"
			],
			exclude: [
				"**/_generated/**",
				"**/tests/**",
				"**/*.d.ts",
				// The rule above, for the one file in `lib/` that is presentation rather
				// than a decision: a map of Clerk element names to Tailwind strings. It
				// sits here rather than beside a component because three surfaces mount
				// Clerk, and the only test that could reach it would assert the class
				// strings back - the styling restated as an expectation.
				"packages/web/lib/clerk-appearance.ts",
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
				"packages/web/convex/boxes/workflows/**",
				// The same argument one layer down, and the reason `sshScripts.ts`
				// exists: what is left in `ssh.ts` is an ssh2 connection and the
				// actions that drive it. Covering a line of it means mocking ssh2 and
				// asserting the mock. Everything it sends and everything it reads back
				// - the fidelity flags a Repair stands on, the escaping a password
				// change stands on, the parse behind the Repair dialog - moved next
				// door, where it is pure and instrumented.
				"packages/web/convex/boxes/infra/ssh.ts",
				// Covered, but not attributably. Every file below stands on upstream
				// code-server modules - `../cli`, `../http`, `../util`, `../vscode`,
				// `../../wsRouter` - which exist only in the tree the image build
				// assembles, so a test reaches them through the overlay loader. That
				// loader re-prints a module to CommonJS, and v8's ranges then land on
				// the wrong lines of the original: `api/config` reports its whole
				// `apiConfig` literal unreached while a test drives it 19 times, and
				// `api/auth` reports the body of `httpAuth` unreached while two tests
				// drive both its branches. Measured, not assumed - dropping an entry
				// here turns `check:coverage` red on lines the suite provably covers.
				//
				// So these earn their correctness from assertions rather than from a
				// percentage, and every one of them has them, in
				// packages/ide/tests/behavior/src/node/routes/ - each guard checked by
				// breaking it and watching one test fail. That this stays true is not an
				// honour system: packages/ide/tests/invariants/coverage-exclusions.test.ts
				// reads this very list and fails if one of these stops being loaded by a
				// behaviour test. What must not happen is paraphrasing any of them into a
				// test, which would assert the paraphrase.
				//
				// The whole reasoning, and the two repairs already measured and
				// rejected, live once beside the loader in
				// packages/ide/tests/support/overlay.ts. Priced there so it is not
				// re-investigated here.
				//
				// Scoped by name rather than by directory, so a sibling that does stand
				// on its own stays instrumented and has to earn its coverage: `cloud`,
				// `envFlag`, `session`, `loginRateLimit`, `pwned` and
				// `persistence/readiness` all do.
				"packages/ide/overlay/src/node/routes/authPage.ts",
				"packages/ide/overlay/src/node/routes/changePassword.ts",
				"packages/ide/overlay/src/node/routes/cloudAuth.ts",
				"packages/ide/overlay/src/node/routes/register.ts",
				"packages/ide/overlay/src/node/routes/passwordConfig.ts",
				"packages/ide/overlay/src/node/routes/api/config.ts",
				"packages/ide/overlay/src/node/routes/api/auth.ts",
				"packages/ide/overlay/src/node/routes/api/keystore.ts",
				"packages/ide/overlay/src/node/routes/api/ratelimit.ts",
				"packages/ide/overlay/src/node/routes/api/terminals.ts",
				// The scripts served with those pages. They are vanilla DOM code
				// against markup code-server renders, and no test in this package
				// builds a DOM to run them in. The smoke drives the real pages.
				//
				// The decisions inside them are worth a test and nothing structural
				// stops one: a `// @vitest-environment jsdom` docblock is all the web
				// package's component tests need, and it works the same here. Two are
				// waiting - that a breach check which cannot be performed proceeds
				// rather than blocks, and that only an explicit `{ valid: false }` from
				// the verify endpoint counts as "wrong". Writing them is what deletes
				// this entry.
				"packages/ide/overlay/src/browser/pages/**"
			],
			// Reported, never thresholded. A global percentage is the one number that
			// can be met while the suite gets worse - run the line, assert nothing - and
			// it fails for reasons unrelated to the change in front of you: delete a
			// well-covered file and the figure drops. `check:coverage` gates the lines a
			// change actually adds, which is the question with an answer, and the report
			// below is for finding what nothing touches at all.
			//
			// `json` is what `check:coverage` diffs against, `text-summary` is the line
			// the run prints, and `html` is where "what does nothing touch" is answered
			// file by file. No `lcov`: it writes an lcov.info nothing here reads, and
			// its browsable half is `html`.
			reporter: ["text-summary", "json", "html"]
		},
		projects: projects()
	}
});
