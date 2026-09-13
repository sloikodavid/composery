# Research TypeScript Compatibility

Source: https://chatgpt.com/share/6aa68735-05bc-83eb-97fa-9fbc65c5f5ab

---

**User**

Research TypeScript 7.0.2 (the native Go port) in a Next.js 16.3 +
  Convex 1.45 + Bun 1.4 single-package app.
  1. Does `next build` type checking use TS 7 correctly? Does the
  Next TS plugin (`"plugins": [{"name":"next"}]`) work with the TS 7
  language service in VS Code? Which `typescript` package or binary
  does Next load?
  2. Compatibility of Convex 1.45 types with TS 7. Search
  specifically for issues where `v.union(v.literal(...))` /
  `Infer<>` / `Doc<"table">["field"]` widen to `string`. Status and
  workarounds.
  3. Multiple typecheck scopes in ONE package: Next app (`src/`, DOM
  + Next types), Convex (`convex/tsconfig.json`, as Convex
  requires), tests and scripts (`@types/bun`, which conflicts with
  DOM/Node globals). Compare separate `tsc -p` runs, project
  references with `tsc -b` (is `-b` supported in TS 7?), and `types:
  []` scoping. Give exact tsconfig files.
  4. Strictness flags to recommend with sources: strict,
  exactOptionalPropertyTypes, noUncheckedIndexedAccess,
  noImplicitOverride, noFallthroughCasesInSwitch,
  verbatimModuleSyntax, erasableSyntaxOnly,
  noUncheckedSideEffectImports, noPropertyAccessFromIndexSignature,
  isolatedDeclarations, moduleDetection, skipLibCheck, allowJs,
  incremental/tsBuildInfoFile. Which of these break Next, Convex
  codegen, or shadcn-generated code?
  5. `next typegen` in Next 16: what it generates (typed routes,
  LayoutProps/PageProps globals), when to run it in CI before `tsc`,
  and whether `typedRoutes` should be on.
  6. If TS 7 is not viable, which TS 6.x version is the safe
  fallback, and what is the performance cost?

---

**ChatGPT**

I’ll verify this against current TypeScript 7/Next 16.3/Convex 1.45 docs, release notes, source/issues, then separate “works today” from “theoretically supported.” I’ll also give you concrete one-package tsconfigs rather than a generic monorepo setup.

---

**ChatGPT**

The first important split is already clear: Next 16.3 can build-check with the TS 7 CLI, but the TS 7 editor server is a different architecture. That means “`next build` uses TS 7” and “the Next VS Code plugin works under TS 7” have different answers.

---

**ChatGPT**

I’ve also checked the “literal union widened to `string`” angle specifically. Convex’s current validator definitions still preserve the literal generic through `v.literal → v.union → Infer`, and I’m not finding a tracked Convex 1.45 TS7 regression for that pattern; the concrete TS7 Convex issue I found was compiler discovery, fixed in 1.43.

---

**ChatGPT**

As of **13 September 2026**, I would run this stack on **TypeScript 7.0.2**, with one deliberate compromise: use the **TS7 native compiler for CLI/build/CI**, but use the **legacy TS6 editor service in VS Code if you depend on Next’s TypeScript language-service plugin**. Do **not** use the TS6/TS7 package-alias side-by-side layout in this particular Next 16.3 app; Next 16.3 has edge cases around that layout. TypeScript 7 itself is now the normal `typescript` package and typically makes full typechecks roughly **8–12× faster** than TS6. ([Microsoft for Developers](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/))

## 1. Next 16.3 + TypeScript 7.0.2

### `next build`: yes, it can genuinely use TS7

Next 16.3 has `experimental.useTypeScriptCli`, and in the 16.3 source its default is **`true`**. In that mode Next does not try to load the missing TS7 JavaScript compiler API. Instead it resolves the project-local `typescript` package and invokes its CLI. 

More specifically, Next resolves:

```text
<app>/node_modules/typescript/package.json
```

then examines that package's `bin.tsc`. For TS7's extensionless ESM wrapper, Next has explicit TS7 handling and can fall back to the package's `lib/tsc.js` wrapper. That wrapper then starts the native compiler. 

So with:

```json
{
  "devDependencies": {
    "typescript": "7.0.2"
  }
}
```

your `next build` typecheck is a **real TS7 native typecheck**.

I would make the currently-default behavior explicit:

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    useTypeScriptCli: true,
  },
};

