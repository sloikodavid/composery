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
				// The same rule, for the one file in `lib/` that is presentation rather
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
				// Express routers over upstream code-server modules - `../cli`,
				// `../http`, `../util`, `../constants` - which exist only in the tree
				// the image build assembles, and over `req.args`, which code-server
				// populates. `packages/ide/tests/support/overlay.ts` can evaluate an overlay file
				// that stands on its own (`authErrors`, `loginRateLimit`); it cannot
				// conjure the half of code-server these four sit inside, and the
				// alternative - paraphrasing their logic into a test - would assert
				// the paraphrase. The real check on them is the system smoke.
				//
				// Scoped to the four routers by name rather than to the directory, so
				// a helper that does stand on its own stays instrumented and has to
				// earn its coverage.
				"packages/ide/overlay/src/node/routes/authPage.ts",
				"packages/ide/overlay/src/node/routes/changePassword.ts",
				"packages/ide/overlay/src/node/routes/cloudAuth.ts",
				"packages/ide/overlay/src/node/routes/register.ts",
				// `passwordConfig` reads upstream's `../util` and `../cli`;
				// `api/terminals` reaches the VS Code pty host through `../vscode`
				// and code-server's own `wsRouter`. Same boundary, same reason.
				//
				// Their siblings are all instrumented and tested, which is what makes
				// this list a boundary rather than a blanket: `cloud`, `envFlag`,
				// `session`, `loginRateLimit`, `pwned`, `api/config` and
				// `persistence/readiness` each stand on their own and earn their
				// coverage.
				"packages/ide/overlay/src/node/routes/passwordConfig.ts",
				"packages/ide/overlay/src/node/routes/api/terminals.ts",
				// Covered, but not attributably. Every limit in `api/config` is
				// asserted by
				// `packages/ide/tests/behavior/src/node/routes/api/config.test.ts`.
				// Vitest resolves the module and its extensionless `../../envFlag`
				// import fine - a direct `await import(...)` runs green - but doing
				// that pulls the file into the root TypeScript program, which is
				// `nodenext` and rejects the import, while code-server's tsconfig is
				// `moduleResolution: "node"`, where extensionless is the required
				// spelling every file in `overlay/src/` uses. No spelling satisfies
				// both, and a `@ts-expect-error` at the import site cannot suppress an
				// error raised inside the imported file. So the test reaches it through
				// the overlay loader, and v8 does not map a vm-evaluated module back
				// onto these lines.
				//
				// The fix that would work is a second TypeScript project for
				// `packages/ide/tests/` on `moduleResolution: "node"`, and it is not
				// worth it: this is the only entry above it would buy anything for.
				// The two names below import `../util`, `../../wsRouter` and
				// `../vscode`, which exist only in the tree the image build assembles,
				// so no resolution setting makes them importable from here. Priced
				// once so it is not re-investigated.
				"packages/ide/overlay/src/node/routes/api/config.ts",
				// The scripts served with those pages. They are vanilla DOM code
				// against markup code-server renders, and this package has no browser
				// environment at all - the `ide` projects are `environment: "node"`,
				// like every other project here. The smoke drives the real pages.
				//
				// The decisions inside them are worth a test and would be reachable
				// from a jsdom project: that a breach check which cannot be performed
				// proceeds rather than blocks, and that only an explicit
				// `{ valid: false }` from the verify endpoint counts as "wrong". That
				// project is what would let this exclusion be deleted.
				"packages/ide/overlay/src/browser/pages/**"
			],
			// Reported, never thresholded. A global percentage is the one number that
			// can be met while the suite gets worse - run the line, assert nothing - and
			// it fails for reasons unrelated to the change in front of you: delete a
			// well-covered file and the figure drops. `check:coverage` gates the lines a
			// change actually adds, which is the question with an answer, and the report
			// below is for finding what nothing touches at all.
			reporter: ["text-summary", "json", "lcov"]
		},
		projects: projects()
	}
});
