# Bun 1.4 Next.js Guide

Source: https://chatgpt.com/share/6aa688d2-3d20-83ed-9107-2ffaab7a1f5b

---

**User**

Give me a complete, current guide to configuring Bun 1.4 for a
  single-package Next.js 16 app.
  1. Every relevant `bunfig.toml` knob: [install] linker (hoisted vs
  isolated, and what the default is for non-workspace projects),
  exact, minimumReleaseAge and its exclusions, saveTextLockfile,
  frozenLockfile, peer handling, cache, registry; [test] root,
  preload, timeouts, coverage; [run] shell (important on Windows),
  bun auto-install. Recommend values.
  2. `trustedDependencies` vs lifecycle scripts in Bun 1.4: which
  packages in this stack need postinstall (sharp, unrs-resolver,
  @tailwindcss/oxide, lightningcss, esbuild, @biomejs/biome,
  convex)? Is `ignoreScripts` a real package.json field in Bun? What
  does `bun pm untrusted` report?
  3. The `packageManager` field and the `engines` field: how Bun,
  Corepack, and Vercel use them. How does Vercel detect and install
  with Bun 1.4, and how is the Bun version pinned there?
  4. `next dev` / `next build` under Node vs `bun --bun next dev`:
  current compatibility status, what Vercel runs in production, and
  a recommendation.
  5. `bun --parallel` and `bun --filter` script fan-out in a single
  package: the exact syntax for `"dev": "bun --parallel \"dev:*\""`,
  output prefixing, failure and exit semantics, Ctrl+C cleanup on
  Windows (orphaned `convex dev` / `next dev` processes).
  6. Known Bun 1.4 issues with Next 16, Convex CLI, Tailwind 4
  oxide, or Biome on Windows.

---

**ChatGPT**

I’ll ground this in current Bun 1.4, Next.js 16, Vercel, and package-level docs/issues, and I’ll separate documented behavior from Windows-specific rough edges.

---

**ChatGPT**

One important Bun 1.4 detail has changed during the release line: current docs/source now describe `noOrphans` support on Windows via Job Objects, while an older rendered docs page still says “no-op on Windows.” I’m treating the current source/release behavior as authoritative and will call out that doc lag.

---

**ChatGPT**

The lifecycle picture is also version-sensitive: current `create-next-app` itself writes Bun-specific `ignoreScripts` entries for `sharp` and `unrs-resolver`, even though Bun’s general lifecycle docs emphasize `trustedDependencies`. That distinction matters for a fresh Next 16 app.

---

**ChatGPT**

