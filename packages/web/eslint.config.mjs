import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

// eslint-config-next brings typescript-eslint's `recommended`, which asks
// nothing of the type checker - unlike the root config, which runs
// `recommendedTypeChecked`. Adding type-aware rules here is a decision about
// this package's code, not about this file: `no-misused-promises` alone reports
// 40 React `onClick={async () => ...}` handlers, and `convex/` is already clean
// under both promise rules. Turn them on with the fixes, not before.
const eslintConfig = defineConfig([
	...nextVitals,
	...nextTs,
	prettier,
	// Additions only. Flat-config `ignores` blocks accumulate rather than
	// replace, so eslint-config-next's own ignores (`.next`, `out`, `build`,
	// `next-env.d.ts`) already apply and are not repeated here.
	globalIgnores([
		"coverage/**",
		// Generated: by `convex dev`/`convex codegen`, and by `fumadocs-mdx`.
		"convex/_generated/**",
		".source/**"
	])
]);

export default eslintConfig;
