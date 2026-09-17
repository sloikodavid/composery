# Document Env Loading Rules

Source: https://chatgpt.com/share/6aac0b70-30a0-83eb-8349-5e370b358e87

---

## Turn 1: User

_2026-09-17T13:58:19.286Z_

As of September 2026, document how Bun, Node.js (`--env-file`), Next.js, Vite and dotenvx load `.env` files: which file names each loads for development, production and tests, in what order, which are meant to be committed, and how `NODE_ENV=test` changes the set. Then survey how projects supply credentials that only one opt-in test suite may use, so that the ordinary test run never has them in its process environment, including example files kept beside the real ones and checks that keep examples in sync with the variables code reads. Include documented incidents in which a test run picked up a real credential from an automatically loaded file or the shell, including the HAPI incident of May 2026 if you can find it, and what those projects changed.

---

## Turn 2: ChatGPT

_2026-09-17T13:58:40.900Z_

I’ll build this from primary docs first, then trace real test-credential incidents (including the May 2026 HAPI case) and extract the concrete mitigations those projects adopted. I’ll distinguish framework behavior from conventions, because the `.env` precedence rules differ in a few subtle but important ways.

---

## Turn 3: ChatGPT

_2026-09-17T13:59:11.855Z_

One important distinction is already clear: HAPI’s May 2026 failure was **ambient shell inheritance**, not merely dotenv precedence. Its fix went beyond changing file names—it removed whole-environment spreading, used an allowlist, generated throwaway credentials, isolated storage, and made setup fail closed.

---

## Turn 4: ChatGPT

_2026-09-17T14:01:37.349Z_

The loaders split into three families: **automatic convention loaders** (Bun, Next, Vite), **explicit-only Node** (`--env-file`), and **dotenvx, which is explicit by default but can opt into Next/flow conventions**. The sharpest test-mode difference is that Next and current Bun suppress plain `.env.local` under test; Vite does not.

---

## Turn 5: ChatGPT

_2026-09-17T14:05:32.100Z_

As of **17 September 2026**, the most important distinction is that the ecosystem does **not** share one dotenv convention. Bun, Next.js and Vite have automatic conventions; Node’s `--env-file` is entirely explicit; dotenvx is explicit by default and only becomes mode-aware when you opt into a convention.

### 1. What each loader actually loads

The table below gives **effective file precedence from highest to lowest**. “Shell” means a variable already present in the process environment before dotenv processing.

