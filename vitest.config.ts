import { defineConfig } from "vitest/config";

// One vitest run for the whole repo. Three separate invocations (root, then
// `pnpm -r` fanning out to web and mobile) each sized their worker pool to the
// full machine, so they oversubscribed it and timed each other out - a slow
// test read as a broken one. Projects share a single scheduler, and each
// package keeps its own config, so `vitest run` inside a package still works.
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "repo",
					include: ["tests/**/*.test.ts"],
					// These are repo-inspection tests: they copy trees, shell out and walk
					// the upstream working copy, so their runtime tracks how busy the
					// machine is far more than what they assert. At the 5s default a loaded
					// runner failed them for being busy, which reads as a broken patch
					// stack and is not one.
					testTimeout: 30_000
				}
			},
			"packages/web",
			"packages/mobile"
		]
	}
});
