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
