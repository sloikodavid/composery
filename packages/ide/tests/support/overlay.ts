import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

// Loading overlay modules so a behaviour test can run them. Overlay files
// compile against the upstream IDE tsconfig and VS Code's module graph, so most
// cannot simply be imported here - but they are real files, so they can be
// evaluated as shipped rather than paraphrased.
//
// This is the sanctioned path for `packages/ide/tests/behavior/`. It hands back
// a module, never its text, which is what keeps a behaviour test from quietly
// becoming a grep over source. The patch-extraction helpers next door are the
// text-handling ones and are confined to `invariants/`.

export function transpileToCommonJs(source: string): string {
	return ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022
		}
	}).outputText;
}

export function loadOverlayModule<T>({
	source,
	dependencies = {},
	globals = {}
}: {
	source: URL;
	dependencies?: Record<string, unknown>;
	globals?: Record<string, unknown>;
}): {
	exports: T;
	binding<U>(name: string): U;
} {
	const filename = fileURLToPath(source);
	const localRequire = createRequire(source);
	const module = { exports: {} as T };
	const context = vm.createContext({
		...globals,
		exports: module.exports,
		module,
		__dirname: fileURLToPath(new URL(".", source)),
		__filename: filename,
		require(specifier: string): unknown {
			if (Object.hasOwn(dependencies, specifier)) {
				return dependencies[specifier];
			}
			return localRequire(specifier) as unknown;
		}
	});

	const contents = readFileSync(filename, "utf8");
	const executable = filename.endsWith(".ts")
		? transpileToCommonJs(contents)
		: contents;
	new vm.Script(executable, { filename }).runInContext(context);
	return {
		exports: module.exports,
		binding<U>(name: string): U {
			return new vm.Script(name).runInContext(context) as U;
		}
	};
}
