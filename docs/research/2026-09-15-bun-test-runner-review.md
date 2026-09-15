# Bun Test Runner Review

Source: https://chatgpt.com/share/6aa94d66-4e9c-83eb-ab59-09da48cc2090

---

**User**

Context: A TypeScript project uses Bun's built-in test runner and does not want to add a separate test framework.

  Question: As of late 2026, what does Bun's test runner provide, what do serious projects actually use from it, and what do
  they still build themselves?

  Cover its current feature set and how recently each part arrived, including file discovery and filtering, lifecycle hooks,
  concurrency and isolation between test files, sharding and timing data, watch and changed-file selection, snapshots,
  mocking, coverage, reporters, randomization and seeding, and any configuration available through bunfig.toml rather than
  command-line flags.

  Then cover practice rather than documentation: named repositories that use it for a non-trivial suite, what they
  configure, what helpers they wrote themselves, and what they report missing. Include projects that adopted it and later
  left, with the stated reason, and projects that run it alongside another runner rather than instead of one.

  Evidence rules: cite the Bun repository, its changelogs and release notes, and third-party repositories, with dates and
  version numbers. Distinguish what is documented from what the repositories actually do. Where a feature is recent or
  unstable, say so. Do not assume the runner is sufficient or insufficient.

---

**ChatGPT**

I’ll separate this into two layers: Bun’s documented capabilities and release timeline, then repository evidence showing what substantial projects actually configure, extend, or avoid. I’ll also flag features that only arrived recently or still look operationally immature rather than treating the docs as proof of production sufficiency.

---

**ChatGPT**

The biggest change in the answer is recency: Bun 1.4 (August 20, 2026) is the first release where the runner has a credible “large suite” story—multi-process file parallelism, per-file isolation, sharding, timing-aware balancing, and changed-file selection all landed only in the 1.3.13→1.4 window. The older Jest-like API is much more mature than that infrastructure.

---

**ChatGPT**

One implementation detail matters for configuration: Bun’s docs now expose several `bunfig.toml` controls that are more expressive than the basic CLI—especially a single discovery `root`, `concurrentTestGlob`, and coverage policy/ignore settings. I’m checking those against the repository source rather than assuming every example on the rendered docs page maps to a real flag.

---

**ChatGPT**

