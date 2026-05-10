# Agentbox Plan

Agentbox is a clean rebuild inspired by Deployery, not a migration of Deployery's product surface.

The product is a proper web VPS appliance: a persistent Linux environment with passwordless sudo, Node.js, code-server on the web, and whole-rootfs persistence. It should feel simple to self-host on a VPS or PaaS, while staying clean enough to trust every line of code.

## Product Shape

Agentbox v1 includes:

- persistent root filesystem storage
- code-server in the browser
- Node.js preinstalled
- passwordless sudo for `user`
- `/home/user/Desktop` as the code-server workspace
- real `code` executable support from code-server
- real Linux file-open integration for text/code/config files via XDG and mailcap
- health, readiness, metrics, reverse-proxy path handling, and ready logs
- optional in-process HTTPS for simple VPS deployments
- Renovate, Trivy, and smoke tests from day one

Agentbox v1 does not include:

- desktop/Wayland/VNC/audio/browser stack
- custom code-server extensions
- workflow engine
- database
- persistent instance identity file such as `agentbox.json`
- Redis/workers/queue mode
- runsc or sandbox-runtime integration
- custom dependency-check script
- docs site

## Runtime Architecture

Services run under supervisor:

```text
agentbox-server
  public HTTP/HTTPS listener
  health/readiness/metrics
  ready logs
  path-prefix handling
  HTTP and WebSocket proxy to private code-server

code-server
  private listener on 127.0.0.1:13337
  auth none
  workspace /home/user/Desktop

rootfs
  live filesystem store watcher
```

Startup:

```text
entrypoint.sh
  -> create volatile runtime directories
  -> node /opt/agentbox/rootfs.ts restore
  -> exec supervisord -n -c /etc/supervisor/supervisord.conf
```

## Filesystem Persistence

Keep the Deployery persistence idea, but rewrite it cleanly as Agentbox code in TypeScript.

State layout:

```text
${AGENTBOX_VOLUME_PATH}/rootfs/files
${AGENTBOX_VOLUME_PATH}/rootfs/removed-files
```

Default:

```text
/data/rootfs/files
/data/rootfs/removed-files
```

removal marker suffix:

```text
.__removed__
```

Persistence semantics:

- store almost the whole live filesystem
- restore persisted files before services start
- watch top-level directories recursively
- record removals explicitly with removal markers
- preserve symlinks, hardlinks, permissions, owners, mtimes, and directory metadata
- batch filesystem events
- avoid partial file stores where practical
- persist apt-installed packages and live system changes
- persist code-server settings/extensions installed by the user

Required exclusions:

- `/dev`
- `/proc`
- `/run`
- `/sys`
- `/tmp`
- `/var/run`
- `${AGENTBOX_VOLUME_PATH}`
- `/opt/agentbox`
- volatile code-server locks/caches as needed

Do not carry over workflow event emission or any Deployery-specific names.

## Configuration

Use n8n-style deployment configuration where it makes sense.

```text
PORT=8080
AGENTBOX_LISTEN_ADDRESS=::
AGENTBOX_VOLUME_PATH=/data
AGENTBOX_PATH=/
AGENTBOX_HOST=localhost
AGENTBOX_PROTOCOL=http
AGENTBOX_PUBLIC_URL=
AGENTBOX_PROXY_HOPS=0
AGENTBOX_HEALTH_PATH=/healthz
AGENTBOX_METRICS=false
AGENTBOX_SSL_KEY=
AGENTBOX_SSL_CERT=
TZ=
```

Notes:

- `AGENTBOX_PUBLIC_URL` wins for ready logs.
- Otherwise ready logs are computed from protocol, host, port, and path.
- Omit `:80` for HTTP and `:443` for HTTPS.
- `AGENTBOX_PATH` affects the public UI/proxy path.
- `AGENTBOX_HEALTH_PATH` stays bare and is not automatically prefixed by `AGENTBOX_PATH`.
- HTTPS is enabled only when `AGENTBOX_PROTOCOL=https` and both SSL files are configured.
- Proxy hops default to zero. Forwarded headers are trusted only when explicitly configured.

Ready log:

```text
Agentbox is ready.
Open Agentbox at:
http://localhost:8080
```

## code-server

Build code-server from cloned upstream source:

- clone `coder/code-server`
- checkout an exact pinned commit
- update submodules as required
- apply zero patches
- build from source
- install under `/opt/code-server/current`

Create real code-server symlinks:

```text
/usr/local/bin/code
/usr/local/bin/code-server
```

The `code` symlink points to:

```text
/opt/code-server/current/lib/vscode/bin/remote-cli/code-server
```

The `code-server` symlink points to:

```text
/opt/code-server/current/bin/code-server
```

Launch private code-server with:

```text
code-server /home/user/Desktop --auth none --bind-addr 127.0.0.1:13337 --disable-update-check
```

Add `--abs-proxy-base-path` when `AGENTBOX_PATH` is not `/`.

## File Opening

Use real Linux integration, not custom wrappers.

Install:

