# BRAINDUMP

Context dump for future agents reviewing or continuing this migration. Everything
about the conversation, reasoning, philosophy, and state of mind that produced the
current repo shape. Read this before touching packages/ide/ or REVISIT.md.

## The conversation that led here

The user asked whether to keep the `vendor/code-server/` patch-stack model or hard
fork code-server into the repo. Over several rounds of grilling, the thinking evolved:

### Round 1: "worlds"

I presented four options: stay the course, relocate to `packages/editor/`, soft fork
with submodule, hard fork. I recommended "relocate" (World 2) as the safe choice.

The user pushed back: they found World 2 and World 3 interesting but also wanted to
hear about a proper World 4 — a plucked hard fork with all the code-server bloat
removed, cleaned up into a proper composery shape.

### Round 2: plucked fork analysis

I analyzed code-server's source structure and identified what to pluck vs keep. The
user corrected me: I over-plucked build scripts and tests that are actually needed
for verification. They asked me to think from first principles about what moves up
to the repo root and what stays in the package.

### Round 3: first principles

I restructured the analysis. Key insight: the repo is one Docker image product with
three build packages (editor/cli/docs-website) plus repo-level infrastructure. Almost
nothing moves up. The overlay dissolves into source. The patches split: code-server
source patches could become commits, VS Code patches stay quilt. I recommended
`packages/editor/` as the name.

### Round 4: the rebase question

The user said they didn't understand my `git subtree pull` / 3-way merge explanation.
They also challenged the pnpm-for-root + npm-for-editor split as weird. They asked
me to research whether pnpm could work for the editor too.

### Round 5: pnpm research

I researched deeply. Found that code-server explicitly blocks yarn, requires npm.
VS Code uses yarn. Nobody builds code-server or VS Code with pnpm. pnpm's symlinked
node_modules can break VS Code's gulp build. The `node-linker: hoisted` escape hatch
exists but is uncharted territory for this codebase. I initially recommended npm
everywhere (Option A) or pragmatic split (Option C).

The user said: "I want it all to be a pnpm monorepo, including packages/ide."

### Round 6: hard fork clarified

The user corrected my understanding of "hard fork." They asked: "why do you keep
mentioning pulling from git and merging? Pulling from where? If WE become code-server,
we throw out the code-server repo completely."

I finally understood: this is a true hard fork. We absorb code-server's source once.
From that point, it's our code. No syncing from coder/code-server. No subtree pull.
No 3-way merges from code-server. The only upstream we still sync from is VS Code
(the submodule), which we bump and re-patch when we want a newer VS Code.

### Round 7: final shape

The user corrected several remaining issues:

- Patches should be brought verbatim, not "translated" or split. Just copy them 1:1.
- The overlay shouldn't have `lib/vscode/` paths as if patching onto code-server.
- No `code-server` wording should remain (but verbatim migration keeps it initially,
  tracked in REVISIT.md).
- The package should be `packages/ide`, not `packages/editor`.
- Everything should be pnpm, including packages/ide.

## Philosophy: why each decision was made

### Why hard fork instead of patch stack

The patch stack model (quilt diffs applied to upstream source at build time) has three
problems that compound:

1. AI agents can't see the patched source. They see unpatched source in ../sources/
   (which drifts) and separate .diff files. They can't navigate the final code.
2. Source is invisible from the repo root. You can't `git grep` across the editor
   source. You have to open a separate clone in ../sources/ which may be stale.
3. Patches-on-patches-on-submodule is three layers of indirection that confuse agents.

A hard fork solves all three: the source is in the repo, agents see it directly, and
there are only two layers (one quilt stack on VS Code, the VS Code submodule).

### Why pnpm everywhere

The user's instinct: having pnpm at the root and npm in one package feels like an
inconsistency that signals something is wrong. Cargo for Rust is fine — different
language, different ecosystem. But pnpm + npm in the same JS ecosystem feels like
a mistake that should be resolved one way or the other.

The user chose pnpm everywhere because:

- The repo is already pnpm (root + docs-website)
- pnpm is the better package manager (disk efficiency, strict deps, speed)
- Converting to npm just to match code-server's default would be a downgrade
- The pnpm compatibility concerns with VS Code's build are manageable:
  - pnpm v11 blocks dependency lifecycle scripts by default (allowBuilds handles this)
  - Workspace member's own scripts (postinstall.sh) run normally
  - postinstall.sh invokes `npm ci` in subdirectories (lib/vscode/, test/) — those
    stay npm because they have their own .npmrc and lockfiles. This is the same as
    today (code-server uses npm, VS Code uses yarn/npm). REVISIT if this should be
    converted to pnpm too.

### Why packages/ide/

- `ide` is what the product is. "Editor" undersells it and clashes with VS Code's
  internal "editor" terminology.
- Under `packages/` because it's a build package alongside `packages/cli` (Rust)
  and `packages/docs-website` (Next.js). All three produce artifacts for the Docker
  image.
- NOT `packages/code-server/` because per AGENTS.md, `code-server` is reserved for
  upstream machinery. We own this package. It gets a real name. After the rename
  pass (REVISIT), it won't say "code-server" anywhere.

