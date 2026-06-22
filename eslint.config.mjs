import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const TS_FILES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

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
		"packages/ide/lib/vscode/",
		"packages/ide/overlay/**",
		"packages/ide/src/browser/**/*.js",
		"rootfs/home/user/.local/share/code-server/"
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
		files: ["packages/ide/**/*.ts"],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: false
			}
		},
		rules: {
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/no-empty-object-type": "off",
			"no-async-promise-executor": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/unbound-method": "off"
		}
	},
	{
		files: ["packages/ide/tests/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.jest,
				...globals.node
			}
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