- `xdg-utils`
- `desktop-file-utils`
- `shared-mime-info`
- `libfile-mimeinfo-perl`

Provide:

```text
/usr/share/applications/agentbox.desktop
/etc/xdg/mimeapps.list
/etc/mailcap
```

`agentbox.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Agentbox
GenericName=Text Editor
Comment=Edit files in Agentbox
Exec=code --reuse-window %F
Terminal=false
NoDisplay=true
Categories=Utility;TextEditor;Development;
StartupNotify=false
MimeType=inode/directory;text/plain;text/markdown;text/x-markdown;text/x-c;text/x-c++;text/x-chdr;text/x-csrc;text/x-c++hdr;text/x-c++src;text/x-java;text/x-python;text/x-python3;text/x-go;text/x-rust;text/x-shellscript;text/x-script.sh;text/css;text/csv;text/html;text/javascript;text/xml;application/json;application/ld+json;application/x-yaml;application/yaml;text/yaml;application/xml;application/x-shellscript;application/x-desktop;application/x-subrip;application/sql;application/toml;application/x-toml;application/x-php;application/x-httpd-php;application/x-perl;application/x-ruby;application/x-lua;application/x-zerosize;
```

Expected behavior:

- `code file.txt` opens in code-server.
- `code --wait file.txt` works for editor flows.
- `xdg-open file.txt` opens in code-server for configured MIME types.
- Debian `open`, `see`, and `edit` work via mailcap for configured MIME types.
- URL schemes are not registered. URL opens should fail naturally because Agentbox has no desktop/browser.

Keep editor env vars because they support the real `code` flow:

```text
EDITOR=code --wait
VISUAL=code --wait
GIT_EDITOR=code --wait
KUBE_EDITOR=code --wait
```

Do not set `NODE_OPTIONS` by default.

## Developer Tooling Inside The Image

Agentbox should feel like a small VPS with a VS Code frontend, not a minimal app container.

Preinstall a restrained but practical development baseline:

- `bash`
- `ca-certificates`
- `curl`
- `git`
- `jq`
- `less`
- `nano`
- `openssh-client`
- `procps`
- `python3`
- `ripgrep`
- `rsync`
- `sudo`
- `supervisor`
- `tar`
- `unzip`
- `vim-tiny`
- `wget`
- `xz-utils`
- `zip`
- `xdg-user-dirs`
- `xdg-utils`
- `desktop-file-utils`
- `shared-mime-info`
- `libfile-mimeinfo-perl`

Node.js is provided by the pinned official Node base image. Keep npm and Corepack available.

Global npm installs:

- `sudo npm install -g <package>` must work because passwordless sudo is part of the VPS contract
- plain `npm install -g <package>` as `user` is not guaranteed in v1 unless a clean user-prefix policy is chosen
- do not set a surprising global npm prefix without deciding it explicitly

Do not preinstall:

- Bun
- Turbo
- Playwright browsers
- Chromium
- desktop libraries
- database clients beyond what is useful for a general VPS baseline

This package list should stay boring. Add tools only when they help the VPS-with-code-server experience directly.

## User Environment

Create user:

```text
user
uid 1000
gid 1000
home /home/user
shell /bin/bash
passwordless sudo
```

Create empty user directories:

```text
/home/user/Desktop
/home/user/Documents
/home/user/Downloads
/home/user/Music
/home/user/Pictures
/home/user/Videos
```

Use `xdg-user-dirs` and provide `user-dirs.dirs`.

## Tooling

Use pnpm. Do not use Turbo. Do not use Bun for repo tooling.

Rationale:

- Agentbox is a single image project, not a monorepo.
- The runtime is Node, so tests should stay close to Node behavior.
- Bun is attractive, but it introduces a second JS runtime.
- Turbo is task-graph machinery we do not need.

Use:

- TypeScript
- Vitest
- ESLint
- Prettier
- pnpm

Pin pnpm through `packageManager` in `package.json` and use Corepack in Docker and GitHub Actions.

Use `"type": "module"` in `package.json` so runtime TypeScript uses ESM consistently.

Single check script and single fix script:

```json
{
  "packageManager": "pnpm@<exact>",
  "scripts": {
    "check": "tsc --noEmit && vitest run && eslint . && prettier --check .",
    "fix": "prettier --write . && eslint . --fix"
  }
}
```

Do not add a separate `dev` script in v1. Local runtime development should use Docker Compose, because the real product boundary is the image with supervisor, code-server, rootfs persistence, XDG/mailcap, sudo, and `/data`.

Node can run `.ts` files directly on modern versions using native type stripping. Keep runtime TypeScript compatible with Node's erasable TypeScript syntax and use `tsc --noEmit` as the type verifier.

TypeScript config:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `target: ESNext`
- `erasableSyntaxOnly: true`
- `verbatimModuleSyntax: true`
- `rewriteRelativeImportExtensions: true`
- `allowImportingTsExtensions: true`
- `module: NodeNext`
- `moduleResolution: NodeNext`
- no emit

Runtime TypeScript rules:

