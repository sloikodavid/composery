import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL(".", import.meta.url))
		}
	},
	test: {
		environment: "node",
		include: [
			"components/**/*.test.ts",
			"lib/**/*.test.ts",
			"convex/**/*.test.ts"
		]
	}
});