### Why verbatim migration

The user's instruction: "just bring the code from them verbatim 1:1 without your
own flavoring." This means:

- All 50 patches (code-server's 25 + our 25) copied as-is into packages/ide/patches/
- Source files copied as-is from code-server v4.118.0
- No splitting, renaming, or reformatting during the migration
- All deviations tracked in REVISIT.md for a separate pass

This is the right approach because mixing migration with refactoring makes both
harder to review. The migration should be a pure structural change. The renaming
and patch-to-commit conversion are separate passes.

### Why the overlay partially dissolves

The overlay had two kinds of files:

1. `overlay/src/browser/pages/` and `overlay/src/browser/media/` — these are
   code-server source files (the build copies them from src/ to the release).
   They dissolve into `packages/ide/src/browser/` directly, replacing the upstream
   versions. The build scripts already copy from src/ to release/, so no overlay
   step is needed for these.

2. `overlay/lib/vscode/extensions/` and `overlay/lib/vscode/out/.../workbench/` —
   these go into the VS Code built output, which lives in the submodule and its
   build artifacts. They can't go in the submodule. They live under
   `packages/ide/overlay/lib/vscode/` and are applied by `build-release.sh`.

### Why .gitmodules at the repo root

Git requires .gitmodules at the repository root. The path field is relative to root.
code-server's own .gitmodules (path = lib/vscode) is not included — our root
.gitmodules supersedes it with path = packages/ide/lib/vscode.

### Why package-lock.json is deleted from packages/ide/

As a pnpm workspace member, packages/ide/'s dependencies are managed by the root
pnpm-lock.yaml. The 245KB package-lock.json from code-server is deleted. The
subdirectories (test/, lib/vscode/) keep their own lockfiles because they're
installed by postinstall.sh using npm ci, not by pnpm.

### Why no code-server wording is removed yet

The user asked "why would there still be any code-server wording?" The answer:
verbatim migration. We copy source 1:1. The renaming (package.json name, binary
name, IPC socket name, product.json fields, build script names, etc.) is a separate
pass tracked in REVISIT.md. Mixing rename with migration would make it impossible
to review the structural change independently.

## Patch categorization (confirmed against source)

Our 25 patches in vendor/code-server/patches/ target two different codebases:

### Patches targeting code-server source (src/node/_, src/browser/_, ci/build/\*):

- auth-flow.diff → src/node/{cli,http,main,routes/index,routes/login,routes/passwordConfig,routes/register,routes/resetPassword}.ts
- no-generated-password.diff → src/node/cli.ts
- persistence-readiness.diff → src/node/{persistence/readiness,routes/health,routes/index}.ts
- browser-friendly-url.diff → src/node/{main,util}.ts
- branding.diff → src/node/{cli,http,main,util,wrapper}.ts + ci/build/build-vscode.sh (ALSO targets lib/vscode/\*)
- auth-actions.diff → src/node/cli.ts (ALSO targets lib/vscode/\*)
- clipboard-osc52.diff → lib/vscode/src/vs/platform/clipboard/browser/clipboardService.ts
- clipboard-ipc.diff → lib/vscode/src/vs/platform/clipboard/browser/clipboardService.ts (Index: format)

Wait — clipboard-osc52 and clipboard-ipc target lib/vscode/, not src/node/. Let me
re-check... Yes, confirmed: both clipboard patches target
lib/vscode/src/vs/platform/clipboard/browser/clipboardService.ts. They are VSCODE
patches, not code-server patches.

So the actual split is:

- CODE-SERVER source patches: auth-flow, no-generated-password, persistence-readiness,
  browser-friendly-url (4 patches)
- BOTH (code-server + VS Code): branding, auth-actions (2 patches)
- VSCODE patches: everything else (19 patches)
- NEW FILE patches (target lib/vscode/ but create new files): narrow-gate, touch-gate,
  shortcuts (3 patches)

All 25 stay as quilt. The 4 pure code-server-source patches + the code-server parts
of the 2 "both" patches are candidates for direct source edits (REVISIT).

## The pnpm wrinkle

code-server's postinstall.sh runs `npm ci` in three subdirectories:

- test/ (has its own package.json + package-lock.json)
- test/e2e/extensions/test-extension/ (has its own package.json + package-lock.json)
- lib/vscode/ (has its own package.json + .npmrc with electron headers + lockfiles)

These subdirectory installs use npm, not pnpm. This is because:

1. lib/vscode/ has .npmrc with electron-specific config (disturl, target, runtime)
2. test/ has jest and playwright deps that are separate from the main package
3. These are not pnpm workspace members — they're nested npm projects

pnpm manages packages/ide/'s own dependencies (the 18 runtime deps + 28 dev deps
in package.json). The subdirectory npm installs are invoked by postinstall.sh as
part of the build process. This means npm is still called inside packages/ide/
during the build, but only for subdirectories, not for the main package.