- run files with `node /opt/agentbox/<file>.ts`
- use `.ts` extensions in relative imports, for example `import { loadConfig } from "./config.ts"`
- use `import type` for type-only imports
- do not use enums, runtime namespaces, parameter properties, decorators, path aliases, or other syntax that requires TypeScript code generation

ESLint config:

- use flat config in `eslint.config.mjs`
- use `@eslint/js`
- use `typescript-eslint`
- enable typed linting with `parserOptions.projectService: true`
- start from `recommendedTypeChecked`
- consider `strictTypeChecked` once the first implementation settles
- set `reportUnusedDisableDirectives: "error"`
- use global ignores for generated and dependency directories

Vitest config:

- use `vitest.config.ts`
- use explicit imports from `vitest`, not globals
- test files live in `tests/**/*.test.ts`
- environment is `node`
- coverage provider is `v8`
- coverage should include `rootfs/opt/agentbox/**/*.ts`
- coverage can be enabled in CI once the initial tests are meaningful

Prettier config:

- use `prettier.config.mjs`
- keep formatting boring and repo-wide
- use `.prettierignore` for dependency, generated, and Docker/runtime noise

## Dockerfile Shape

Use official Node images for both builder and runtime so Renovate can update Node and image digests directly.

```dockerfile
FROM node:<exact>-trixie@sha256:<digest> AS code-server-builder
FROM node:<exact>-trixie-slim@sha256:<digest> AS runtime
```

Do not manually download Node tarballs in the Dockerfile. The Node image tag and digest are the pinned Node/runtime boundary.

Use the latest stable versions available at implementation time, verified from upstream sources immediately before writing the Dockerfile. Do not rely on model memory for version choices.

Initial version selection:

- refresh `../sources/code-server` and inspect upstream tags before choosing `CODE_SERVER_VERSION`
- as of the current planning pass, `../sources/code-server` has `v4.118.0` at `871f1d904834ee78db1c4585e2f14f65c119374a`; re-check before implementation
- use the latest stable official Node image tag available for both builder and runtime
- use the latest stable pnpm, TypeScript, ESLint, Vitest, Prettier, and GitHub Actions versions available at implementation time
- if "latest stable" conflicts with Node native TypeScript, code-server build requirements, or Debian package availability, stop and ask the user instead of silently downgrading

Use separate stages:

- builder stage: install build dependencies, clone code-server, verify the expected tag/commit, build code-server
- runtime stage: install runtime/dev-VPS packages, copy the code-server release, copy the Agentbox rootfs payload, create the user, and start Agentbox

Build code-server using Renovate-managed version and commit args:

```dockerfile
# renovate: datasource=custom.code-server-tags depName=coder/code-server versioning=semver
ARG CODE_SERVER_VERSION=4.118.0
ARG CODE_SERVER_COMMIT=871f1d904834ee78db1c4585e2f14f65c119374a
```

The build must verify:

```sh
git checkout "v${CODE_SERVER_VERSION}"
test "$(git rev-parse HEAD)" = "${CODE_SERVER_COMMIT}"
```

Before implementing the source build, inspect `../sources/code-server` for the current build flow. In particular, confirm whether upstream code-server's own `patches/series` needs to be applied when building from source. "No patches" means no Agentbox patches; it does not mean skipping upstream code-server's required build steps.

## Dependencies And Pinning

No custom `check-deps.mjs`.

Pin:

- base image by digest
- Node builder image by exact tag and digest
- Node runtime image by exact tag and digest
- code-server commit
- every apt package installed by the Dockerfile
- GitHub Actions by commit SHA
- pnpm through `packageManager`
- every npm dev dependency through exact package versions and `pnpm-lock.yaml`

Use Renovate in v1:

- update Docker image digests
- update GitHub Actions
- update npm dev dependencies
- update Node image tags/digests
- update pinned apt package versions through Renovate's Debian datasource plus custom regex managers
- update code-server version and commit together through a custom datasource and regex manager
- no automerge
- keep the dependency dashboard enabled
- require dependency dashboard approval for major updates
- keep concurrency low

Renovate must cover the full dependency surface. If a dependency cannot be updated by a built-in manager, add a readable custom manager rather than creating a custom update script.

Apt pinning policy:

- pin every apt package with `package=version`
- prefer Debian trixie package versions from the same repositories as the pinned base image
- annotate apt version variables or package lines so Renovate can update them
- use Renovate's `deb` datasource with custom regex managers; official Renovate docs require regex managers for Debian package detection
- configure Debian registry URLs with `suite=trixie`, `components=main`, and architecture-specific `binaryArch`
- keep `amd64` and `arm64` package update behavior aligned; if Renovate cannot safely update both arches for a package, stop and ask the user
- do not reintroduce `check-deps.mjs`

Renovate config:

- `config:recommended`
- dependency dashboard enabled
- semantic commits enabled
- no automerge
- low concurrency
- vulnerability alerts enabled
- Docker digest pinning enabled
- GitHub Actions updates enabled
- npm/pnpm updates enabled
- Debian apt package updates enabled through custom regex managers
- custom datasource for code-server tags
- custom regex manager to update `CODE_SERVER_VERSION` and `CODE_SERVER_COMMIT` together

