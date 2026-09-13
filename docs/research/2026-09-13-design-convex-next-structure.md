# Design Convex Next Structure

Source: https://chatgpt.com/share/6aa68559-0208-83ed-b8e2-f508c879f4ce

---

**User**

Design the directory layout and module boundaries for a
  single-package Next.js 16 + Convex 1.45 app that uses `src/`.
  1. Convex functions directory: root `convex/` vs `src/convex/`
  (via convex.json "functions"). Compare how each works with the
  Convex CLI, codegen, `convex/tsconfig.json`, Next's tsconfig
  `include`, Biome, and Convex's official templates and AI files.
  Which does Convex document or recommend today?
  2. How should `src/` import Convex's generated API: relative
  paths, a tsconfig `paths` alias (e.g. `@convex/*`), or
  package.json `imports` (`#convex/*`)? Does the Convex bundler
  (esbuild) resolve tsconfig `paths` and package.json `imports`
  inside Convex functions?
  3. Where does pure shared code live (constants, domain types, zod
  schemas used by both Convex functions and React)? What must such
  code avoid so it bundles cleanly for both runtimes?
  4. Should `convex/_generated` be committed? What do current Convex
  docs say, and how does that interact with CI typechecking before
  `convex dev` has run?
  5. Recommend a folder structure inside `src/` (app/, components/ui
  for shadcn, features/, lib/, hooks/) and inside `convex/` (model/
  helpers, public vs internal functions, "use node" action files,
  http.ts, crons.ts, convex.config.ts components).
  6. Where do tests/ and scripts/ live in a single package, and how
  do they avoid being picked up by Next's typecheck or build?

---

**ChatGPT**

I’ll anchor this in current Convex 1.45 docs/templates and Next.js 16 behavior, then separate “officially documented” from “works in practice but is less portable.” I’ll also call out the few places where tooling behavior differs between the Next and Convex halves of the repo.

---

**ChatGPT**

One important distinction is already clear: Convex **supports** relocating the functions directory via `convex.json`, but its current Next.js quickstart/templates still put it at root `convex/`. The Svelte quickstart is an explicit counterexample that uses `src/convex/`, so relocation is supported rather than “wrong.”

---

**ChatGPT**

The alias question has a useful split: **Next-side imports** and **Convex-side imports should not necessarily use the same rule**. Next natively honors root `tsconfig` aliases; Convex typechecks against the functions directory’s own `tsconfig.json`, while its bundler is esbuild and can resolve `paths`/package `imports`—but only when those mappings are visible from the relevant config/package boundary.

---

**ChatGPT**

For a **single-package Next.js 16 + Convex 1.45 app using `src/`**, I would keep **Next application code in `src/` and Convex at root `convex/`**. That gives you the cleanest TypeScript/runtime boundary and follows Convex's current Next.js documentation, templates, CLI defaults, and AI tooling conventions.

## 1. `convex/` vs `src/convex/`

Both are supported. They are not equally conventional for Next.js.

| Concern | root `convex/` | `src/convex/` |
|---|---|---|
| Convex support | First-class/default | First-class via `convex.json` |
| `convex dev` default | Creates `convex/` | Creates `src/convex/` when configured |
| Codegen | `convex/_generated/` | `src/convex/_generated/` |
| Convex TS config | `convex/tsconfig.json` | `src/convex/tsconfig.json` |
| Next TS boundary | Naturally outside `src` | Must deliberately exclude backend |
| Next.js Convex docs | **This is what they show** | Not the Next convention |
| Official Next templates | **Root `convex/`** | No |
| Svelte docs | — | Explicitly recommended there |
| AI files/docs | **Currently root-oriented** | Custom functions path remains supported |
| My recommendation for Next | **Yes** | Only for a concrete reason |

Convex explicitly supports changing the functions directory with root `convex.json`:

```json
{
  "$schema": "./node_modules/convex/schemas/convex.schema.json",
  "functions": "src/convex/"
}
```

The project-configuration docs use this specifically for frameworks that dislike imports outside `src/`. Convex's Svelte docs actually tell users to do exactly that. ([Convex](https://docs.convex.dev/production/project-configuration?utm_source=chatgpt.com))

But Convex's **Next.js quickstart currently says `npx convex dev` creates `convex/`**, and its current Next templates have a root `convex/` alongside the frontend directories. ([Convex](https://docs.convex.dev/quickstart/nextjs?utm_source=chatgpt.com))

So I would interpret Convex's current position as:

> `convex/` is the normal/default location. `functions` is a supported escape hatch when a framework or project layout benefits from a different location.

### TypeScript is a particularly good reason to keep it at root