export default nextConfig;
```

If you set `useTypeScriptCli: false`, Next goes back to looking for:

```text
typescript/lib/typescript.js
```

which TS7 deliberately does not ship. Next's own error path explicitly tells TS7 users to use the CLI mode or install TS6. 

One subtle but important point: **Next resolves the package literally named `typescript`**. It does not just run whichever `tsc` happens to win in `$PATH` or Bun's `.bin` resolution. That is why the cleanest arrangement for Next 16.3 is simply:

```json
"typescript": "7.0.2"
```

There are current Next 16.3 reports where aliasing `"typescript"` to `@typescript/typescript6` as part of the official TS6+TS7 side-by-side pattern breaks TS/config resolution, while plain `typescript@7.0.2` works. ([GitHub](https://github.com/vercel/next.js/issues/97015))

### VS Code + `"plugins": [{ "name": "next" }]`: not under the TS7 language server

This is the caveat.

The Next plugin is a traditional **TypeScript language-service / tsserver plugin**. TS7's editor implementation is a new LSP-based language server, not tsserver. Microsoft's own TS7 VS Code integration warns that extensions contributing tsserver plugins **will not have those plugins applied while TS7 is enabled**. ([GitHub](https://github.com/microsoft/typescript-go/blob/main/_extension/src/extension.ts))

Microsoft's TS7 release guidance explicitly recommends using the TS7 CLI alongside the TS6 editor service for workflows that still require language-server plugins. VS Code exposes the command **“Disable TypeScript 7 Language Server”** for exactly this compatibility path. ([Microsoft for Developers](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/))

So the practical setup is:

```text
Build/CI:
  node_modules/typescript = 7.0.2
  next build             -> TS7 native CLI
  tsc -p ...             -> TS7 native CLI

VS Code:
  Disable TypeScript 7 Language Server
  -> VS Code's legacy TS6 service
  -> Next "next" language-service plugin works
```

The `"plugins": [{ "name": "next" }]` entry can remain in `tsconfig.json`; it is harmless to the CLI. It is relevant to the legacy editor language service, not to `tsc`.

That means you **do not need two TypeScript npm packages** merely to preserve the Next editor plugin.

---

## 2. Convex 1.45 and the literal-union widening question

Convex 1.45 is viable with TS7. Current Convex documentation explicitly says both TS6 and TS7 work and that Convex automatically uses the project's TS7 compiler. ([Convex](https://docs.convex.dev/cli/troubleshooting/typecheck-performance))

There was a real TS7 integration bug in Convex 1.42.1, but it concerned **finding the compiler in Microsoft's side-by-side alias layout**, not type inference. Canonical `typescript@7.0.2` already worked even in that report. The compiler-resolution issue was subsequently addressed, so it is not a blocker for 1.45. ([GitHub](https://github.com/get-convex/convex-js/issues/177))

### `v.union(v.literal(...))` does not appear to have a TS7 widening regression

I specifically looked for the failure mode:

```ts
v.union(v.literal("a"), v.literal("b"))
// unexpectedly becomes string
```

and for downstream widening through:

```ts
Infer<typeof validator>
Doc<"table">["field"]
```

I did **not** find a current Convex 1.45 issue establishing a TS7 regression of that form.

More importantly, Convex's current declarations are structurally designed to preserve the literals:

```ts
literal: <T extends string | number | bigint | boolean>(literal: T) =>
  new VLiteral<T>(...)

union: <T extends Validator<any, "required", any>[]>(...members: T) =>
  new VUnion<T[number]["type"], T>(...)