Renovate config scaffold:

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "dependencyDashboard": true,
  "semanticCommits": "enabled",
  "automerge": false,
  "prConcurrentLimit": 3,
  "prHourlyLimit": 1,
  "vulnerabilityAlerts": {
    "enabled": true
  },
  "packageRules": [
    {
      "matchUpdateTypes": ["major"],
      "dependencyDashboardApproval": true
    },
    {
      "matchDatasources": ["deb"],
      "registryUrls": [
        "https://deb.debian.org/debian?suite=trixie&components=main&binaryArch=amd64",
        "https://deb.debian.org/debian?suite=trixie&components=main&binaryArch=arm64"
      ],
      "versioning": "deb"
    }
  ],
  "customManagers": [
    {
      "customType": "regex",
      "managerFilePatterns": ["/^Dockerfile$/"],
      "matchStrings": [
        "#\\s*renovate:\\s*suite=(?<suite>\\S+)\\s+depName=(?<depName>\\S+)\\s*\\n\\s*ARG\\s+[^=]+=(?<currentValue>\\S+)"
      ],
      "datasourceTemplate": "deb",
      "registryUrlTemplate": "https://deb.debian.org/debian?suite={{{suite}}}&components=main&binaryArch=amd64"
    },
    {
      "customType": "regex",
      "managerFilePatterns": ["/^Dockerfile$/"],
      "matchStrings": [
        "#\\s*renovate:\\s*datasource=custom.code-server-tags\\s+depName=(?<depName>\\S+)\\s+versioning=semver\\s*\\n\\s*ARG\\s+CODE_SERVER_VERSION=(?<currentValue>\\S+)\\s*\\n\\s*ARG\\s+CODE_SERVER_COMMIT=(?<currentDigest>[a-f0-9]{40})"
      ],
      "datasourceTemplate": "custom.code-server-tags"
    }
  ],
  "customDatasources": {
    "code-server-tags": {
      "defaultRegistryUrlTemplate": "https://api.github.com/repos/coder/code-server/tags",
      "format": "json",
      "transformTemplates": [
        "{\"releases\": $map($, function($v) { {\"version\": $replace($v.name, /^v/, \"\"), \"digest\": $v.commit.sha} })}"
      ]
    }
  }
}
```

Treat this scaffold as a starting point. Before implementation, validate it against current Renovate docs and adjust syntax if Renovate changed. Keep the invariant: Renovate updates every pinned dependency or the user is asked to decide.

## Security And Provenance

Use supply-chain features that improve trust without inventing a release platform.

GitHub Actions:

- pin every action by commit SHA
- give each job minimal permissions
- use `contents: read` by default
- grant `packages: write`, `attestations: write`, and `id-token: write` only in publish jobs
- keep Renovate responsible for action SHA updates

Container image metadata:

- publish OCI labels:
  - `org.opencontainers.image.title`
  - `org.opencontainers.image.description`
  - `org.opencontainers.image.source`
  - `org.opencontainers.image.revision`
  - `org.opencontainers.image.version`
  - `org.opencontainers.image.licenses`

Build attestations:

- use Docker BuildKit provenance attestations for pushed images
- enable SBOM attestations on published images
- use GitHub artifact attestations for published container image digests
- keep build args non-secret because provenance can expose build argument values

Vulnerability scanning:

- run Trivy against the built image
- output SARIF
- upload SARIF to GitHub code scanning
- pin Trivy-related actions by SHA
- fail CI on critical/high vulnerabilities once the baseline is clean

Release integrity:

- code-server build verifies tag and commit match
- Docker images are built from pinned base images
- Renovate PRs must pass the same smoke tests as human PRs
- no dependency update bypasses CI

## CI/CD

Use GitHub Actions in v1.

Branch and release model:

- use one protected branch: `main`
- do not use `beta`
- do not use a separate `stable` branch
- every commit on `main` should be releasable
- stable releases are semver Git tags like `v0.1.0`
- release tags must point at the current `origin/main` tip
- `latest` means the latest stable semver release, not every push to `main`
- do not publish rolling `edge` or nightly image tags in v1

Required checks:

- `pnpm check`
- Docker smoke test

Smoke should always run. Do not path-filter it away on pull requests. Agentbox's product boundary is the Docker image, so every PR should prove the image still boots and behaves correctly.

Smoke test must verify:

- container starts
- health endpoint responds
- readiness passes
- code-server is reachable through Agentbox server
- rootfs store writes live changes into `${AGENTBOX_VOLUME_PATH}/rootfs/files`
- files under `/custom-persist` survive restart
- files under `/etc` survive restart
- removals survive restart through removal markers
- `code --version` works
- `xdg-open` or mailcap opens a text file through `code` where possible in CI

Use a dedicated smoke workflow rather than burying the smoke test inside generic CI. Small helper scripts are allowed when they keep YAML readable, but do not create a sprawling `.github/scripts` framework.

Suggested `.github` layout:

```text
.github/
  workflows/
    ci.yml
    smoke.yml
    smoke-nightly.yml
    release.yml
  scripts/
    smoke/
      check-readiness.mjs
      wait-for-http.mjs
