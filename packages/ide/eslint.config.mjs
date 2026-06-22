import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: [
			"lib/vscode/**",
			"out/**",
			"node_modules/**",
			"**/*.js",
			"**/*.mjs"
		]
	},
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.jest,
				...globals.node
			},
			ecmaVersion: 2018,
			sourceType: "module",
			parserOptions: {
				projectService: false
			}
		},
		rules: {
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-use-before-define": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
			"@typescript-eslint/ban-types": "off",
			"@typescript-eslint/no-var-requires": "off",
			"@typescript-eslint/explicit-module-boundary-types": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-extra-semi": "off",
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/no-empty-object-type": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/unbound-method": "off",
			"no-dupe-class-members": "off",
			"no-async-promise-executor": "off",
			eqeqeq: "error"
		}
	}
);