Convex functions form their **own TypeScript project**. Convex says functions are typechecked using the `tsconfig.json` in the Convex functions folder. ([Convex](https://docs.convex.dev/understanding/best-practices/typescript?utm_source=chatgpt.com))

The current template's `convex/tsconfig.json` looks essentially like this:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "strict": true,
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,

    "target": "ESNext",
    "lib": ["ES2023", "dom"],
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["./**/*"],
  "exclude": ["./_generated"]
}
```

([GitHub](https://raw.githubusercontent.com/get-convex/templates/main/template-nextjs-shadcn/convex/tsconfig.json))

With root `convex/`, you can make your Next `tsconfig.json` explicitly cover only `src/`. Next and Convex then have genuinely separate compiler domains.

With `src/convex/`, a broad Next include such as `src/**/*.ts` also discovers Convex backend files unless you exclude them. The nested `src/convex/tsconfig.json` does **not** automatically make TypeScript treat that subtree as a separate project when checking the root project.

### Codegen

Conceptually, `_generated` lives beneath the configured functions directory:

```text
convex/
  _generated/
```

or:

```text
src/convex/
  _generated/
```

The Svelte docs demonstrate the latter by importing from `src/convex/_generated`. ([Convex](https://docs.convex.dev/client/svelte/overview?utm_source=chatgpt.com))

### Biome

Biome doesn't care which runtime a directory belongs to unless you tell it. I'd lint/format all handwritten code:

```text
src/**
convex/**
tests/**
scripts/**
```

but exclude generated/build material, particularly:

```text
convex/_generated/**
.next/**
```

If you use `src/convex`, make sure a blanket `src/**` Biome rule doesn't accidentally apply frontend-specific rules to the backend.

### AI files

This is another small argument for root `convex/`: current Convex AI documentation and the `ai-files` CLI reference explicitly describe:

```text
convex/_generated/ai/guidelines.md
AGENTS.md
CLAUDE.md
```

([Convex](https://docs.convex.dev/cli/reference/ai-files?utm_source=chatgpt.com))

That doesn't invalidate custom `functions`; the custom location is officially supported. It does mean the **documented AI convention remains root-`convex`-centric**, so root gives you less tooling surprise.

**Verdict:** for Next 16, use root `convex/`.

---

# 2. How should `src/` import `convex/_generated`?

I recommend:

```ts
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
```

with this in the **Next/root `tsconfig.json`**:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@convex/*": ["./convex/*"]
    }
  }
}
```

Next explicitly supports TypeScript `paths`, and when using `src/`, Next recommends updating your aliases to point into `src`. ([Next.js](https://nextjs.org/docs/app/api-reference/config/typescript?utm_source=chatgpt.com))

I would rank the three choices this way:

| From Next `src/` | Recommendation |
|---|---|
| `@convex/_generated/api` | **Best balance** |
| `../../convex/_generated/api` | Most primitive/portable, but increasingly ugly |
| `#convex/_generated/api` through package `imports` | Technically sound, but more machinery than needed |

### Inside `convex/`, do something different

Inside backend functions I would continue using Convex's documented relative style:

```ts
import { query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
```

or from nested directories:

```ts
import { internal } from "../_generated/api";
```

Don't make backend code depend on the Next project's `@convex/*` alias unless you intentionally reproduce that alias in `convex/tsconfig.json`.

This matters because Convex is its own TS project. A `paths` declaration in root `tsconfig.json` isn't automatically the compiler configuration for `convex/*.ts`. Convex explicitly typechecks against its local config. ([Convex](https://docs.convex.dev/understanding/best-practices/typescript?utm_source=chatgpt.com))

## Does Convex's bundler understand `paths`?

**Yes.**

Convex's current bundler invokes `esbuild.build()` with bundling enabled. It doesn't override `tsconfig` or inject a custom `tsconfigRaw`, so normal esbuild configuration discovery applies. ([GitHub](https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/convex/src/bundler/debugBundle.ts))

Esbuild says its Build API automatically discovers `tsconfig.json`, and it explicitly applies TypeScript `paths`/`baseUrl` remappings during module resolution. ([esbuild](https://esbuild.github.io/api/))

So this can work in `convex/tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["../src/shared/*"]
    }
  }
}
```

But I don't think there's much value in an alias for `_generated` **inside Convex itself**. Relative imports clearly identify the local generated API and match every Convex example.

There has also historically been tooling friction around customized `convex/tsconfig.json`; for example, a 2026 CLI issue specifically concerned custom path aliases being lost during a reconfiguration flow. That's another reason not to add alias configuration there unless it materially improves the codebase. ([GitHub](https://github.com/get-convex/convex-js/issues/144?utm_source=chatgpt.com))

## Does the Convex/esbuild bundler resolve `package.json#imports`?

**Yes, at the bundler-resolution level.**

Esbuild understands package subpath imports beginning with `#`; its resolver documentation specifically distinguishes both `#` subpath imports and TS `paths` remappings as first-class resolution mechanisms. ([esbuild](https://esbuild.github.io/api/))

So this is viable:

```json
{
  "imports": {
    "#convex/*": "./convex/*"
  }
}
```

and Convex's esbuild-based bundler can resolve it.

However, package `imports` have to work not only in esbuild but in **every other consumer**: TypeScript, Vitest, scripts run directly by Node, etc. Node's native ESM resolution is also stricter about extensions than bundlers in some situations.

So my policy would be:

> Use `@/*` and `@convex/*` as Next/TypeScript aliases. Use relative imports inside Convex. Reserve `#...` package imports for aliases that you intentionally want to be package-wide runtime-level contracts.

---

# 3. Where pure shared code should live

I'd create a deliberate runtime-neutral boundary:

```text
src/
  shared/
    constants/
    domain/
    schemas/
    utils/
```

For example:

```text
src/shared/
├── constants/
│   └── plans.ts
├── domain/
│   ├── account.ts
│   └── billing.ts
├── schemas/
│   ├── account.ts
│   └── project.ts
└── utils/
    ├── strings.ts
    └── dates.ts
```

Then both halves can import it.

Next:

```ts
import { projectNameSchema } from "@/shared/schemas/project";
```

Convex:

```ts
import { projectNameSchema } from "../src/shared/schemas/project";
```

Convex bundles function dependencies recursively, so shared modules don't have to physically reside under `convex/`; imported dependencies are part of the bundle. ([Convex](https://docs.convex.dev/cli/overview?utm_source=chatgpt.com))

### What belongs there

Constants, domain enums/unions, data-transfer types, pure functions, Zod schemas, formatting/parsing logic that isn't tied to the browser, React, Next, Node, or the Convex DB are good candidates.

### What shared modules must avoid

They should not import:

```text
react
next/*
next/server
server-only
client-only

convex/server
convex/react

node:fs
node:path
Node-only SDKs

browser-only libraries
```

And avoid direct use of:

```text
window
document
localStorage

process.env   // preferably injected instead
database/context objects
React hooks
Next request APIs
```

Module initialization should also avoid side effects.

Zod itself is fine as shared code: it is ordinary bundleable JavaScript. The important constraint is that the **whole transitive import graph** remains compatible with both runtimes.

Convex's default runtime is closer to a Workers/browser runtime than Node. Node-specific libraries require an action file with `"use node"`. ([Convex](https://docs.convex.dev/functions/runtimes?utm_source=chatgpt.com))

I would consequently give `src/lib/` a different meaning:

```text
src/shared/    runtime-neutral application/domain code
src/lib/       Next/React application infrastructure and integrations
```

That distinction is quite valuable.

If a shared type needs a Convex `Id<"users">`, a type-only import is workable:

```ts
import type { Id } from "@convex/_generated/dataModel";
```

but then that module isn't truly storage-independent anymore. For core domain models I'd generally keep Convex document types at an adapter/boundary layer instead of making every shared schema depend on generated database types.

---

# 4. Commit `convex/_generated`?

**Yes. Commit it.**

Convex's current codegen docs are unusually explicit:

> generated code “should be committed to the repo (your code won't typecheck without it!)”

They also say explicit `convex codegen` is rarely necessary except, for example, in CI to verify generated output. ([Convex](https://docs.convex.dev/cli/reference/codegen?utm_source=chatgpt.com))

Generated code includes things such as:

```text
convex/_generated/
├── api.d.ts
├── api.js
├── dataModel.d.ts
├── server.d.ts
└── server.js
```

([Convex](https://docs.convex.dev/generated-api/?utm_source=chatgpt.com))

This is especially important with Next because the frontend directly imports `api` and potentially `Doc`/`Id`. A clean CI checkout should therefore be able to run a TypeScript check **before anyone runs `convex dev`**.

That is the intended workflow:

```text
git checkout
npm ci
npm run typecheck
```

not:

```text
git checkout
npm ci
npx convex dev   ← required just to manufacture missing typings
npm run typecheck
```

For CI, I'd make generated freshness a **separate optional check** in an environment that has the necessary Convex project/deployment configuration:

```bash
npx convex codegen
git diff --exit-code -- convex/_generated
```

Your ordinary TypeScript job should not need a live Convex deployment merely to obtain files that should already be in Git.

---

# 5. Recommended directory structure

This is the layout I'd ship:

```text
.
├── src/
│   ├── app/
│   │   ├── (marketing)/
│   │   ├── (app)/
│   │   ├── api/
│   │   ├── layout.tsx
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn-owned primitives
│   │   └── ...                 # genuinely cross-feature components
│   │
│   ├── features/
│   │   ├── projects/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── mutations.ts
│   │   │   └── queries.ts
│   │   └── billing/
│   │       └── ...
│   │
│   ├── hooks/                  # generic app-wide hooks only
│   │
│   ├── lib/
│   │   ├── convex/
│   │   │   ├── provider.tsx
│   │   │   └── server.ts
│   │   ├── auth/
│   │   └── utils.ts
│   │
│   └── shared/
│       ├── constants/
│       ├── domain/
│       ├── schemas/
│       └── utils/
│
├── convex/
│   ├── _generated/
│   │
│   ├── model/
│   │   ├── projects.ts
│   │   └── users.ts
│   │
│   ├── helpers/
│   │   ├── auth.ts
│   │   ├── errors.ts
│   │   └── validation.ts
│   │
│   ├── actions/
│   │   ├── email.ts            # "use node" if necessary
│   │   └── billing.ts          # "use node" if necessary
│   │
│   ├── projects.ts
│   ├── users.ts
│   ├── schema.ts
│   ├── http.ts
│   ├── crons.ts
│   ├── convex.config.ts
│   └── tsconfig.json
│
├── tests/
│   ├── unit/
│   ├── convex/
│   └── e2e/
│
├── scripts/
│
├── public/
├── components.json
├── biome.json
├── next.config.ts
├── tsconfig.json
├── tsconfig.test.json
├── convex.json               # only if you need non-default settings
└── package.json
```

### `src/app`

Make routes thin. Route files should mainly handle routing, layouts, server/client boundaries, metadata and feature assembly.

Don't turn `app/` into the general-purpose source directory just because Next permits colocation.

### `components/ui`

Exactly the right place for shadcn. Shadcn's standard aliases are built around `components`, `components/ui`, `lib`, and `hooks`. ([GitHub](https://raw.githubusercontent.com/get-convex/templates/main/template-nextjs-shadcn/components.json))

Treat `components/ui` largely as vendor-style design-system primitives. Product-specific components belong with their feature:

```text
src/features/projects/components/project-card.tsx
```

instead of:

```text
src/components/project-card.tsx
```

unless the latter is genuinely reused across multiple domains.

### `features`

A feature should own UI and frontend behavior for a domain:

```text
features/projects/
  components/
  hooks/
  queries.ts
  mutations.ts
```

Those `queries.ts`/`mutations.ts` files are **frontend wrappers/hooks around Convex APIs**, not Convex function implementations.

### `convex/model`

Use this for reusable data-layer implementation:

```ts
// convex/model/projects.ts

export async function getProject(/* ctx, id */) {
  // ...
}
```

These are normal TS helpers, not externally registered Convex functions.

This distinction is encouraged by Convex's own best-practice guidance: when logic is shared between public/internal functions, use a helper instead of unnecessarily calling another registered function. ([Convex](https://docs.convex.dev/understanding/best-practices?utm_source=chatgpt.com))

### Public vs internal Convex functions

I would **not** create:

```text
convex/public/
convex/internal/
```

as the primary distinction.

Visibility in Convex comes from:

```ts
query(...)
mutation(...)
action(...)
```

versus:

```ts
internalQuery(...)
internalMutation(...)
internalAction(...)
```

not from the directory name. Convex explicitly says public and internal functions can be defined in the same file. ([Convex](https://docs.convex.dev/functions/internal-functions?utm_source=chatgpt.com))

There is another practical reason: directory names become part of Convex's function path. A file such as:

```text
convex/internal/users.ts
```

would make the generated internal reference structurally redundant.

Instead:

```ts
// convex/projects.ts