```

`ci.yml`:

- runs on pull requests and pushes to `main`
- installs pnpm
- runs `pnpm install --frozen-lockfile`
- runs `pnpm check`
- permissions: `contents: read`
- concurrency: one run per ref, cancel in progress

`smoke.yml`:

- runs on every pull request
- runs on every push to `main`
- supports `workflow_call`
- supports `workflow_dispatch`
- builds the Docker image for amd64
- builds arm64 if available and practical
- runs the full Docker smoke test
- runs Trivy against the built image
- uploads SARIF
- permissions: `contents: read`, `security-events: write`
- never publishes images
- no path filters
- no secrets required
- fork PRs run smoke but cannot publish previews
- expose a `no_cache` boolean input for nightly
- matrix starts with amd64; add arm64 when runner availability and build time are acceptable

`smoke-nightly.yml`:

- runs once daily
- supports `workflow_dispatch`
- calls `smoke.yml` with no Docker cache
- publishes no images
- exists to catch base-image, apt repository, code-server, and Dockerfile drift
- permissions: `contents: read`, `security-events: write`

`release.yml`:

- runs on Git tags like `v*` and manual dispatch
- verifies the tag points at `origin/main`
- builds multi-platform image when possible
- logs into GHCR with `GITHUB_TOKEN`
- uses Docker metadata for tags and labels
- pushes to `ghcr.io/<owner>/agentbox`
- tags every pushed image with Docker metadata-action's standard immutable `sha-<short>` tag
- tags stable releases as exact semver, semver aliases, and `latest`
- emits provenance and SBOM attestations
- creates GitHub artifact attestations for pushed image digests
- creates a GitHub release with the image tag and digest
- permissions for release jobs: `contents: write`, `packages: write`, `security-events: write`, `id-token: write`, `attestations: write`
- release tags must be semver tags and must point at `origin/main`
- release mode creates a GitHub release
- preview mode does not create a GitHub release
- preview mode is manual only

Manual preview images:

- include manual preview publishing in v1
- a preview image means manually building and pushing an image for a branch, SHA, or PR ref without making a semver release
- preview is not a separate release channel
- preview publishing exists so an exact candidate can be deployed to Railway, Render, or a VPS before tagging
- preview images publish to GHCR only
- preview images use the same build, Trivy, SBOM, provenance, and artifact-attestation path as releases
- preview images get `sha-<short>` and no semver aliases
- do not use `preview-<sha>` because `sha-<short>` already identifies the exact commit
- optional mutable PR convenience tags such as `pr-42` can be added only if they prove useful
- never auto-publish images from fork pull requests
- maintainers may manually publish a preview from a PR after review
- use the default-branch workflow for manual preview publishing, not workflow YAML from the PR branch

Workflow scaffold:

```text
ci.yml
  check
    checkout
    setup pnpm via Corepack
    setup Node
    pnpm install --frozen-lockfile
    pnpm check

smoke.yml
  smoke
    checkout
    setup Docker Buildx
    build image with provenance disabled for local smoke load
    start container with AGENTBOX_VOLUME_PATH=/mydata
    wait for /healthz
    wait for /healthz/readiness
    verify gateway proxies code-server
    verify WebSocket proxy path enough for code-server to load
    verify code --version
    verify code --wait on a temp file where possible
    verify xdg-open/mailcap for text file where possible
    verify sudo true as user
    verify sudo npm install -g with a tiny harmless package or dry-run-safe equivalent
    verify /custom-persist store
    verify /etc store
    verify removal marker creation
    restart container on same volume
    verify stored files restored
    verify removed files stay removed
    run Trivy against the smoke image
    upload SARIF
    cleanup container and volume

smoke-nightly.yml
  smoke
    call smoke.yml with no_cache=true

release.yml
  resolve-context
    checkout full history
    validate release tag or manual preview ref
    compute image tags with docker/metadata-action
  build
    build and push image
    enable SBOM and provenance
  scan
    run Trivy against pushed image
    upload SARIF
  attest
    create GitHub artifact attestation for image digest
  github-release
    only for semver tag releases
```

Trivy policy:

- run Trivy in CI from day one
- upload SARIF from day one
- start by failing only on critical vulnerabilities
- move to high+critical once the baseline is clean and the first image is not fighting inherited distro noise

Do not add issue templates, PR rules, release branch machinery, CLA automation, Dependabot, `beta`, or `stable` branch workflows in v1.

## Build And Deployment

Local development:

```sh
pnpm install
pnpm check
docker build -t agentbox .
docker compose up
```

For runtime iteration, use Docker Compose rather than a Node-only dev mode. A Node-only gateway process would miss too much of the actual product surface.

Self-hosted Docker:

```sh
docker run \
  -p 8080:8080 \
  -v agentbox-data:/data \
  ghcr.io/<owner>/agentbox:<tag>