This is the same situation as today: code-server uses npm, VS Code uses yarn/npm.
The difference is that the main package now uses pnpm instead of npm. The
subdirectory installs stay npm.

If this is unacceptable, REVISIT.md tracks converting postinstall.sh to use pnpm
for subdirectories. But lib/vscode/.npmrc (electron headers, legacy-peer-deps,
build_from_source) needs pnpm-specific handling. pnpm reads .npmrc but the
interaction between pnpm workspace and nested pnpm/npm installs needs testing.

## pnpm allowBuilds

pnpm v11 blocks dependency lifecycle scripts by default. code-server depends on
argon2 (native module, node-gyp compiled). The root pnpm-workspace.yaml already
has allowBuilds for esbuild, sharp, unrs-resolver. We need to add argon2.

Workspace members' own scripts (postinstall.sh) run normally — pnpm only blocks
DEPENDENCY scripts, not workspace member scripts.

## The VS Code submodule

Pinned to commit 9b8ae15a8cf95b9bce1b590b42954530f440e816 (the VS Code version
that code-server 4.118.0 uses). Confirmed from `git submodule status` in the fresh
clone.

When updating VS Code:

1. Bump the submodule: `cd packages/ide/lib/vscode && git fetch origin <new-commit> && git checkout <new-commit>`
2. Re-run `quilt push -a` — if any of the 50 patches fail, fix the failing patch
3. Rebuild

Renovate's git-submodules manager can automate bump PRs.

## VSCodium comparison

VSCodium is NOT a hard fork. It's build scripts that clone VS Code fresh each build,
apply patches via `patch -u` and `git apply`, then build. It tracks the VS Code
commit in `upstream/stable.json`. No submodule, no in-repo source.

We are NOT doing VSCodium's approach. We have the source in-repo (hard fork) and
use a git submodule for VS Code (inherited from code-server's approach). Both
approaches work. The submodule approach means VS Code source is available after
`git submodule update --init` without downloading, which helps AI agents navigate.

## What "verbatim" means for the migration

1. Source files: copied 1:1 from ../sources/code-server-4.118.0/
2. Patches: code-server's 25 copied 1:1 from ../sources/code-server-4.118.0/patches/,
   our 25 copied 1:1 from vendor/code-server/patches/
3. Series file: code-server's 25 in their original order, then our 25 in our
   original order
4. Overlay src/browser/ files: copied into packages/ide/src/browser/ (replacing
   upstream versions)
5. Overlay extensions + workbench-assets: kept under packages/ide/overlay/lib/vscode/
6. Config files (package.json, tsconfig.json, eslint.config.mjs): copied 1:1
7. Bloat: deleted (docs/, .github/, ci/helm-chart/, ci/release-image/, ci/steps/,
   ci/build/{build-packages.sh,nfpm.yaml,code-server-nfpm.sh,code-server-_.service},
   install.sh, flake._, .tours/, CHANGELOG.md, renovate.json, .git-blame-ignore-revs,
   .prettierignore, .prettierrc.yaml, .editorconfig, .gitattributes, .dockerignore,
   .gitignore, package-lock.json)

## What changes at the repo root

- pnpm-workspace.yaml: packages/ide is now a workspace member (covered by packages/\*)
- Dockerfile: no clone, no patch copy. COPY packages/ide/, submodule update, quilt
  push, pnpm install, pnpm run build
- .gitmodules: new file at root for the VS Code submodule
- renovate.json: code-server custom datasource removed, git-submodules manager added
- CI: check-code-server-patches.mjs removed, new step for IDE unit tests
- scripts/check-code-server-patches.mjs: deleted
- vendor/code-server/: deleted entirely
- tests/code-server-patches.test.ts: moved to packages/ide/test/
- docs/repo/maintenance.md: paths updated

## What does NOT change

- rootfs/ — container filesystem, not a package
- hosting/ — deployment configs
- docs/ — user-facing markdown
- packages/cli/ — Rust workspace
- packages/docs-website/ — Next.js (already pnpm)
- scripts/smoke.mjs, format.mjs, generate-icons.mjs, check-rust.mjs
- tests/code-server.test.ts — repo-level URL rewriting test
- tests/desktop-integration.test.ts — repo-level rootfs/Dockerfile test
- .github/workflows/smoke.yml, smoke-nightly.yml, release.yml
- compose.yml
- patches/fumadocs-ui@16.10.4.patch — pnpm patchedDependencies (unchanged)

## State of mind

This migration is a structural change, not a functional change. The built Docker
image should be identical before and after (same source, same patches, same build).
The only difference is where the source lives and how it gets into the build.

The risk is in the pnpm transition for packages/ide/. If pnpm's node_modules layout
breaks the VS Code build (gulp tasks, electron native modules), we'll need to debug.
The fallback is `node-linker: hoisted` in .npmrc, which creates a flat node_modules
identical to npm's. But we should try the default pnpm layout first.

The REVISIT.md items are the "polish" pass: renaming code-server to composery,
converting code-server source patches to direct edits, splitting multi-target
patches, converting clipboard-ipc.diff format. These are tracked separately because
they're functional changes, not structural ones.
