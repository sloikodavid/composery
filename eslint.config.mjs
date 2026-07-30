import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const TS_FILES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

export default defineConfig(
	globalIgnores([
		"tmp/",
		"coverage/",
		"vendor/",
		"**/.next/**",
		"**/.source/**",
		"**/dist/**",
		"**/out/**",
		"**/build/**",
		"**/.cache/**",
		"**/node_modules/**",
		"packages/web/**",
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
		// Every `.mjs` here is a Node script - a generator, a check, or a test
		// harness. Listing the directories they live in was a second copy of the
		// layout that went stale the moment one moved.
		files: ["**/*.mjs"],
		languageOptions: {
			globals: {
				console: "readonly",
				fetch: "readonly",
				process: "readonly"
			}
		}
	}
);