```

PaaS:

- expose `PORT`
- mount persistent storage at `/data`
- set `AGENTBOX_HOST`, `AGENTBOX_PROTOCOL`, `AGENTBOX_PUBLIC_URL`, or `AGENTBOX_PATH` as needed
- leave TLS terminated at the platform edge unless running direct HTTPS

VPS:

- run with Docker or Docker Compose
- use `/data` volume
- either place Caddy/nginx/Traefik in front, or configure `AGENTBOX_PROTOCOL=https` with `AGENTBOX_SSL_KEY` and `AGENTBOX_SSL_CERT`

## Repo Hygiene

`.dockerignore` should keep the Docker context tight:

```text
**
!Dockerfile
!rootfs/**
```

Add more inclusions only when the Dockerfile genuinely needs them.

`.gitignore`:

- `node_modules/`
- coverage output
- logs
- editor/system noise
- local env files
- Docker/build scratch output

`.gitattributes`:

- force LF line endings with `* text=auto eol=lf`

`.editorconfig`:

- UTF-8
- LF
- final newline
- two-space indentation for JS/TS/JSON/YAML
- shell scripts kept simple and POSIX-shaped where practical

`.prettierignore`:

- `node_modules/`
- coverage output
- generated output
- lockfiles if formatting churn becomes noisy

No generated docs, tree formatters, or repo metadata scripts in v1.

## Proposed Repo Shape

```text
agentbox/
  Dockerfile
  compose.yml
  package.json
  pnpm-lock.yaml
  tsconfig.json
  eslint.config.mjs
  prettier.config.mjs
  renovate.json
  PLAN.md
  .gitattributes
  .gitignore
  .dockerignore
  .editorconfig
  .prettierignore
  rootfs/
    etc/
      mailcap
      sudoers.d/
        user
      supervisor/
        supervisord.conf
        conf.d/
          agentbox.conf
      xdg/
        mimeapps.list
    home/
      user/
        .bashrc
        .config/
          user-dirs.dirs
        .local/
          share/
            code-server/
              User/
                settings.json
        Desktop/
        Documents/
        Downloads/
        Music/
        Pictures/
        Videos/
    opt/
      agentbox/
        config.ts
        gateway.ts
        rootfs.ts
        services/
          entrypoint.sh
          code-server.sh
    usr/
      share/
        applications/
          agentbox.desktop
  tests/
    config.test.ts
    gateway.test.ts
    rootfs.test.ts
```

## Test Policy

Use a top-level `tests/` directory.

Do not colocate tests under `rootfs/`, because `rootfs/` is image payload. Tests should not be copied into the image accidentally or require fragile Docker ignore rules.

Use:

```text
tests/
  config.test.ts
  gateway.test.ts
  rootfs.test.ts
```

Do not add fixtures until a test genuinely needs them.

Keep the Docker smoke test in GitHub Actions workflow YAML for v1. Do not create a separate smoke script unless the workflow becomes too large to maintain.

## Runtime Modules

```text
rootfs/opt/agentbox/config.ts
rootfs/opt/agentbox/gateway.ts
rootfs/opt/agentbox/rootfs.ts
```

`config.ts`:

- parse environment variables
- normalize paths, URLs, booleans, and ports
- validate TLS config
- compute the public URL for ready logs
- expose typed `AgentboxConfig`

`gateway.ts`:

- create the HTTP/HTTPS public server from config
- expose health, readiness, and metrics endpoints
- proxy HTTP requests to private code-server
- proxy WebSocket upgrades to private code-server
- handle `AGENTBOX_PATH`
- gate startup until dependencies are ready
- handle graceful shutdown
- print ready logs

`rootfs.ts`:

- restore persisted rootfs state
- run the live rootfs store watcher
- maintain removal markers
- write rootfs heartbeat for readiness

Rootfs vocabulary:

- `restore`: apply persisted rootfs state back onto `/`
- `watch`: observe live rootfs changes
- `store`: copy/update live rootfs content under `rootfs/files`
- `remove`: delete stored content from `rootfs/files`
- `mark removed`: write a removal marker under `rootfs/removed-files`
- `unmark removed`: remove removal markers when a path comes back

Preferred function names:

- `restoreRootfs()`
- `watchRootfs()`
- `storePath()`
- `storeAncestors()`
- `removeStoredPath()`
- `markRemoved()`
- `unmarkRemoved()`
- `storedPathForLivePath()`
- `removalMarkerForLivePath()`
- `removalSubtreeForLivePath()`
- `isExcludedPath()`

## Implementation Contract

Implementation-agent rule:

- maximize context before changing code
- inspect local files and relevant upstream sources before choosing APIs or names
- for code-server, Renovate, GitHub Actions, Docker, Node native TypeScript, ESLint, Vitest, and Trivy, refresh or inspect authoritative current sources before implementing
- proactively talk to the user at every unknown, especially when a choice affects naming, trust, persistence semantics, release behavior, or dependency pinning
- do not silently choose a convenient fallback when the plan says "latest stable", "pin every single thing", or "Renovate owns this"

Config contract:

- `parseConfig(env = process.env)` returns `AgentboxConfig`
- `AGENTBOX_PATH` maps to `config.path`
- `config.path` is a URL path, not a filesystem path
- normalize `AGENTBOX_PATH`: unset, empty, or `/` becomes `/`; `agentbox` becomes `/agentbox`; `/agentbox/` becomes `/agentbox`
- `AGENTBOX_PUBLIC_URL` is the complete external UI base URL and includes `config.path`
- if `AGENTBOX_PUBLIC_URL` is set and `config.path !== "/"`, the public URL pathname must equal `config.path`; otherwise fail config validation
- if `AGENTBOX_PUBLIC_URL` is unset, derive it from `AGENTBOX_PROTOCOL`, `AGENTBOX_HOST`, `PORT`, and `AGENTBOX_PATH`
- omit `:80` for HTTP and `:443` for HTTPS in derived URLs
- `AGENTBOX_HEALTH_PATH` is independent from `AGENTBOX_PATH`
- `AGENTBOX_HEALTH_PATH=/healthz` means liveness is `/healthz` and readiness is `/healthz/readiness`, even when `AGENTBOX_PATH=/agentbox`
- `AGENTBOX_VOLUME_PATH` must be an absolute filesystem path
- invalid `PORT` falls back to `8080`
- invalid `AGENTBOX_PROTOCOL` falls back to `http`
- `AGENTBOX_PROTOCOL=https` requires both `AGENTBOX_SSL_KEY` and `AGENTBOX_SSL_CERT`; otherwise fail config validation

Gateway contract:

- supervisor program name: `agentbox-gateway`
- module file: `/opt/agentbox/gateway.ts`
- public listener binds to `config.listenAddress` and `config.port`
- private code-server target is `http://127.0.0.1:13337`
- request precedence:
  1. health, readiness, metrics
  2. startup gate
  3. code-server HTTP proxy
  4. code-server WebSocket proxy
- health endpoints must respond before readiness passes
- startup gate returns `503` with `Retry-After: 1` for non-health requests until ready
- readiness checks are `agentbox`, `code_server`, and `rootfs`
- WebSocket upgrades must be gated by readiness
- use explicit proxy-hop trust for `x-forwarded-host` and `x-forwarded-proto`
- filter hop-by-hop headers for HTTP proxying
- strip `config.path` before proxying to code-server
- send `x-forwarded-prefix` when a prefix is stripped
- log with `[agentbox-gateway]`

Gateway lifecycle vocabulary:

- `createGateway()` builds the gateway object/server wiring but does not imply it is listening
- `startGateway()` starts listening and health monitoring
- `stopGateway()` stops accepting traffic, closes idle/open connections, stops timers, and marks shutdown
- do not use `openGateway()` because this is not a file/browser/resource opener
- do not use `closeGracefully()` because `close` is vague and not tied to the gateway domain
- do not use `removeGateway()` because no gateway object is being removed from storage

Health response contract:

```json
{
  "ready": true,
  "status": "ok",
  "checks": [
    { "name": "agentbox", "status": "pass", "message": "Agentbox is accepting connections" },
    { "name": "code_server", "status": "pass", "message": "code-server is healthy" },
    { "name": "rootfs", "status": "pass", "message": "rootfs store is healthy" }
  ],
  "readyAt": "2026-01-01T00:00:00.000Z",
  "version": "0.1.0"
}
```

Rootfs contract:

- supervisor program name: `agentbox-rootfs`
- module file: `/opt/agentbox/rootfs.ts`
- CLI modes are `restore` and `watch`
- restore runs before supervisor starts services
- watch runs under supervisor as root
- heartbeat path is `/run/agentbox/rootfs.ready`
- event batch window starts at `200ms`
- process removals before stores in each batch
- when a directory appears, queue existing recursive contents to close the watch-registration race
- hard-link tracking key must include device and inode, not inode alone
- skip sockets, FIFOs, block devices, and character devices
- log store failures and continue watching
- flush pending events on `SIGTERM`

Rootfs required exclusions:

- `/`
- `/.dockerenv`
- `/dev`
- `/etc/hostname`
- `/etc/hosts`
- `/etc/resolv.conf`
- `/home/user/.cache`
- `/home/user/.local/share/Trash`
- `/opt/agentbox`
- `/proc`
- `/run`
- `/sys`
- `/tmp`
- `/var/cache/apt/archives`
- `/var/lib/apt/lists/lock`
- `/var/lib/dpkg/lock`
- `/var/lib/dpkg/lock-frontend`
- `/var/lib/dpkg/triggers/Lock`
- `/var/run`
- `${AGENTBOX_VOLUME_PATH}`

code-server process contract:

- supervisor program name: `code-server`
- runs as `user`
- command goes through `/opt/agentbox/services/code-server.sh`
- bind address is `127.0.0.1:13337`
- workspace is `/home/user/Desktop`
- pass `--abs-proxy-base-path` when `AGENTBOX_PATH` is not `/`
- set `VSCODE_PROXY_URI=./proxy/{{port}}`
- log stdout and stderr to container stdout/stderr

Version/build metadata contract:

- `AGENTBOX_VERSION` defaults to `unknown`
- release builds pass `AGENTBOX_VERSION`, `BUILD_REVISION`, and `BUILD_SOURCE`
- OCI labels use the same values
- ready/health responses use `AGENTBOX_VERSION`

## Deployery Audit Notes

The new implementation should be informed by Deployery, but not shaped by Deployery's old product surface.

Carry over:

- full-rootfs persistence semantics from `persistence.ts`
- removal-marker approach using sibling `.__removed__` files
- top-level recursive watches plus non-recursive `/` watch for new top-level directories
- ancestor metadata storage so restored directories keep ownership and permissions
- hard-link preservation
- symlink preservation
- copy consistency retry for files written during storage
- restore with `rsync -a -H --numeric-ids`
- unmark removed paths when they come back to life
- health/readiness/metrics controller shape
- startup gate that returns 503 until ready
- graceful shutdown behavior
- forwarded header trust based on explicit proxy hop count
- HTTP and WebSocket proxy header filtering
- path-prefix stripping and `x-forwarded-prefix`
- code-server private bind address
- `code` and `code-server` symlink layout
- XDG and mailcap file-open integration
- `/home/user/Desktop` workspace
- passwordless sudo
- LF enforcement through `.gitattributes`
- Docker smoke/nightly/release separation

Rewrite or simplify:

- rename Deployery concepts to Agentbox concepts
- collapse runtime code into `config.ts`, `gateway.ts`, and `rootfs.ts`
- remove database readiness and replace it with rootfs readiness
- remove workflow event emission from persistence
- remove `deployery.json` instance identity
- remove browser bridge, desktop bridge, custom extensions, PostgreSQL, workflows, and docs site
- replace `tsx` runtime with Node native TypeScript type stripping
- replace custom dependency scripts with Renovate
- replace custom release tag scripts with Docker metadata-action wherever possible

Deliberate differences from Deployery:

- `AGENTBOX_VOLUME_PATH=/data` contains `rootfs/files` and `rootfs/removed-files`
- `AGENTBOX_HEALTH_PATH` stays bare and is not automatically moved under `AGENTBOX_PATH`
- no URL scheme handlers for browsers because Agentbox has no desktop/browser
- no `NODE_OPTIONS` default
- no preinstalled custom code-server extensions
- no `agentbox.json` until a real migration or identity need exists

Potential revisit points:

- whether Trivy should move from critical-only failure to high+critical before the first public release
- whether to add a minimal `README.md` only for image usage once GHCR publishing exists

Settled after review:

- keep `AGENTBOX_HEALTH_PATH` bare and independent from `AGENTBOX_PATH`
- require `sudo npm install -g <package>` for global npm installs in v1
- do not add mutable preview convenience tags like `pr-42` in v1; use immutable `sha-<short>` only
- add a minimal `SECURITY.md` for private vulnerability reporting, even though v1 has no docs site

## Definition Of Done

The first implementation is not done until:

- `pnpm check` passes
- the Docker image builds from pinned inputs
- the container starts with no required environment variables
- the ready log prints a correct public URL
- `GET /healthz` returns liveness
- `GET /healthz/readiness` returns readiness with app, code-server, and rootfs checks
- code-server is reachable through the public gateway
- WebSockets work through the gateway
- `/home/user/Desktop` is the initial workspace
- `code --version` works inside the container
- `code --wait <file>` works for editor flows
- `xdg-open <text-file>` or mailcap opens through `code` in the supported cases
- `sudo true` works as `user`
- `sudo npm install -g <package>` works as `user`
- writing under `/custom-persist` is stored to `${AGENTBOX_VOLUME_PATH}/rootfs/files`
- writing under `/etc` is stored to `${AGENTBOX_VOLUME_PATH}/rootfs/files`
- deleting a stored file creates a removal marker under `${AGENTBOX_VOLUME_PATH}/rootfs/removed-files`
- persisted files and removals survive container restart
- Trivy runs in CI and uploads SARIF
- release images publish to GHCR with semver tags, `latest`, `sha-<short>`, SBOM, provenance, and artifact attestations
- manual preview publishing can publish an exact `sha-<short>` image without creating a release

## Implementation Order

1. Create minimal repo tooling.
2. Create Dockerfile with pinned official Node builder/runtime images and minimal packages.
3. Build code-server from pinned upstream source with no patches.
4. Add rootfs layout, user, sudo, user dirs, code-server settings.
5. Rewrite `rootfs.ts` from the Deployery persistence behavior.
6. Add supervisor and entrypoint.
7. Add `config.ts`.
8. Add `gateway.ts` proxy, health, readiness, metrics, TLS, and ready logs.
9. Add XDG, mailcap, and `agentbox.desktop` file-open integration.
10. Add unit tests.
11. Add Docker smoke test in GitHub Actions.
12. Add Renovate.
13. Add Trivy scan.
