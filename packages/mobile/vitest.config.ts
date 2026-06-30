import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The pure-logic tests (normalize-url, instance-store reducers) have no React
// Native imports, so they run in plain Node. The `@` alias mirrors tsconfig.json
// `paths`. fileURLToPath (not URL.pathname) keeps the alias correct on Windows.
export default defineConfig({
	test: { include: ["src/**/*.test.ts"], environment: "node" },
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }
});