As of **15 September 2026**, the latest stable Bun is **1.4.2**, released **5 September 2026**. The important distinction is that Bun’s **Jest-like testing API is fairly mature**, while its **large-suite orchestration layer is surprisingly new**: most of file isolation, multi-process execution, native sharding, changed-file selection, and timing-aware balancing arrived only between **Bun 1.3.13 (20 April 2026)** and **Bun 1.4.0 (20 August 2026)**. ([GitHub](https://github.com/oven-sh/bun/releases))

## What Bun actually provides now

| Area | Bun 1.4.x behavior | Age / maturity |
|---|---|---|
| **Discovery & filtering** | Recursively discovers `*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*` across JS/TS/JSX variants. Positional arguments filter by **path substring**, not glob; `-t/--test-name-pattern` filters test names. A literal file should be passed as `./path.test.ts`. `bunfig.toml` can set a single discovery `root` and `pathIgnorePatterns`; multiple roots are still not supported.   | Long-standing core behavior; not one of the recent 1.4 additions. |
| **Lifecycle** | `beforeAll`, `beforeEach`, `afterEach`, `afterAll`, async hooks, scoped hooks, preload-based global setup, and `onTestFinished`. Preload scripts can establish environment, globals and mocks. | Old API, but semantics were not frozen: **Bun 1.3 (10 Oct 2025)** substantially rewrote test/hook execution ordering to make it more predictable and closer to Vitest/Jest expectations. ([Bun](https://bun.sh/blog/bun-v1.3)) |
| **Concurrency inside a file** | Tests are sequential by default. `test.concurrent` or `--concurrent` overlaps async tests; `test.serial` opts individual tests back out; default max concurrency is 20. This is **same runtime/global/thread**, so it is I/O concurrency rather than CPU isolation. | **Bun 1.3, Oct 2025**. `concurrentTestGlob` was added as a bunfig migration mechanism. ([Bun](https://bun.sh/blog/bun-v1.3)) |
| **Isolation between files** | Plain `bun test` still loads files in **one process and one shared global/module environment**. `--isolate` gives every file a fresh JS global/module registry but stays in one process. `--parallel[=N]` creates worker processes and normally implies isolation; `--parallel --no-isolate` lets each worker reuse its global across assigned files. ([GitHub](https://github.com/oven-sh/bun/blob/main/docs/test/index.mdx)) | **Very recent: 1.3.13, 20 Apr 2026.** |
| **File-level parallelism** | `--parallel` distributes files among worker processes; output is buffered/grouped per file, worker IDs are exposed, and the coordinator merges things such as JUnit, coverage and snapshot results. | **1.3.13, Apr 2026**; still young infrastructure. ([Bun](https://bun.sh/blog/bun-v1.3.13)) |
| **Sharding** | `--shard=M/N` deterministically assigns sorted test files to shards. It composes with changed-file selection and randomization. | **1.3.13, Apr 2026**. ([Bun](https://bun.sh/blog/bun-v1.3.13)) |
| **Timing data / balanced shards** | `--timings=<file>` records per-file durations and `--update-timings` refreshes them. With timing data, Bun can balance shards/workers by expected duration instead of file count. | **Bun 1.4.0, 20 Aug 2026 — only weeks old.** There is already an open 1.4-era report that timings gathered under parallel contention can distort future balancing, so I would treat this as useful but not yet boring infrastructure. ([GitHub](https://github.com/oven-sh/bun/issues/28792)) |
| **Watch** | `bun test --watch` tracks dependencies and reruns affected tests rather than blindly restarting everything. | Mature relative to the new features; watch was already present by the **1.1 era (Apr 2024)**. ([Bun](https://bun.sh/blog/bun-v1.1)) |
| **Git changed-file selection** | `--changed` builds a test import graph plus Git changed-file set and runs transitively affected tests; `--changed=<ref>` chooses the comparison point. Combined with `--watch`, Git is requeried on each restart. | **1.3.13, Apr 2026.** ([Bun](https://bun.sh/blog/bun-v1.3.13)) |
| **Snapshots** | External snapshots, `-u` updates, inline snapshots, error/property snapshots and serializer support. | Basic snapshots were already advertised in **Bun 1.0 (Sep 2023)**; **inline snapshots arrived in Bun 1.2 (22 Jan 2025)**. ([Bun](https://bun.sh/blog/bun-v1.0)) |
| **Mocking** | `mock`/`jest.fn`, spies, module mocking for ESM and CJS, and live updated bindings. Preloading a mock lets it win before imports occur. Bun still explicitly does **not** implement Jest's `__mocks__` directory/automatic module mocking model. | Function mocks are 1.0-era; **`mock.module()` was added in Bun 1.1 (1 Apr 2024)**. ([Bun](https://bun.sh/blog/bun-v1.1)) |
| **Coverage** | Built-in line/function coverage, console text and LCOV output, configurable thresholds and path exclusions. It covers files actually loaded during the run rather than doing Jest-style “collect every source file” discovery. `statements` is accepted in threshold config but currently not enforced.  | Text coverage was part of the 1.0 proposition; **LCOV arrived in Bun 1.2, Jan 2025**. ([Bun](https://bun.sh/blog/bun-v1.2)) |
| **Reporters** | Normal console output, dots, JUnit XML, automatic GitHub Actions annotations. Custom reporting exists through Bun's lower-level WebKit Inspector/TestReporter plumbing rather than the familiar arbitrary JS reporter-module API of Jest/Vitest. Current JUnit reporting also has limitations around per-test stdout/stderr and precise test timestamps. | **JUnit was added in 1.2, Jan 2025**. ([Bun](https://bun.sh/blog/bun-v1.2)) |
| **Random order / seed** | `--randomize`; Bun prints the seed. `--seed=N` reproduces the order and itself enables randomization. Same controls exist in bunfig. | **Bun 1.3, Oct 2025**. ([Bun](https://bun.sh/blog/bun-v1.3)) |

So the execution model is worth making explicit:

**`bun test` ≠ Jest/Vitest-style per-file isolation by default.** A normal run shares process, JS global and module state across test files. `--isolate` changes the realm/module isolation, while `--parallel` is what introduces multiple OS processes. `test.concurrent` is a third and separate thing: concurrency among tests *inside one file*. 

That distinction explains a lot of real-world Bun test behavior around `mock.module`, environment variables, singleton caches and leaked resources.

### How stable are the new isolation features?

They are usable, but I would not mentally group them with `expect()` or `beforeEach()` yet. File isolation and multiprocessing only landed in April 2026. During the following months Bun received reports involving memory retention between isolated files, Linux resource/epoll flakes, and a Bun 1.4.0 regression combining `--isolate`, `mock.module()` and spawned processes. In other words, the design is now there, but 2026 has still been a stabilization cycle rather than years of battle-testing. ([GitHub](https://github.com/oven-sh/bun/issues/31771))

## `bunfig.toml` matters more than it first appears

The current `[test]` configuration is not just a place to persist CLI switches. Bun documents `root`, `preload`, `pathIgnorePatterns`, `smol`, `concurrentTestGlob`, `randomize`, `seed`, `retry`, `rerunEach`, the coverage settings, and `[test.reporter] junit`. 

The especially interesting configuration-only or configuration-richer pieces are:

- **`root`** — a single discovery root. There is no corresponding multi-root facility; the docs explicitly say an array is unsupported.
- **`concurrentTestGlob`** — lets only selected files opt into concurrent tests. CLI `--concurrent` is all-or-nothing.
- **Coverage policy** — `coverageThreshold`, `coverageSkipTestFiles`, `coveragePathIgnorePatterns`, `coverageIgnoreSourcemaps`; CLI is much more oriented around “turn coverage on / choose output”.
- **Persistent randomization** — `randomize` plus a fixed `seed`.
- **JUnit destination** through `[test.reporter]`.

Many others simply persist CLI options: preload, path-ignore, retries, reruns, coverage reporters/directories, etc. Current coverage documentation also contains an implementation wrinkle worth knowing: `statements` can be supplied as a threshold key but is not currently enforced, and historically some threshold enforcement has differed depending on reporter/mode. 

## What substantial repositories actually do

The repositories tell a more useful story than the API checklist.

| Repository | Actual practice |
|---|---|
| **oven-sh/bun itself** | Bun naturally uses `bun:test`, but **does not simply run one giant `bun test` command for its own CI**. Current `scripts/runner.node.mjs` says explicitly that it launches `bun test` processes itself, including separate processes “to catch crashes”; the wrapper has its own shard/max-shard model, CI retries, include/exclude rules, time budgets, JUnit handling, Buildkite integration and PR-file selection.  Its global `test/harness.ts`, loaded throughout the repository, additionally supplies platform/CI predicates, deterministic environment normalization, executable/process helpers and substantial fixture infrastructure.  |
| **elysiajs/elysia 1.4.30** | Uses plain **`bun test` for the functionality suite**, but its top-level `test` also runs a TypeScript type-check suite and separate Node CJS/ESM compatibility checks.  It builds small domain helpers itself: HTTP `req`/`post`, multipart upload fixtures and timing helpers live in `test/utils.ts`.  This is a good example of “use Bun for test semantics, own the application fixture layer.” |
| **honojs/hono 4.13.8** | Does **not** treat Bun as the universal runner. Its main suite remains `tsc … && vitest --run`; coverage is Vitest. A separate `test:bun` command runs Bun-specific runtime tests with `bun test`, alongside Deno and other runtime lanes.  This is a clear example of running Bun's runner **alongside**, not instead of, another framework. |
| **gruntwork-io/runbooks** | Backend unit tests use Bun directly and manually exclude web/docs/e2e/integration paths. Web tests are Vitest/jsdom, Node integration tests use Vitest, and end-to-end tests use Playwright. The repository comment records why its integration lane was separated: at the time, **Bun 1.3.x lacked a Node TLS API it needed**.  That statement is historical, not a claim that every 1.4.x build still lacks the API. |
| **mweinbach/agent-coworker** | A 2026 test-suite audit reports a suite on the order of **658 files / 7,500+ tests**. The project had introduced a per-file subprocess runner after encountering Bun crashes and cross-file module-mock leakage; that wrapper was later removed, while the audit still calls out extensive `mock.module`, DOM-global and environment-state usage as sources of suite coupling. This is unusually useful evidence of the boundary between Bun's primitives and the isolation discipline a large suite still needs. ([GitHub](https://github.com/mweinbach/agent-coworker/blob/main/test-suite-audit.md)) |

That Bun itself still has a substantial orchestration script is not proof that `--parallel` or `--shard` are inadequate. Much of that infrastructure predates the native 2026 features and also covers Bun-specific requirements such as runtime crash detection, Node compatibility testing and Buildkite topology. But it is strong evidence for a narrower claim: **a serious test suite normally needs more than a runner API**.

### A project that backed away from `bun test`

**TideWatch** gives a particularly clean stated reason. During its December 2025 migration to Bun for runtime/package-management work, project guidance started saying to run `bun test`, while the project still had a Vitest/jsdom test setup. In **3.5.6 on 15 December 2025**, its changelog records CI failures with `document is not defined`: `bun test` was not consuming the `vite.config.ts` test/jsdom configuration, so the project changed CI and its coverage script back to **Vitest**. ([GitHub](https://github.com/homelabforge/tidewatch/blob/main/CHANGELOG.md))

That should not be interpreted as “Bun cannot test DOM code”. Bun can run DOM libraries when you establish the environment explicitly. The practical lesson is that Bun does **not** magically consume another runner's configuration model. Migrating `vitest` → `bun test` means porting setup/environment configuration, not just changing the command.

## What projects tend to rely on Bun for, versus build themselves

In the repositories above, the stuff people happily take directly from Bun is the **testing language**: `test`/`describe`, `expect`, hooks, spies/mocks, snapshots, filtering, retries, Bun-native TypeScript execution, and—where applicable—coverage. The brand-new `--changed`, `--parallel`, `--shard` and timing machinery is much less entrenched simply because almost all of it is less than five months old.

What they still commonly own is a different layer: **test infrastructure**. That means database/schema creation and teardown, unique ports and temp directories, HTTP/request builders, fake services, Docker/service lifecycle, DOM/global installation, deterministic environment normalization, cross-runtime compatibility lanes, type-level tests, crash containment, CI matrix logic, and—in difficult suites—process-level isolation around tests that mutate global module state.

That is particularly relevant to Bun's module mocking. `mock.module()` is capable, but module mocks mutate the running module graph. In a default shared-process suite, that makes cleanup and architecture matter more than it does in an automatically per-file-isolated runner. Native `--isolate` is the 2026 answer, but the ecosystem evidence predates and overlaps its stabilization period.

## What is still conspicuously absent or limited

I would classify the remaining gaps into three groups rather than saying “Bun lacks serious-testing features.”

First, there are concrete feature gaps: Jest-style **automatic `__mocks__`**, branch/full statements coverage semantics comparable with Istanbul, collect-coverage-from-unimported-files behavior, and richer mature reporter integrations are not equivalent to Jest/Vitest today. Bun's current docs themselves explicitly temper the old “Jest-compatible” label by saying compatibility is an aim and not everything is implemented. 

Second, there is **configuration ecosystem compatibility**. A Vite/Vitest `test.environment = "jsdom"` setting is not Bun configuration; projects such as TideWatch had to discover that explicitly. Likewise, framework-specific plugins and reporter ecosystems do not transfer automatically. ([GitHub](https://github.com/homelabforge/tidewatch/blob/main/CHANGELOG.md))

Third, the big-suite scheduling layer is **new rather than obviously deficient**. Native process parallelism, isolation, sharding and Git-aware selection arrived in 1.3.13, and timings in 1.4.0. The latter already has a live report around parallel timing distortion. It is reasonable to use these features, but equally reasonable for a production CI setup to keep its sharding simple and validate the new modes against its own suite before deleting mature custom orchestration. ([Bun](https://bun.sh/blog/bun-v1.3.13))

## Bottom line for a TypeScript project that wants no second test framework

On **Bun 1.4.2**, avoiding Jest/Vitest is no longer synonymous with giving up snapshots, module mocks, coverage, watch mode, randomization, CI reports, file isolation or sharding. Bun has all of those categories now.

The trade is elsewhere: **you are choosing Bun's testing primitives plus your own project-specific harness**, rather than buying into the broader Jest/Vitest ecosystem. For a server/library TypeScript project, that can be a perfectly coherent arrangement. The repository evidence suggests keeping expectations realistic: use Bun for assertions, hooks, mocks, snapshots and execution; expect to own service/database fixtures, environment setup, resource allocation and cross-runtime checks; and treat the **1.3.13–1.4 large-suite features as recent infrastructure worth validating**, not as long-settled behavior.

The most misleading description in either direction would therefore be “Bun test is just a lightweight runner” or “Bun test is now a drop-in Jest/Vitest replacement.” In late 2026 it is closer to **a substantial native test framework with a young orchestration layer and a deliberately smaller ecosystem around it**.