| System | Development | Production | Test | What `NODE_ENV=test` changes |
|---|---|---|---|---|
| **Bun** | `.env.development.local` → `.env.local` → `.env.development` → `.env` | `.env.production.local` → `.env.local` → `.env.production` → `.env` | `.env.test.local` → `.env.test` → `.env` | Selects the `test` pair **and suppresses plain `.env.local`**. Bun documents the files in the reverse order, as increasing precedence. ([GitHub](https://github.com/oven-sh/bun/blob/main/docs/runtime/environment-variables.mdx)) |
| **Node `--env-file`** | Whatever files you name | Whatever files you name | Whatever files you name | **Nothing.** Node has no development/production/test naming convention. Existing shell variables beat files; among multiple `--env-file` arguments, later files beat earlier ones. ([Node.js](https://nodejs.org/api/cli.html)) |
| **Next.js** | shell → `.env.development.local` → `.env.local` → `.env.development` → `.env` | shell → `.env.production.local` → `.env.local` → `.env.production` → `.env` | shell → `.env.test.local` → `.env.test` → `.env` | Selects `.env.test*`, stops loading development/production files, and **does not read `.env.local`**. ([GitHub](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/environment-variables.mdx)) |
| **Vite, mode=`development`** | shell → `.env.development.local` → `.env.development` → `.env.local` → `.env` | — | — | `NODE_ENV` itself does **not** choose the files. Vite’s **mode** does. ([vitejs](https://vite.dev/guide/env-and-mode)) |
| **Vite, mode=`production`** | — | shell → `.env.production.local` → `.env.production` → `.env.local` → `.env` | — | Same point: `vite build` happens to default to production mode, but mode and `NODE_ENV` are distinct. ([vitejs](https://vite.dev/guide/env-and-mode)) |
| **Vite, mode=`test`** | — | — | shell → `.env.test.local` → `.env.test` → `.env.local` → `.env` | Merely exporting `NODE_ENV=test` does **not** create test mode. Use `--mode test`, or a runner such as Vitest whose default Vite mode is `test`. ([Vitest](https://main.vitest.dev/config/?utm_source=chatgpt.com)) |
| **dotenvx, default** | `.env` | `.env` | `.env` | **Nothing.** Plain `dotenvx run`/`config()` defaults to `.env`; select alternatives explicitly with `-f`. ([Dotenvx](https://dotenvx.com/docs/sdk/nodejs/config/?utm_source=chatgpt.com)) |
| **dotenvx `--convention=nextjs`** | Next.js ordering | Next.js ordering | Next.js ordering | Opts into the Next convention, so `NODE_ENV` becomes significant and the test convention excludes plain `.env.local`. Dotenvx documents that this mode uses Next.js’s convention. ([GitHub](https://github.com/dotenvx/dotenvx)) |
| **dotenvx `--convention=flow`** | `.env.development.local` → `.env.development` → `.env.local` → `.env` | analogous production files | `.env.test.local` → `.env.test` → `.env.local` → `.env` | `NODE_ENV=test`—or dotenvx’s preferred `DOTENV_ENV=test`—selects the test-specific pair. Unlike the Next convention, flow continues to include `.env.local`. ([Dotenvx](https://dotenvx.com/docs/cli/run-convention-flow/?utm_source=chatgpt.com)) |

There are some consequential details behind that table.

**Bun.** Bun’s current documentation explicitly says it automatically reads `.env`, the `NODE_ENV`-specific file, `.env.local` except under test, and the `NODE_ENV`-specific `.local` file, in increasing precedence. It now also has `--no-env-file`, specifically recommended for environments such as production or CI where you want only system-provided variables. Explicit `--env-file` still works when auto-loading is disabled. When Bun is being used as a `node` replacement through its Node-compatible invocation paths, current Bun disables its automatic dotenv loading so tools such as Vite can perform their own mode-aware resolution. ([GitHub](https://github.com/oven-sh/bun/blob/main/docs/runtime/environment-variables.mdx))

**Node.** `node --env-file=.env --env-file=.env.test …` means exactly those two files. Node gives no special interpretation to those names or to `NODE_ENV=test`. A subtle security property is that a variable already exported by the parent shell wins over *every* `--env-file` value; later env files override earlier files, but they do not dislodge the ambient shell value. Thus “load a test env file” is not, by itself, sufficient protection from an accidentally exported production credential. ([Node.js](https://nodejs.org/api/cli.html))

**Next.js.** Its lookup is variable-by-variable and stops as soon as a value is found: `process.env`, then `.env.$NODE_ENV.local`, then plain `.env.local` except during tests, then `.env.$NODE_ENV`, then `.env`. If `NODE_ENV` is absent, `next dev` assigns `development`, while other Next commands assign `production`. The test exception deliberately suppresses `.env.local` to make test defaults reproducible. ([GitHub](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/environment-variables.mdx))

**Vite.** Vite always considers `.env` and `.env.local`, plus the two mode files. Its source constructs them as `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local`, with later duplicates winning, while already-existing process variables retain highest priority. Consequently Vite's test mode differs materially from Next/Bun test mode: **plain `.env.local` remains in the set**. Also, Vitest defaults Vite’s mode to `test`; this is a Vitest convention, not an effect of `NODE_ENV=test`. ([GitHub](https://github.com/vitejs/vite/blob/main/packages/vite/src/node/env.ts?utm_source=chatgpt.com))

**dotenvx.** Explicit composition has another unusual precedence rule: with `dotenvx run -f .env.local,.env`, the **first file wins**, and an already-existing process variable wins over both. `--overload` reverses that philosophy: later files can overwrite prior files and ambient values. Dotenvx additionally has an encrypted-env exception to the “explicit only” description: a suffixed private key such as `DOTENV_PRIVATE_KEY_CI` tells it to load the corresponding `.env.ci`. ([GitHub](https://github.com/dotenvx/dotenvx))

### 2. Which files belong in Git

“Loaded automatically” and “meant to be committed” should be treated as separate questions.

| System | Repository convention |
|---|---|
| **Bun** | Bun itself does not assign a Git policy to each filename. Do not infer that `.env`, `.env.test`, etc. are safe merely because Bun recognizes them. Bun’s ability to disable automatic loading is the stronger production/CI boundary. ([GitHub](https://github.com/oven-sh/bun/blob/main/docs/runtime/environment-variables.mdx)) |
| **Node** | No Git convention at all; filenames are user-selected. |
| **Next.js** | `create-next-app` currently puts **all `.env` files** in `.gitignore` and says you almost never want to commit them. The test documentation makes a specific exception/convention: `.env.test` should contain shared test defaults and be committed, while `.env.test.local` should not. Those committed defaults therefore must not be real credentials. ([GitHub](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/environment-variables.mdx)) |
| **Vite** | `.env.local` and `.env.<mode>.local` are explicitly local-only/ignored. Plain `.env` and `.env.<mode>` may serve as shared configuration, but secrets do not belong in client-exposed `VITE_*` variables because those are bundled into application code. ([vitejs](https://vite.dev/guide/env-and-mode)) |
| **dotenvx** | Plaintext dotenv files can be gitignored; `dotenvx precommit` checks that env files are either ignored or protected. Its alternative model is to **commit encrypted `.env` files** while keeping the private material such as `.env.keys` out of Git. Dotenvx explicitly describes encrypted `.env` as safe to commit and tells users to ignore `.env.keys`. ([GitHub](https://github.com/dotenvx/dotenvx)) |

For test fixtures, a good rule is therefore: **committed files may contain names, harmless deterministic values, localhost endpoints, and dummy credentials; never live authorization material.**

### 3. Credentials for one opt-in live/integration suite

The strongest pattern I found is more restrictive than simply having `.env.test.local`.

The ordinary test command and the credentialed test command are separate entry points. The live credentials live under a filename that the normal runtime does **not automatically recognize**, for example `.env.integration`, `.env.live-test`, or `.credentials/e2e.env`. That real file is ignored. Beside it sits a committed `.env.integration.example` containing the same variable names, comments, and harmless placeholders. The live launcher then constructs a **fresh/allowlisted child environment** and loads that one file; it should not begin with `{...process.env}`. The ordinary launcher likewise strips the dangerous variable names—and, when Bun is involved, uses `--no-env-file` so a repository `.env*` cannot silently repopulate them.

That final environment-scrubbing step matters. With Node, for example, this is unsafe if `PROD_API_KEY` is already exported:

```text
node --env-file=.env.integration tests/live.mjs
```

because Node deliberately gives the inherited shell value precedence. ([Node.js](https://nodejs.org/api/cli.html)) The robust form is conceptually “start with `PATH`, `HOME`, temp-directory variables and deliberate test configuration; then add the integration credentials,” rather than inheriting the complete developer shell.

There are several current examples of the separate-file convention. **Confluent’s `mcp-confluent`** expects an ignored `.env.integration` and commits `.env.integration.example`; contributors can either copy the example or have `make setup-test-env` fetch credentials from Vault into `.env.integration` with mode `0600`. Individual test groups declare the subset they need, and groups without populated credentials skip rather than requiring everybody to provision every secret. ([GitHub](https://github.com/confluentinc/mcp-confluent/blob/main/CONTRIBUTING.md)) **1browser** similarly keeps `.env.integration.example` beside an ignored `.env.integration` for its real-browser suite, which uses a dedicated test account. ([GitHub](https://github.com/the1browser/1browser)) **Creatify’s TypeScript SDK** documents the same `cp .env.integration.example .env.integration` setup and separates `test:integration` from its unit-test path. ([GitHub](https://github.com/TSavo/creatify-api-ts))

There is an important distinction between **opt-in execution** and **credential absence**. A project can have `npm test` mocked and `npm run test:live` real, yet still expose a credential to the ordinary test process if the key is exported globally or an automatic dotenv loader runs first. If the stated requirement is literally “ordinary test never has it in `process.env`,” verify that property at process creation, not merely by promising the unit tests will not use the key.

A useful belt-and-suspenders test is to make the normal suite fail immediately if any live-only name exists:

```js
for (const key of LIVE_ONLY_KEYS) {
  if (process.env[key] !== undefined) {
    throw new Error(`${key} must not exist in the ordinary test environment`)
  }
}
```

That turns environment isolation into a tested invariant. For networked SDKs, combine it with a default-deny network policy or global mock so that an unmocked HTTP call fails instead of billing an API.

### 4. Keeping `.example` files synchronized with what code actually reads

There are three levels of assurance here.

**Generating the example from the real env file is the weakest.** `dotenvx genexample` can derive `.env.example` from one or several real env files while blanking values. That is convenient, but it only proves “the example matches these files”; it cannot prove “the example matches every variable the program reads.” ([GitHub](https://github.com/dotenvx/dotenvx))

**Static scanning closes that gap.** A current example is `envsniff`: its `check` command scans code for environment-variable usage, fails when a variable used by code is absent from `.env.example`, and with `--fail-on-stale` also rejects example entries no longer seen in code; `--strict` enables both classes of drift for CI. ([PyPI](https://pypi.org/project/envsniff/?utm_source=chatgpt.com)) For a JavaScript/TypeScript repository, the same check is straightforward to implement with an AST over `process.env.NAME`, `process.env["NAME"]`, `import.meta.env.NAME`, and whatever env helper APIs the project permits, with an explicit allowlist for runtime-owned names such as `NODE_ENV`, `CI`, `PATH`, etc.

**A schema/config module as the source of truth is stronger still.** Instead of letting arbitrary application modules read `process.env`, define every supported variable in one typed schema, have application code import validated configuration from that module, and generate `.env.example` from the schema. `dotenv-gad`, for example, exposes `sync` to generate/update `.env.example` from its schema and `check` to validate environments against it. ([GitHub](https://github.com/kasimlyee/dotenv-gad?utm_source=chatgpt.com)) This structure makes “the names code reads” and “the names documented in the example” converge on the same source rather than trying to reconcile two independently maintained lists.

For live-test files I would make the CI invariant stricter: the key set of `.env.integration.example` should equal the declared `LIVE_TEST_ENV_KEYS` schema/set, and production code should be unable to read those values except through the live-test bootstrap. That makes stale example variables and newly introduced, undocumented credentials both hard failures.

### 5. Incidents: how real credentials reached tests

| Incident | Failure mechanism | Change made |
|---|---|---|
| **tiann/hapi, 31 May 2026** | `cli/vitest.config.ts` did `env: { ...process.env, ...testEnv }`. Developers who normally had real `CLI_API_TOKEN` and `HAPI_API_URL` exported therefore passed those credentials into `pnpm test`; the runner integration test connected to the contributor’s real, often production, HAPI hub. The local `.env.integration-test` was not guaranteed to exist, so nothing displaced the shell values. ([GitHub](https://github.com/tiann/hapi/issues/757)) | PR #734 removed whole-environment propagation, started a throwaway hub on a random local port, generated a disposable token, gave it an isolated `HAPI_HOME`/database, and overwrote the worker connection config. A review caught that the first version of the fix **still** inherited the full shell into the temporary hub; the final approach replaced that with an explicit whitelist, disabled external notification integrations, pinned `DB_PATH` under the temp directory, and changed missing setup state from silent fallback to fail-closed. ([GitHub](https://github.com/tiann/hapi/pull/734)) |
| **gstack / Bun wrapper, observed 20 Aug 2026** | `gstack-evidence` had a Bun shebang. Bun automatically populated the wrapper's environment from repository dotenv files, and the wrapper then spawned `npm test` without an `env` override. Thus a test command that saw no dotenv variables when run directly could see `.env`/mode/`.env.local` values when run through the wrapper; the project specifically notes that `.env.local` commonly contains production credentials. In the recorded Next.js case, four tests failed through the wrapper and passed directly because the wrapper had silently altered their environment. ([Upd.dev](https://upd.dev/garrytan/gstack/commit/ad8400543cd9ce8d07641362db48d44a95417e33?files=CHANGELOG.md&utm_source=chatgpt.com)) | gstack changed the child environment to remove keys identified as Bun-injected and added regression tests and key-name-only warnings. The commit also records fail-open limitations in its reconstruction logic. With current Bun, a cleaner boundary where possible is to invoke a credential-sensitive wrapper with `--no-env-file` and separately sanitize ambient shell variables. ([Upd.dev](https://upd.dev/garrytan/gstack/commit/ad8400543cd9ce8d07641362db48d44a95417e33?utm_source=chatgpt.com)) |
| **Claude Code issue #58083, user report, May 2026** | A reporter described a project API key reaching the environment via `.env`/direnv or shell state, followed by `pytest` running many tests without API mocks. The report says 47 of 53 tests in one file made real calls and attributes roughly 1,400 API calls in one session to this path. This is a user-filed incident report rather than an independently established maintainer postmortem, so the numbers should be treated as reported figures. ([GitHub](https://github.com/anthropics/claude-code/issues/58083)) | The reporter renamed the application credential so the surrounding tool would no longer consume the generic key and added a global `conftest.py` monkeypatch that blocks real API calls during tests. ([GitHub](https://github.com/anthropics/claude-code/issues/58083)) |
| **DatabaseCleaner / exported `DATABASE_URL`, 2018** | The DatabaseCleaner maintainers documented cases where developers ran a test suite while `DATABASE_URL` still pointed at a remote database—either because it had been exported for development or survived in an old terminal. Remote databases had been wiped. ([GitHub](https://github.com/DatabaseCleaner/database_cleaner/pull/521)) | DatabaseCleaner added a safeguard that detects a remote `DATABASE_URL` and raises unless explicitly opted out. The lasting lesson is the same as HAPI’s: test safety cannot assume the developer’s parent shell is benign. ([GitHub](https://github.com/DatabaseCleaner/database_cleaner/pull/521)) |

The **HAPI incident is especially instructive** because it demonstrates why “override the two obvious credentials” is not enough. Its first isolation patch protected the client-facing hub URL/token but still let unrelated production values such as `DB_PATH`, `TELEGRAM_BOT_TOKEN` and `ELEVENLABS_API_KEY` leak into the temporary server. The review forced the design from a **denylist/override model** to an **allowlist model**. ([GitHub](https://github.com/tiann/hapi/pull/734))

### Practical baseline

For a repository that has one live test suite needing real credentials, I would make the contract:

`npm test`/`bun test` starts from a sanitized environment, disables runtime dotenv auto-loading where necessary, and fails if any live-only key exists. The committed file is `.env.integration.example`; the ignored secret-bearing sibling is `.env.integration`. Only `test:integration:live` reads that file, and its bootstrap passes an allowlisted environment to the test child rather than spreading `process.env`. CI checks the example against either an environment schema or an AST scan of env reads. Live tests also use a dedicated low-privilege account/project and a default-deny network or SDK mock in every non-live suite.

That design is stronger than relying on `NODE_ENV=test`: **Next and Bun help by excluding `.env.local`, but Vite does not; Node does nothing automatically; and no one of these conventions removes a production credential that was already inherited from the shell.** ([GitHub](https://github.com/oven-sh/bun/blob/main/docs/runtime/environment-variables.mdx))

---

If you want, I can:

- Continue detailing how to test environment variable isolation
- Expand on handling .env.example synchronization with code
- Elaborate additional real-world incidents and mitigation strategies
