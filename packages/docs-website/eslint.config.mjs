import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// The docs-website is a Next.js app; it carries its own flat config so the
// Next.js and React rules apply here without leaking into the composery
// runtime. Run via `pnpm --filter docs-website lint` (wired into root `check`).
const eslintConfig = defineConfig([
	...nextVitals,
	globalIgnores([
		".next/**",
		"out/**",
		"build/**",
		"next-env.d.ts",
		".source/**"
	])
]);

export default eslintConfig;
