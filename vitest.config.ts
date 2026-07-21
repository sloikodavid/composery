import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		// These are repo-inspection tests: they copy trees, shell out and walk the
		// upstream working copy, so their runtime tracks how busy the machine is far
		// more than what they assert. At the 5s default a loaded runner failed them
		// for being busy, which reads as a broken patch stack and is not one.
		testTimeout: 30_000
	}
});