export const list = query(...);                  // client callable

export const getForBilling = internalQuery(...); // backend only
```

gives a natural conceptual API:

```ts
api.projects.list
internal.projects.getForBilling
```

Make the **public surface deliberately small**. Convex recommends internal functions whenever something should not be directly client-callable. ([Convex](https://docs.convex.dev/functions/internal-functions?utm_source=chatgpt.com))

### `"use node"` actions

Separate Node-runtime code visibly, for example:

```text
convex/actions/
  stripe.ts
  email.ts
  pdf.ts
```

with:

```ts
"use node";

import { internalAction } from "../_generated/server";
```

Convex's rules here are important: the Node runtime is only available to actions; a `"use node"` file should not contain queries or mutations, and ordinary Convex-runtime files shouldn't import `"use node"` modules. ([Convex](https://docs.convex.dev/functions/runtimes?utm_source=chatgpt.com))

I would usually make these `internalAction`s and expose a smaller mutation/action as the audited client boundary.

### `http.ts`

Keep this at the functions-directory root:

```text
convex/http.ts
```

Convex expects this exact filename for the HTTP router's default export. ([Convex](https://docs.convex.dev/functions/http-actions?utm_source=chatgpt.com))

### `crons.ts`

Likewise:

```text
convex/crons.ts
```

Current docs define cron registrations there. Prefer scheduling **internal** mutations/actions. ([Convex](https://docs.convex.dev/scheduling/cron-jobs?utm_source=chatgpt.com))

### `convex.config.ts`

Keep the application component configuration here:

```text
convex/convex.config.ts
```

For example:

```ts
import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp();