As of **13 September 2026**, the current Bun 1.4 patch is **Bun 1.4.2**. For a single-package Next.js 16 + Convex + Tailwind 4 + Biome application, I would use **Bun as package manager/script orchestrator/test runner, but Node 24 as the runtime for Next.js**. Vercel can install dependencies with Bun without making your production Functions run on Bun. Bun’s docs currently advertise 1.4.2, and Next 16 requires Node ≥20.9. ([Bun](https://bun.com/docs/runtime/bunfig))

## Recommended baseline

My `bunfig.toml` would be:

```toml
[install]
linker = "hoisted"
exact = true

# Supply-chain delay: 3 days
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = []

saveTextLockfile = true
frozenLockfile = false

peer = true
optional = true

# Do not let runtime imports silently fetch undeclared packages.
auto = "disable"

# Do NOT globally disable lifecycle scripts.
ignoreScripts = false

[install.cache]
disable = false
disableManifest = false
# dir = "~/.bun/install/cache" # default; normally don't override

# Normally omit this and use npmjs.org.
# registry = "https://registry.npmjs.org/"

[test]
root = "."
timeout = 5000

# Keep normal test runs fast; use `bun test --coverage` in CI.
coverage = false
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageSkipTestFiles = true

# Add only if you actually have global test setup.
# preload = ["./test/setup.ts"]

[run]
# Particularly useful for making package scripts portable on Windows.
shell = "bun"

# Keep Node-shebang CLIs such as `next` running under Node.
bun = false

# Important for dev-process fan-out, especially on Windows.
noOrphans = true
```

And the relevant portion of `package.json`:

```json
{
  "private": true,
  "packageManager": "bun@1.4.2",
  "engines": {
    "node": "24.x"
  },
  "scripts": {
    "dev": "bun --parallel \"dev:*\"",
    "dev:web": "next dev",
    "dev:convex": "convex dev",

    "build": "next build",
    "start": "next start",

    "test": "bun test",
    "test:coverage": "bun test --coverage",

    "lint": "biome check ."
  },
  "ignoreScripts": [
    "sharp",
    "unrs-resolver"
  ],
  "trustedDependencies": [
    "sharp",
    "unrs-resolver"
  ]
}
```

That apparently contradictory `ignoreScripts` + `trustedDependencies` combination for `sharp` and `unrs-resolver` is intentional: **current `create-next-app` emits exactly that combination when Bun is selected**. More on that below. ([GitHub](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/index.ts?utm_source=chatgpt.com))

---

# 1. `bunfig.toml`

### `[install]`

| Setting | Current Bun default | Recommendation | Why |
|---|---|---|---|
| `linker` | **`"hoisted"` for new single-package projects**; `"isolated"` for new workspaces | `"hoisted"` | Explicitly matches the single-app default and has the broadest Node/Next tool compatibility |
| `exact` | `false` | `true` for an app | Keeps `package.json` changes deliberate; the lockfile still remains the ultimate reproducibility mechanism |
| `minimumReleaseAge` | disabled / `null` | `259200` (3 days) | Useful supply-chain blast-radius reduction |
| `minimumReleaseAgeExcludes` | `[]` | `[]` initially | Add exceptions narrowly and temporarily |
| `saveTextLockfile` | `true` since Bun 1.2 | `true` | Use and commit `bun.lock` |
| `frozenLockfile` | `false` | `false` locally | Use `bun ci` in CI instead |
| `peer` | `true` | `true` | Bun installs peer dependencies by default |
| `optional` | `true` | `true` | **Important** for native packages whose platform binaries are optional deps |
| `ignoreScripts` | `false` | `false` | Global suppression is too broad |
| `auto` | `"auto"` | `"disable"` | Missing imports should be errors in an application, not implicit network installs |

The linker default changed in the 1.3.x era: **new single-package apps are hoisted; new workspaces are isolated**. So you do not need `linker = "hoisted"` to get that behavior, but I would write it down so a future lockfile/config migration doesn't silently alter the layout. ([Bun](https://bun.com/docs/runtime/bunfig))

`exact = true` only controls what Bun writes into `package.json`: without it Bun normally writes caret ranges such as `^2.4.1`. It does **not** replace the need for the lockfile. ([Bun](https://bun.com/docs/runtime/bunfig))

### Minimum release age

`minimumReleaseAge` is in **seconds**. Three days is `259200`. It affects **new resolution** of both direct and transitive dependencies; versions already locked in `bun.lock` are left alone. Exact requests such as `foo@1.2.3` still have to pass the age gate, although exact requests skip Bun's additional “rapid releases” stability heuristic. Bun can look up to seven days past the threshold when that heuristic detects a burst of releases. ([Bun](https://bun.com/docs/pm/cli/install?utm_source=chatgpt.com))

I would start with:

```toml
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = []
```

Use exclusions for things you genuinely need immediately, not for whole classes of dependencies:

```toml
minimumReleaseAgeExcludes = ["some-urgent-package"]
```

There is one current Bun 1.4 edge case worth knowing: an open issue reports `bun ci` re-applying the age gate after a version was admitted with a one-off `--minimum-release-age 0` override. Until that settles, if you deliberately admit a too-new dependency, putting that dependency temporarily into `minimumReleaseAgeExcludes` is safer than relying exclusively on the one-shot CLI override. ([GitHub](https://github.com/oven-sh/bun/issues/40031))

### Lockfiles

Keep:

```toml
saveTextLockfile = true
frozenLockfile = false
```

and **commit `bun.lock`**. Bun explicitly recommends committing it. In CI:

```sh
bun ci
```

is equivalent to:

```sh
bun install --frozen-lockfile
```

and fails if `package.json` and `bun.lock` disagree. ([Bun](https://bun.com/docs/runtime/bunfig))

Do not put `frozenLockfile = true` into your project-wide `bunfig.toml`: doing so makes normal `bun add`, `bun update`, etc. unnecessarily hostile locally.

### Peers and optional dependencies

Bun's current defaults are:

```toml
peer = true
optional = true
```

Keep both. In particular, native packages including Oxide, Lightning CSS and Biome use platform-specific packages delivered through optional dependencies, so globally turning optional deps off is a common way to manufacture “native module not found” errors. ([Bun](https://bun.com/docs/runtime/bunfig))

### Cache

Defaults are effectively:

```toml
[install.cache]
dir = "~/.bun/install/cache"
disable = false
disableManifest = false
```

Leave them alone. `disable=true` stops reading the global package cache; `disableManifest=true` forces Bun to resolve current versions from the registry instead of using its manifest cache. Neither is desirable for the normal app workflow. ([Bun](https://bun.com/docs/runtime/bunfig))

### Registry

The default is:

```text
https://registry.npmjs.org/
```

so I would **not** write `registry` at all unless you use a mirror/private registry. For private scopes, prefer `[install.scopes]` and environment variables rather than committing credentials:

```toml
[install.scopes]
mycompany = {
  url = "https://registry.example.com/",
  token = "$NPM_TOKEN"
}
```

Bun supports environment-variable interpolation there. ([Bun](https://bun.com/docs/runtime/bunfig))

### Bun auto-install

This is easy to misplace: despite affecting runtime resolution, its persistent config is **`[install].auto`**, not `[run]`.

The default is `"auto"`:

```toml
[install]
auto = "auto"
```

which means that if there is no `node_modules`, Bun may install dependencies automatically while executing code. The choices are `"auto"`, `"force"`, `"disable"` and `"fallback"`. ([Bun](https://bun.com/docs/runtime/bunfig))

For a normal committed Next app I recommend:

```toml
auto = "disable"
```

You want an undeclared/missing dependency to fail conspicuously. Explicit `bun install`/`bun ci` is much easier to reason about in CI, Docker and Vercel.

### `[test]`

Relevant defaults/current behavior:

```toml
[test]
root = "."             # default
timeout = 5000         # ms
coverage = false       # default
coverageReporter = ["text"]  # default
coverageDir = "coverage"
coverageSkipTestFiles = false # default
```

`preload` is an array of files that run before the test suite. I would not invent one until you need global mocks, a DOM shim, custom matchers, etc. ([Bun](https://bun.com/docs/runtime/bunfig))

For an app:

```toml
[test]
root = "."
timeout = 5000

coverage = false
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageSkipTestFiles = true
```

Then make coverage explicit:

```json
"test": "bun test",
"test:coverage": "bun test --coverage"
```

Five seconds is Bun's current per-test default. Increase individual integration tests instead of globally masking slow unit tests. ([Bun](https://bun.com/docs/test/runtime-behavior?utm_source=chatgpt.com))

If you enforce thresholds later:

```toml
coverageThreshold = { lines = 0.80, functions = 0.80 }
```

Bun currently accepts a `statements` threshold but its docs say that key is **not presently enforced**, so don't make “statements ≥ X” part of a compliance assumption yet. ([Bun](https://bun.com/docs/runtime/bunfig))

### `[run] shell`

Current default:

- Windows: `"bun"`
- macOS/Linux: `"system"`

([Bun](https://bun.com/docs/runtime/bunfig))

For this project I would explicitly use:

```toml
[run]
shell = "bun"
```

Bun Shell gives you consistent shell syntax on Windows instead of having `cmd.exe`/PowerShell differences leak into package scripts. If you deliberately depend on Bash- or PowerShell-specific features, either rewrite those scripts portably or switch that project to `"system"`.

### `[run] bun`

This setting is much more consequential than its name suggests.

```toml
[run]
bun = true
```

causes Bun to put a fake `node` on `PATH` pointing to Bun, recursively. It also overrides `#!/usr/bin/env node` shebangs. It is essentially the persistent equivalent of `--bun`. By default Bun only enables this automatically when real Node isn't already on `PATH`. ([Bun](https://bun.com/docs/runtime/bunfig))

For Next 16 today:

```toml
bun = false
```

That lets:

```sh
bun run dev
```

use Bun as the **script runner**, while the `next` CLI's Node shebang still makes Next run on **Node**.

### `[run] noOrphans`

Use it:

```toml
noOrphans = true
```

Current Bun documentation says that on Windows this uses a **kill-on-close Job Object** and terminates descendant processes when Bun exits. That's exactly what you want for a `next dev` + `convex dev` fan-out. ([Bun](https://bun.com/docs/runtime/bunfig))

That is newer than some older Bun documentation/snippets saying the feature was effectively a Windows no-op; the current docs/source describe Windows support.

---

# 2. `trustedDependencies`, lifecycle scripts, and this stack

Bun's security model differs from npm's traditional behavior: **dependency lifecycle scripts do not run indiscriminately**. Dependencies that genuinely require scripts can be approved with `trustedDependencies`. Bun also has built-in handling/optimizations for some common native dependencies such as `esbuild` and `sharp`. ([Bun](https://bun.com/docs/pm/cli/install?utm_source=chatgpt.com))

For your stack, the useful distinction is:

| Package | Has/needs install lifecycle today? | What I would do |
|---|---|---|
| `sharp` | Has native install concerns, but current Next Bun scaffolding deliberately suppresses its build script because supported targets have prebuilt binaries | Keep CNA's `ignoreScripts` + `trustedDependencies` entries |
| `unrs-resolver` | Has an install/postinstall native-binding path | Current CNA also deliberately suppresses it |
| `@tailwindcss/oxide` 4.3.x | **No install/postinstall in current manifest**; native platform packages are optional deps | Don't trust it |
| `lightningcss` | Uses platform native optional packages in normal library installation | No trust entry normally |
| `esbuild` | **Yes:** current manifest has `postinstall: node install.js` | Let Bun's native/default handling deal with it; inspect `bun pm untrusted` |
| `@biomejs/biome` 2.x | **No lifecycle scripts in current wrapper package**; platform CLI binaries are optional deps | Don't trust it |
| `convex` | No package install/postinstall requirement of its own | Don't trust `convex`; its dependency on `esbuild` is the lifecycle-relevant part |

Current `@tailwindcss/oxide` 4.3.3's manifest contains build-time repository scripts but no `install`/`postinstall`; it distributes Windows/macOS/Linux bindings as optional packages. ([GitHub](https://github.com/tailwindlabs/tailwindcss/blob/main/crates/node/package.json))

Current `@biomejs/biome` likewise has no `scripts` block and selects its native executable from optional platform packages. ([GitHub](https://github.com/biomejs/biome/blob/main/packages/%40biomejs/biome/package.json?utm_source=chatgpt.com))

Current `esbuild` does explicitly declare:

```json
"postinstall": "node install.js"
```

alongside platform-specific optional binaries. ([GitHub](https://github.com/evanw/esbuild/blob/main/npm/esbuild/package.json?utm_source=chatgpt.com))

### `sharp` and `unrs-resolver`: follow `create-next-app`

Current `create-next-app` emits:

```json
"ignoreScripts": [
  "sharp",
  "unrs-resolver"
],
"trustedDependencies": [
  "sharp",
  "unrs-resolver"
]
```

for Bun projects. The source comments explain why: Bun's package-level `ignoreScripts` support was added in Bun 1.3.2; `sharp` has prebuilt binaries on platforms Next itself supports; `unrs-resolver` also does not need its build script in the normal scaffold; and today both lists are used so Bun doesn't warn about those intentionally blocked scripts. ([GitHub](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/index.ts?utm_source=chatgpt.com))

So for a normal Next 16 app, I would **retain the generator's configuration**, rather than converting those two to ordinary trusted/run-script dependencies.

### Is `ignoreScripts` a real `package.json` field in Bun?

**Yes.** There are now two distinct things with annoyingly similar names:

```toml
# bunfig.toml — global boolean
[install]
ignoreScripts = true
```

means **don't run any project/trusted lifecycle scripts**. It is broad and I do not recommend it. ([Bun](https://bun.com/docs/runtime/bunfig))

Whereas:

```json
{
  "ignoreScripts": ["sharp", "unrs-resolver"]
}
```

is the **Bun-specific package-level denylist** that current `create-next-app` uses. ([GitHub](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/index.ts?utm_source=chatgpt.com))

### What does `bun pm untrusted` actually report?

Run:

```sh
bun pm untrusted
```

It reports installed dependencies whose lifecycle scripts were **blocked**, including the package/version and the blocked command, e.g. Bun's documentation shows output of the form:

```text
./node_modules/@biomejs/biome @1.8.3
 » [postinstall]: node scripts/postinstall.js

These dependencies had their lifecycle scripts blocked during install.
```

([Bun](https://bun.com/docs/pm/cli/pm?utm_source=chatgpt.com))

So it is not “list every package that isn't in `trustedDependencies`.” It's primarily your audit queue for packages with lifecycle scripts that Bun refused to run.

My procedure after dependency changes would be:

```sh
bun install
bun pm untrusted
```

Then approve **specific** packages only when needed:

```sh
bun pm trust some-package
```

Do not normalize on:

```sh
bun pm trust --all
```

because that throws away most of Bun's lifecycle-script security benefit.

And don't be confused by Bun docs showing old `@biomejs/biome@1.8.3` as the example: current Biome 2.x packaging no longer has that wrapper postinstall. ([Bun](https://bun.com/docs/pm/cli/pm?utm_source=chatgpt.com))

---

# 3. `packageManager`, `engines`, Corepack, and Vercel

Use:

```json
{
  "packageManager": "bun@1.4.2",
  "engines": {
    "node": "24.x"
  }
}
```

### `packageManager`

For Bun, think of this as **project metadata and a version declaration**, not as a Bun self-bootstrap mechanism.

Current `create-next-app` writes an exact `packageManager` value for Bun projects. ([GitHub](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/index.ts?utm_source=chatgpt.com))

But running an already-installed Bun does not magically make that executable replace itself with the declared version. Tools that understand the field can use it; for example, Bun setup tooling can consume it, but the field alone is not an executable version manager.

### Corepack does not manage Bun

This is a common source of confusion because `packageManager` is strongly associated with Corepack.

Corepack's supported shims are **Yarn and pnpm**, not Bun. ([Node.js](https://nodejs.org/download/release/v18.20.4/docs/api/corepack.html?utm_source=chatgpt.com))

So:

```json
"packageManager": "bun@1.4.2"
```

does **not** mean:

```sh
corepack -> installs Bun 1.4.2
```

Despite the generic comment in `create-next-app` talking about “pin via corepack,” Bun isn't among Corepack's package-manager shims. ([GitHub](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/index.ts?utm_source=chatgpt.com))

### `engines`

`engines.node` describes your **Node runtime contract**:

```json
"engines": {
  "node": "24.x"
}
```

Next.js 16 requires Node 20.9 or newer. Vercel's current default for new projects is Node **24.x**, and Vercel explicitly honors `engines.node` as an override of the project-level Node setting. ([Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16?utm_source=chatgpt.com))

I would therefore use `"24.x"` rather than merely `">=20.9"`. The latter gives deployment platforms permission to jump major Node versions; an application usually benefits from a controlled major version.

I would **not bother with `engines.bun`** when you already have:

```json
"packageManager": "bun@1.4.2"
```

because that is the clearer Bun-specific declaration.

## How Vercel decides to install with Bun

Vercel's package-manager detection is fundamentally **lockfile-based**:

- `bun.lock` → Bun ≥1.2 install path
- legacy `bun.lockb` → older Bun path
- no recognized lockfile → npm by default

([Vercel](https://vercel.com/docs/package-managers?utm_source=chatgpt.com))

So commit:

```text
bun.lock
```

Do not expect `"packageManager": "bun@1.4.2"` alone to make Vercel choose Bun.

### Pinning Vercel's *build/install* Bun to exactly 1.4.2

Vercel's current official recommendation for an exact Bun build version is a custom Install Command:

```sh
bunx bun@1.4.2 install
```

([Vercel](https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds?utm_source=chatgpt.com))

For this app I would make it reproducible:

```sh
bunx bun@1.4.2 install --frozen-lockfile
```

or equivalently use the pinned Bun binary to execute `ci` if your Vercel setup accepts it.

Important distinction: this pins **the Bun executable used during dependency installation/build machinery**. It is unrelated to which runtime your deployed server functions use.

## Pinning Vercel's *Function runtime* to Bun 1.4

That's a separate setting:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "bunVersion": "1.4.x"
}
```

As of Vercel's docs updated **24 August 2026**, valid Bun-runtime choices are:

- `"1.4.x"` → Bun 1.4 rewrite
- `"1.x"` → previous branch, currently Bun 1.3.14

Vercel manages the **patch version** for `1.4.x`; you cannot use `bunVersion: "1.4.2"` to pin Functions exactly to 1.4.2. ([Vercel](https://vercel.com/docs/functions/runtimes/bun))

So there are **three different version controls**:

```text
packageManager: bun@1.4.2
    Project declaration / tooling metadata

Vercel Install Command: bunx bun@1.4.2 install ...
    Exact Bun used for dependency install

vercel.json bunVersion: "1.4.x"
    Production Bun Function runtime branch
```

Do not conflate them.

---

# 4. `next dev` / `next build`: Node vs `bun --bun`

Bun normally respects executable shebangs. The `next` CLI is a Node-oriented executable, so:

```sh
bun run dev
```

with:

```json
"dev": "next dev"
```

does **not** imply “Next itself is running under Bun.” Bun starts the package script, sees the Node shebang, and executes Next under Node. `--bun` explicitly changes that. ([Bun](https://bun.com/docs/runtime?utm_source=chatgpt.com))

These therefore mean different things:

```sh
bun run dev
# Bun script runner, Next runtime = Node

bun --bun next dev
# Force Next itself to execute under Bun

bun run --bun next dev
# same important runtime override
```

### Current Next/Bun compatibility

The Next-on-Bun story is substantially better than it used to be, and Vercel now officially offers Bun 1.4 Functions in beta. But there are **currently open Bun 1.4 / Next 16.3 bugs in runtime behavior**, including:

- `cacheComponents` + `partialPrefetching` producing `NEXT_PRERENDER_INTERRUPTED` unhandled rejections under Bun where Node produces none. ([GitHub](https://github.com/oven-sh/bun/issues/39847?utm_source=chatgpt.com))
- lost `AsyncLocalStorage` context around `unhandledRejection`, which directly breaks Next's own expected-rejection suppression path. ([GitHub](https://github.com/oven-sh/bun/issues/40223?utm_source=chatgpt.com))
- a Vercel + Next 16.3 report where an aborted request can make a Bun 1.4 Function exit with status 128 even though an `unhandledRejection` listener exists. ([GitHub](https://github.com/oven-sh/bun/issues/39861?utm_source=chatgpt.com))

Those are unusually relevant bugs because they're in Next's **production request/render path**, not exotic APIs.

### What Vercel runs

Installing dependencies with Bun does **not** make the deployed application a Bun application.

If you do **not** opt into `bunVersion`, keep the normal Next scripts:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start"
}
```

and use Vercel's Node runtime.

If you deliberately opt into:

```json
"bunVersion": "1.4.x"
```

Vercel's current docs say that for Next.js + ISR your scripts must also use the Bun runtime:

```json
{
  "dev": "bun run --bun next dev",
  "build": "bun run --bun next build"
}
```

([Vercel](https://vercel.com/docs/functions/runtimes/bun))

### Recommendation

For production today:

```text
Bun 1.4.2:
  package installation      YES
  script orchestration      YES
  bun:test                  YES

Node 24:
  next dev                  YES
  next build                YES
  Next production runtime   YES

bun --bun next ...          experimental/opt-in
```

I would **omit `bunVersion` from `vercel.json` for now** and revisit once the current Next 16 AsyncLocalStorage/unhandled-rejection issues are closed.

---

# 5. `bun --parallel`, `bun --filter`, and dev fan-out

For one package:

```json
{
  "scripts": {
    "dev": "bun --parallel \"dev:*\"",
    "dev:web": "next dev",
    "dev:convex": "convex dev"
  }
}
```

is valid.

Bun allows the `run` word to be omitted, so the more explicit equivalent is:

```json
"dev": "bun run --parallel \"dev:*\""
```

I slightly prefer the explicit version in committed scripts because it's instantly obvious to humans that `"dev:*"` refers to package scripts. Bun documents “naked” commands as behaving like `bun run`. ([Bun](https://bun.com/docs/runtime?utm_source=chatgpt.com))

`"dev:*"` matches:

```text
dev:web
dev:convex
```

but not `dev`, so it does not recurse into itself.

### Output prefixing

Bun's parallel/sequential script runner uses Foreman-style output. Without workspaces/filtering, output is prefixed by the script name:

```text
dev:web    | ▲ Next.js ...
dev:convex | ✔ Convex functions ready ...
```

With workspace filtering it includes package + script, e.g. `pkg-a:build |`. ([Bun](https://bun.com/docs/pm/filter?utm_source=chatgpt.com))

### `--filter` is not useful here

`--filter` selects **packages/workspaces**, not your `dev:*` scripts.

In a monorepo you'd write something like:

```sh
bun run --parallel --filter '*' dev
```

For your single-package app:

```sh
bun run --parallel "dev:*"
```

is the right abstraction. ([Bun](https://bun.com/docs/pm/filter?utm_source=chatgpt.com))

### Failure semantics

By default, parallel/sequential fan-out is **fail-fast**. Bun exposes:

```sh
--no-exit-on-error
```

specifically to mean “continue running the other scripts when one fails.” ([Bun](https://bun.com/docs/runtime?utm_source=chatgpt.com))

For dev servers I would **not** use it. If Convex dies, you generally want the parent orchestration to fail rather than leave a misleading half-functional Next server running.

Treat the parent result as simply success/non-zero; don't design tooling around Bun necessarily preserving one particular child's numeric exit code through a multi-process fan-out.

### Ctrl+C and Windows orphan processes

Use:

```toml
[run]
noOrphans = true
```

This is now Bun's first-party solution. Current Bun documentation says that on Windows it keeps the processes in a **kill-on-close Job Object** and kills descendants when Bun exits. ([Bun](https://bun.com/docs/runtime/bunfig))

Combined with:

```toml
shell = "bun"
noOrphans = true
```

your:

```text
bun parallel parent
 ├─ next dev
 └─ convex dev
```

has much better Ctrl+C cleanup semantics than spawning these through an arbitrary chain of `cmd.exe`/PowerShell wrappers.

I would therefore try this **before** adding `concurrently`, `npm-run-all`, kill-port scripts, or PowerShell process-management hacks.

One nuance: a child that explicitly detaches/reparents itself can defeat ordinary process-tree assumptions. `next dev` and normal `convex dev` aren't intended to behave that way, so this should be the normal configuration.

---

# 6. Current Windows / Next / Convex / Tailwind / Biome rough edges

### Next.js 16 + Bun 1.4 runtime: still the main risk

The three open Next-runtime bugs above are the strongest reason for my Node-runtime recommendation. They concern request aborts, Next's PPR/cache-components flow and `AsyncLocalStorage`, not merely obscure dev tooling. ([GitHub](https://github.com/oven-sh/bun/issues/39847?utm_source=chatgpt.com))

They do **not** argue against using `bun install`, `bun test`, or `bun --parallel`.

### Bun 1.4 install + unusual Windows drive aliases

There is an open Bun issue where Windows installs can infinite-loop with the isolated linker or corrupt `bun.lock` with the hoisted linker when the path presented to Bun has a **different drive letter from the path where the files physically live**—for example some `subst`, junction, symlink or Dev Drive arrangements. ([GitHub](https://github.com/oven-sh/bun/issues/39357?utm_source=chatgpt.com))

If you use Windows Dev Drives:

- run Bun from the project's canonical real path/drive;
- be suspicious of `subst`/cross-volume aliases around the repo;
- if `bun install` inexplicably hangs or rewrites strange paths, test from the physical path first.

This is another small reason I would not switch a normal single-package Next app to isolated linking without a reason.

### Convex CLI on Windows

I don't see a current Bun-1.4-specific showstopper for normal `convex dev`; the more notable Windows report is a libuv `UV_HANDLE_CLOSING` assertion involving:

```sh
convex dev --until-success && convex dashboard
```

and the reporter reproduced it with **both Node and Bun**, so it shouldn't be classified as a Bun regression. ([GitHub](https://github.com/get-convex/convex-backend/issues/175?utm_source=chatgpt.com))

For your continuous setup:

```json
"dev:convex": "convex dev"
```

is preferable anyway. Let the dashboard be a separate user action rather than part of the long-lived orchestration.

Convex brings in `esbuild`; that is why `esbuild` may appear when you're auditing lifecycle scripts even though `convex` itself doesn't need to be trusted.

### Tailwind 4 Oxide

Current `@tailwindcss/oxide` 4.3.3 no longer has an install/postinstall in its package manifest and selects native builds with optional dependencies. ([GitHub](https://github.com/tailwindlabs/tailwindcss/blob/main/crates/node/package.json))

There was, however, a 2026 Windows Enterprise/WDAC report where the x64 Oxide `.node` binary was rejected by **Windows Code Integrity / VerifiedAndReputableDesktop** policy. Pinning 4.2.3 happened to work for that reporter. The issue is closed and is an enterprise Windows policy/native-binary problem, **not Bun's trustedDependencies mechanism**. ([GitHub](https://github.com/tailwindlabs/tailwindcss/issues/20042?utm_source=chatgpt.com))

So if you see something resembling:

```text
Windows error / Code Integrity
Event ID 3077 / 3033
0xc0e90002
tailwindcss-oxide.win32-x64-msvc.node
```

don't start adding packages to `trustedDependencies`; check WDAC/App Control policy.

Also: older Tailwind 4.1 Oxide packages did use a postinstall path, which is why stale guidance says “trust Oxide.” Current 4.3.x packaging is different. ([GitHub](https://github.com/tailwindlabs/tailwindcss/issues/18417?utm_source=chatgpt.com))

### Lightning CSS

The normal `lightningcss` library uses platform-specific native optional dependencies, so keep:

```toml
optional = true
```

Native-module-not-found problems have historically occurred when the appropriate `lightningcss-<platform>` package wasn't installed. ([GitHub](https://github.com/parcel-bundler/lightningcss/issues/520?utm_source=chatgpt.com))

Do not confuse the normal `lightningcss` dependency with the old **`lightningcss-cli`** package; the latter historically had a postinstall script. ([GitHub](https://github.com/parcel-bundler/lightningcss/issues/354?utm_source=chatgpt.com))

### Biome on Windows ARM64

Biome recently had a real Windows-on-ARM regression: versions **2.5.2 through 2.5.7** were reported crashing with `0xC0000005` on `win32-arm64`. The issue is now closed through fixes referenced by the maintainers, and the x64 binary under Windows-on-ARM emulation was a working workaround. ([GitHub](https://github.com/biomejs/biome/issues/11242?utm_source=chatgpt.com))

Again, this is a native binary issue, not a Bun lifecycle-script issue; current `@biomejs/biome` uses optional platform packages and has no postinstall. ([GitHub](https://github.com/biomejs/biome/blob/main/packages/%40biomejs/biome/package.json?utm_source=chatgpt.com))

---

## The configuration I would ship

So, distilled to the important decisions:

```text
Bun                    1.4.2, exact project pin
Node                    24.x
Bun linker              hoisted
package versions        exact=true
lockfile                bun.lock, committed
local frozen lock       false
CI                      bun ci
minimum package age     3 days
optional deps            enabled
peer deps                enabled
runtime auto-install     disabled
global ignoreScripts     false
Bun Shell                enabled
run.bun                  false
noOrphans                true
Next dev/build runtime    Node
Vercel installer          Bun
Vercel Functions runtime  Node, for now
```

And retain the current Next scaffold's:

```json
"ignoreScripts": ["sharp", "unrs-resolver"],
"trustedDependencies": ["sharp", "unrs-resolver"]
```

Then make this part of dependency-update hygiene:

```sh
bun install
bun pm untrusted
bun test
bun run build
```

The key architectural boundary is **“Bun as tooling/package manager ≠ Bun as Next.js runtime.”** For this stack in September 2026, Bun 1.4.2 is a good fit on the tooling side; the remaining open Next 16 runtime bugs make Node 24 the lower-risk production runtime. ([GitHub](https://github.com/oven-sh/bun/issues/39847?utm_source=chatgpt.com))

I can also monitor the open Bun/Next 16 runtime issues and let you know when the evidence is strong enough to switch the recommendation to `bun --bun next dev/build`.
