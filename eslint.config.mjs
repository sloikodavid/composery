import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const TS_FILES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

// The docs-website carries its own eslint.config.mjs (eslint-config-next) and
// is linted by `pnpm --filter docs-website lint`, wired into the root `check`
// script. It is ignored here so the root type-checked-TS config does not
// double-lint it with the wrong rules.
export default defineConfig(
	globalIgnores([
		"coverage/",
		"tmp/",
		"vendor/",
		"**/.next/**",
		"**/.source/**",
		"**/dist/**",
		"**/out/**",
		"**/build/**",
		"**/.cache/**",
		"**/node_modules/**",
		"packages/docs-website/**",
		"packages/mobile-app/**",
		"packages/ide/overlay/**",
		"packages/ide/upstream/**",
		"packages/ide/build/**",
		"rootfs/home/user/.local/share/composery/"
	]),
	{
		linterOptions: {
			reportUnusedDisableDirectives: "error"
		}
	},
	js.configs.recommended,
	{
		files: TS_FILES,
		extends: [tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			}
		},
		rules: {
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error"
		}
	},
	{
		files: ["*.mjs", "scripts/**/*.mjs"],
		languageOptions: {
			globals: {
				console: "readonly",
				process: "readonly"
			}
		}
	}
);