app.use(rateLimiter);

export default app;
```

Installed Convex Components are registered through this application config. Local authored components, if you ever build them, can have their own component directory and their own `convex.config.ts`. ([Convex](https://docs.convex.dev/components/authoring?utm_source=chatgpt.com))

---

# 6. `tests/`, `scripts/`, and keeping them away from Next

For this architecture I prefer both at repository root:

```text
tests/
scripts/
```

They are part of the package, but neither is application-runtime source.

Then make the Next `tsconfig.json` deliberately narrow:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@convex/*": ["./convex/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "convex",
    "tests",
    "scripts"
  ]
}
```

Next 16 generates route-aware types under `.next/types`, and `next build` uses the configured TypeScript project and fails on TypeScript errors by default. ([Next.js](https://nextjs.org/docs/app/api-reference/config/typescript?utm_source=chatgpt.com))

Notice this deliberately avoids the common:

```json
"include": ["**/*.ts", "**/*.tsx"]
```

That broad pattern is what accidentally drags:

```text
convex/
tests/
scripts/
vitest.config.ts
misc maintenance scripts
```

into an application typecheck.

An `exclude` entry doesn't prevent an excluded file from being followed when application code **imports it**, which is exactly what you want: your frontend can still resolve:

```ts
import { api } from "@convex/_generated/api";
```

while arbitrary backend source files aren't root entries in the Next TS program.

Next's bundler itself isn't going to package `tests/` or `scripts/` merely because those directories exist; production bundling follows the application module graph. The bigger issue is the **TypeScript include set**, because `next build` performs a typecheck. ([Next.js](https://nextjs.org/docs/app/api-reference/config/typescript?utm_source=chatgpt.com))

## Convex tests: one deliberate deviation from Convex's docs

Convex's current `convex-test` docs actually show tests colocated:

```text
convex/posts.test.ts
```

and recommend Vitest's edge-runtime environment. ([Convex](https://docs.convex.dev/testing/convex-test?utm_source=chatgpt.com))

That's perfectly valid.

For this particular architecture, though, I would prefer:

```text
tests/convex/
```

and explicitly give `convexTest` an `import.meta.glob` of the actual `convex/` modules. That has two benefits:

```text
Convex source tree = deployable/backend source
tests tree         = test programs
```

and your `convex/tsconfig.json` doesn't also become the project's Vitest-test TS project.

If you value Convex's lowest-friction `convexTest()` setup more than that boundary, colocated `convex/*.test.ts` is also reasonable and is the **officially documented** arrangement. This is one place where my folder recommendation is an architectural preference rather than Convex's default.

For scripts, use a separate project if you want them statically checked:

```text
tsconfig.scripts.json
```

or execute them with `tsx`. Don't broaden the Next `tsconfig` merely to make operational scripts compile.

---

## Recommended final policy

For this exact stack, I'd standardize on:

```text
src/                 Next/React application
src/shared/          universal pure domain code
convex/              Convex backend, separate TS project
convex/_generated/   committed
tests/               non-production test programs
scripts/             maintenance/dev tooling
```

Frontend imports:

```ts
import { api } from "@convex/_generated/api";
```

Backend imports:

```ts
import { query } from "./_generated/server";
```

Shared code:

```ts
import { something } from "../src/shared/...";
```

And I'd avoid putting Convex under `src/` unless some specific tool **requires** all imported code beneath `src`. Next.js 16 does not; in fact Next's own `src` documentation describes it as a way to separate application code from root-level project/configuration concerns, which fits a root Convex backend nicely. ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder?utm_source=chatgpt.com))

The result is two clean runtime/compiler islands, one package manager/lockfile, one CI workspace, and a small explicitly shared pure-code boundary.