export type Infer<T extends Validator<...>> = T["type"];
```

That means `"a"` enters `VLiteral<"a">`, the union computes `T[number]["type"]`, and `Infer<>` reads that preserved `type`. ([GitHub](https://github.com/get-convex/convex-js/blob/main/src/values/validator.ts))

`DataModelFromSchemaDefinition` likewise threads each table's inferred document type into the generated data model rather than deliberately replacing fields with `string`. ([GitHub](https://github.com/get-convex/convex-js/blob/main/src/server/schema.ts))

If you are actually seeing widening, this is the diagnostic I would add:

```ts
import { v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";

const status = v.union(
  v.literal("draft"),
  v.literal("published"),
);

type Status = Infer<typeof status>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

type ValidatorCheck =
  Expect<Equal<Status, "draft" | "published">>;

type DataModelCheck =
  Expect<Equal<Doc<"posts">["status"], "draft" | "published">>;
```

Interpret the result as follows:

| Result | Likely problem |
|---|---|
| `ValidatorCheck` fails | TS/Convex validator inference problem |
| validator passes, `DataModelCheck` fails | schema/generated data-model path |
| both pass, use-site becomes `string` | widening is happening in your own intermediate annotation/API |

If the second one fails, regenerate Convex codegen and inspect `convex/_generated/dataModel.d.ts`. Avoid annotations such as `const status: string = ...` upstream, because once widened manually, Convex cannot recover the literal union.

One notable positive: Convex's own source explicitly accounts for `exactOptionalPropertyTypes` and says it produces a **more accurate** object type when enabled. ([GitHub](https://github.com/get-convex/convex-js/blob/main/src/values/validator.ts))

---

# 3. Three typecheck scopes in one package

I recommend **three independent TypeScript Programs**, each invoked with `tsc -p`.

`types: []` cannot vary by directory inside one TypeScript Program. It applies to the whole program. Likewise `lib` is program-wide. Therefore there is no clean single-tsconfig way to say “DOM here, Convex there, Bun globals only over there.”

TS6 also changed automatic `@types` discovery so the default `types` set is empty; Bun explicitly instructs TS6/7 projects to use `"types": ["bun"]`. ([Bun](https://bun.sh/docs/typescript-6))

### Strategy comparison

| Approach | TS7 support | Recommendation |
|---|---:|---|
| Separate `tsc -p` runs | Yes | **Best fit** |
| Project references + `tsc -b` | Yes | Technically fine, unnecessary here |
| One config + `types: []` | Yes | Cannot express per-folder ambient environments |

TS7 does support `--build`, project references, and incremental mode. Those were all ported before 7.0 shipped. ([Microsoft for Developers](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/))

The reason I would not use references here is architectural, not compatibility. Project references are best when one project is a dependency of another and consumers should type against its declaration boundary. Your Next app, Convex runtime, and Bun scripts/tests are mostly **different ambient execution environments**, not three libraries forming a build DAG.

### Root `tsconfig.json` — Next app

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],

    "module": "Preserve",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",

    "noEmit": true,
    "allowJs": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,

    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "noPropertyAccessFromIndexSignature": false,

    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,

    "skipLibCheck": true,
    "types": ["node"],

    "incremental": true,
    "tsBuildInfoFile": ".next/cache/typescript.tsbuildinfo",

    "plugins": [
      {
        "name": "next"
      }
    ],

    "paths": {
      "@/*": ["./src/*"]
    }
  },

  "include": [
    "next-env.d.ts",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "next.config.ts"
  ],

  "exclude": [
    "node_modules",
    "convex",
    "tests",
    "scripts"
  ]
}
```

A nuance worth knowing: `exclude` is **not an import firewall**. If `src/` imports Convex-generated types and those declarations refer back to the schema, TypeScript can transitively pull those files into the Next Program. That is normal. The important part is that `@types/bun` is not globally injected into this Program.

### `convex/tsconfig.json`

Keep Convex's required separate config:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ES2021", "DOM"],

    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",

    "noEmit": true,
    "allowJs": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,

    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "noPropertyAccessFromIndexSignature": false,

    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,

    "skipLibCheck": true,
    "types": [],

    "incremental": true,
    "tsBuildInfoFile": "./.tsbuildinfo"
  },

  "include": ["./**/*"],
  "exclude": ["./_generated"]
}
```

If you have Convex files using the Node runtime and directly consuming Node globals/types, change:

```json
"types": []
```

to:

```json
"types": ["node"]
```

for this config only.

### `tsconfig.bun.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext"],

    "module": "Preserve",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",

    "allowImportingTsExtensions": true,
    "noEmit": true,
    "allowJs": false,

    "types": ["bun"],

    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "noPropertyAccessFromIndexSignature": false,

    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,

    "skipLibCheck": true,

    "incremental": true,
    "tsBuildInfoFile": "./.bun.tsbuildinfo"
  },

  "include": [
    "tests/**/*.ts",
    "tests/**/*.tsx",
    "scripts/**/*.ts"
  ],

  "exclude": [
    "node_modules",
    "src",
    "convex"
  ]
}
```

That environment is very close to Bun's own TS recommendations: `lib: ["ESNext"]`, `module: "Preserve"`, Bundler resolution, `moduleDetection: "force"`, `verbatimModuleSyntax`, strict checking and `"types":["bun"]`. ([Bun](https://bun.sh/docs/typescript-6))

If a Bun test imports a React/browser module requiring `window`, DOM nodes, etc., then it is not really a Bun-only type environment. Give those tests a fourth DOM-aware test config rather than adding DOM globally to all Bun scripts.

### Scripts

```json
{
  "scripts": {
    "typecheck:app": "next typegen && tsc -p tsconfig.json",
    "typecheck:convex": "tsc -p convex/tsconfig.json",
    "typecheck:bun": "tsc -p tsconfig.bun.json",
    "typecheck": "bun run typecheck:app && bun run typecheck:convex && bun run typecheck:bun"
  }
}
```

And ignore the independent build-info files:

```gitignore
.bun.tsbuildinfo
convex/.tsbuildinfo
```

`incremental` stores a reusable project graph, while `tsBuildInfoFile` lets each Program keep its own state rather than overwriting another scope's cache. ([TypeScript](https://www.typescriptlang.org/tsconfig/incremental.html))

---

# 4. Strictness flags

This is the set I would ship:

| Flag | Setting | Assessment |
|---|---:|---|
| `strict` | `true` | Yes |
| `exactOptionalPropertyTypes` | `true` | Yes |
| `noUncheckedIndexedAccess` | `true` | Yes |
| `noImplicitOverride` | `true` | Yes |
| `noFallthroughCasesInSwitch` | `true` | Yes |
| `verbatimModuleSyntax` | `true` | Yes |
| `erasableSyntaxOnly` | `true` | Yes, assuming no enums/parameter properties |
| `noUncheckedSideEffectImports` | `true` | Yes |
| `noPropertyAccessFromIndexSignature` | `false` | Prefer off for app code |
| `isolatedDeclarations` | `false` / omitted | Don't use here |
| `moduleDetection` | `"force"` | Yes |
| `skipLibCheck` | `true` | Pragmatic for an app |
| `allowJs` | scope-dependent | Not a strictness feature |
| `incremental` | `true` | Yes |
| `tsBuildInfoFile` | unique per scope | Yes |

`exactOptionalPropertyTypes` models absence separately from “present with value `undefined`”, which is precisely why it catches a useful category of serialization/API mistakes. Convex's validator implementation explicitly optimizes its optional-property inference for this setting. ([TypeScript](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html))

`verbatimModuleSyntax` is worth enabling. It makes `import type` semantics explicit instead of relying on elision heuristics. ([TypeScript](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html)) The main compatibility irritation is **old shadcn-generated source**: there are documented versions that generated `VariantProps` as a normal runtime import and needed:

```ts
import { cva, type VariantProps } from "class-variance-authority";
```

instead. Since shadcn components are copied into your source tree, I would fix those files rather than weaken the whole project. ([GitHub](https://github.com/shadcn-ui/ui/issues/6618))

`erasableSyntaxOnly` is a good pairing for Next/Bun code that is transpiled by tools other than TypeScript. It rejects TypeScript constructs needing runtime transformation, most notably enums, parameter properties, `export =`, and similar syntax. ([TypeScript](https://www.typescriptlang.org/tsconfig/erasableSyntaxOnly.html)) This is not a Next or Convex incompatibility; it is a deliberate restriction on the syntax *you write*. One Convex-specific point makes the choice even easier: Convex documentation already says TypeScript enums are not supported in schema/API definitions and recommends string-literal unions instead. ([Convex](https://docs.convex.dev/production/project-configuration))

`noUncheckedSideEffectImports` is also worthwhile. For the Next scope, `next-env.d.ts` supplies Next's declarations for things such as image and stylesheet imports. Custom unusual asset modules may need your own `declare module "*.foo"` declaration. ([Next.js](https://nextjs.org/docs/app/api-reference/config/typescript))

I would leave `noPropertyAccessFromIndexSignature` off. Bun's own recommended strict config leaves it disabled as well. For application code it often turns harmless access to dynamic bags into bracket-notation churn without finding many meaningful bugs. ([Bun](https://bun.sh/docs/runtime/typescript))

I would **not** enable `isolatedDeclarations`. It is primarily valuable when producing `.d.ts` files independently/parallelly and consequently demands more explicit annotations on exported declarations. Your three projects are all `noEmit` application scopes, so you're paying annotation cost for a declaration-generation property you do not use.

`skipLibCheck: true` is pragmatic here, especially when React, Node, Bun, Next, and Convex all bring sizable declaration surfaces. It does **not**, however, solve global-environment contamination. Splitting the Programs remains important.

For `allowJs`, I'd use `false` for a TS-only Next app and Bun tooling, while leaving it `true` in the Convex config unless you know you have no generated/interop JS to account for.

I do not see a strictness flag above that fundamentally breaks **current Next**, **Convex codegen**, or **current shadcn**. The recurring real-world pain points are VMS exposing old shadcn imports and `erasableSyntaxOnly` exposing enums/parameter properties in your own code.

---

# 5. `next typegen` in Next 16

`next typegen` does **not** typecheck your app. It analyzes the Next route tree/config and generates the declarations that a subsequent TypeScript run consumes.

In Next 16 this includes the global route-aware helpers:

```ts
PageProps<"/blog/[slug]">
LayoutProps<"/dashboard">
RouteContext<"/api/users/[id]">
```

`PageProps` and `LayoutProps` are globals—you don't import them. They are generated by `next dev`, `next build`, or `next typegen`. ([Next.js](https://nextjs.org/docs/app/getting-started/layouts-and-pages))

It also regenerates `next-env.d.ts`, which brings Next's own ambient declarations into the TypeScript Program. ([Next.js](https://nextjs.org/docs/app/api-reference/config/typescript))

For a clean CI checkout that runs standalone `tsc`, the order should therefore be:

```bash
bunx next typegen
bunx tsc -p tsconfig.json
```

or through the script:

```json
"typecheck:app": "next typegen && tsc -p tsconfig.json"
```

If CI only runs `next build`, you do **not** need a separate preceding `next typegen`: the build itself generates the route types. The explicit command is needed when you want plain `tsc` to be an independent CI gate.

### Turn `typedRoutes` on

I recommend:

```ts
typedRoutes: true
```

It is stable in Next 16, no longer experimental. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes))

This adds compile-time validation/autocomplete for route strings passed through Next routing APIs such as `<Link>`. `PageProps`/`LayoutProps` generation is not dependent on enabling `typedRoutes`; those route-aware globals exist regardless.

The main friction is dynamic strings. For example, a value assembled from arbitrary user data may need to be narrowed, modeled as `Route`, or wrapped in a typed routing helper. For most App Router applications the additional guarantee is worth it.

---

# 6. TS6 fallback and its cost

If you hit a genuine incompatibility, the safe full-project fallback is **TypeScript 6.0.3**, installed canonically:

```json
{
  "devDependencies": {
    "typescript": "6.0.3"
  }
}
```

I would not use a package alias in this Next 16.3 project unless you have a concrete reason, because the alias arrangement is where current Next 16.3 integration bugs have shown up. ([GitHub](https://github.com/vercel/next.js/issues/97015))

But I would distinguish an **editor incompatibility** from a **compiler incompatibility**.

If your only problem is that the Next VS Code plugin does not run under TS7's new language server, **do not downgrade your build**. Keep `typescript@7.0.2`, use native TS7 in CI/build, and disable the TS7 language server in VS Code so the editor falls back to TS6. That is effectively the migration pattern Microsoft recommends for plugin-dependent projects. ([Microsoft for Developers](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/))

Only move the whole package back to TS6 when some actual build-time tool needs the old JS TypeScript API, or you encounter a confirmed TS7 semantic/compiler regression.

The performance difference can be substantial. Microsoft's published full-build examples comparing the native compiler with TS6 include roughly **7.5×, 8.2×, 9.9× and 10.2×** improvements across large projects; the final TS7 announcement describes typical full-build speedups as **8–12×**. ([Microsoft for Developers](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/))

That does **not** imply `next build` becomes 10× slower if you fall back to TS6: rendering, bundling, minification, static generation, etc. are unaffected. It means the **TypeScript-checking portion** can be about an order of magnitude slower.

## Recommended final arrangement

For **Next 16.3 + Convex 1.45 + Bun 1.4 in one package**, I would use:

```text
typescript@7.0.2              canonical package

next build
  -> experimental.useTypeScriptCli: true
  -> native TS7

tsc -p tsconfig.json
  -> Next/DOM program

tsc -p convex/tsconfig.json
  -> Convex program

tsc -p tsconfig.bun.json
  -> Bun tests/scripts program

VS Code
  -> TS6 legacy editor service when you need the Next plugin
  -> TS7 editor server otherwise

next typegen && tsc -p tsconfig.json
  -> standalone CI app typecheck

typedRoutes: true
```

The key architectural decision is **TS7 CLI everywhere, separate configs for ambient environments, and no TS6 package alias unless some other build-time dependency absolutely requires the JS compiler API**. That avoids both the Bun/global collision problem and the currently awkward TS7-plugin/Next integration boundary.
