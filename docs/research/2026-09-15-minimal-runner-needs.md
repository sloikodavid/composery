# Minimal Runner Needs

Source: https://chatgpt.com/share/6aa92dab-bc10-83ed-a0f1-f1914d619104

---

**User**

Context: A repository uses a runtime whose built-in test runner provides test declaration, assertions, lifecycle hooks and filtering, and nothing else. The team does not want to add a separate test framework.

Question: What does a project actually need beyond a minimal runner, and how do teams provide it without adopting a framework?

Cover: fixtures and resource lifecycle, including cleanup after failure and after an interrupted run; parallelism and isolation between tests; parameterised cases; time control; randomness and seeds; assertion helpers and when a custom one is worth writing; and reporting when a test fails in a way a person must diagnose.

Also cover what teams say they missed after leaving a heavier framework, and what they were glad to be rid of.

Evidence rules: cite repositories that do this and describe how, with dates. Include cases where a project reverted to a framework, and the reason given.

---

**ChatGPT**

I’ll treat the “minimal runner” as the runtime test primitive, not as a hidden framework substitute. I’m going to separate the genuinely necessary infrastructure from conveniences, then ground each point in public repositories/issues—including migrations away from and back to heavier frameworks, with dates and stated reasons.

---

**ChatGPT**

The evidence is already pointing to a useful distinction: teams rarely replace Jest/Vitest with “nothing.” They replace the *framework bundle* with a small test platform—ordinary helper modules, one or two focused libraries, process/CI conventions, and deliberately narrow abstractions. The hard parts are lifecycle across process interruption, isolation, deterministic nondeterminism, and failure diagnostics—not `test()` itself.

---

**ChatGPT**

A concrete theme from migration records: the “losses” are mostly *integrated conveniences*. Nodejs.org’s 2023 migration explicitly valued fewer dependencies, speed, native ESM, and dropping Jest’s reporters/coverage stack, while accepting that module-mapping mocks had to be rewritten. Separately, Node users specifically called out Jest’s partial-object matcher and easy class/module mocking as things they missed.

---

**ChatGPT**

A minimal runner is usually enough. What a serious project needs beyond it is not another framework so much as a **small test-support layer plus an execution policy**: resource ownership, isolation, deterministic control of time/randomness, a few domain-aware assertions, and failure diagnostics. The useful dividing line is whether those pieces remain ordinary imported code. Once the project starts reimplementing module interception, source transforms, browser environments, worker pools, snapshots, or a reporter/plugin architecture, it is effectively building a test framework.

### What to add, and what not to add

| Need | Framework-free form | Key rule |
|---|---|---|
| Fixtures/resources | Factories plus a per-test cleanup stack | Acquisition and cleanup belong together |
| Interrupted-run cleanup | Run IDs + external reaper/lease/TTL/scavenger | In-process hooks cannot clean up after a dead process |
| Parallelism | A tiny file sharder / CI matrix spawning separate runner processes | Parallelise isolated units rather than sharing mutable state |
| Isolation | Unique temp dirs, DB/schema names, ports, namespaces | Isolation is mostly a resource-naming problem |
| Parameterised tests | A loop that declares one named test per row | Prefer visible individual tests to a `test.each` clone |
| Time | Injected `Clock` for business time; focused fake-timer library when scheduling itself is under test | Do not make the whole suite depend on patched globals |
| Randomness | Explicit seed, deterministic PRNG, seed in failure output | Every random failure must be replayable |
| Assertions | Native assertions plus a very small domain helper module | Add an assertion only when it improves meaning or diagnostics |
| Reporting | Failure context + captured logs/artifacts + reproduction command; JUnit adapter only if CI requires it | Optimise output for the person diagnosing the failure |

That is roughly the model used by Node core itself. Its current test guide has a project-owned `common` support module and fixture module; `common` also detects leaked globals. It uses helpers such as `mustCall`/`mustSucceed` for asynchronous invariants, closes resources explicitly, recommends OS-assigned port `0` for safe parallel execution, and says tests should be written to make failures easy to debug. Test stdout/stderr is normally suppressed but included with a failed assertion, specifically because it can reveal where a CI hang occurred. ([GitHub](https://github.com/nodejs/node/blob/main/doc/contributing/writing-tests.md))

## Fixtures and lifecycle: make ownership the abstraction

The useful fixture primitive is not “fixture injection”. It is **scoped ownership**. A helper that creates a database, server, temporary directory or mock installation should either return its disposer with the resource or register that disposer immediately with the current test's cleanup scope. Register cleanup *before* doing the next fallible setup operation, execute cleanup in reverse order, and make disposers idempotent.

That handles ordinary failure well. If setup creates A and then creation of B throws, A is already registered. If the assertion throws, teardown still happens. If teardown itself fails, preserve the original test error and attach/report the cleanup error; only make cleanup the primary failure when the test itself succeeded.

This is also where small project-specific abstractions are valuable. Markpad provides a good recent example. Its Svelte stores can own effects and browser listeners that are correct to keep alive for the whole application but leak between tests in a shared jsdom environment. Its test guidance therefore says `SettingsStore.dispose()` must be paired automatically with the test-finished hook rather than relying on every test author to remember it. An abandoned store can otherwise react to a later test's `flushSync()` or storage event. ([GitHub](https://github.com/sftwrdotdev/Markpad/blob/master/AGENTS.md?utm_source=chatgpt.com)) The relevant migration/fix was made on **12 August 2026**. [Markpad's 12 Aug 2026 migration commit](https://github.com/sftwrdotdev/Markpad/commit/d1615e5b10fe0b87f174635f67ba353bd12c3b4a?utm_source=chatgpt.com)

An interrupted process is a different problem. `afterEach`, `finally`, shutdown handlers and disposers work only while code is still being allowed to run. `SIGKILL`, a crashed worker, machine loss, and many IDE/debugger “Stop” operations give your process no cleanup opportunity. Testcontainers-node's **11 September 2020** Ryuk request describes exactly this failure mode: a test starts containers in setup, the developer stops the debugger, no `afterEach`/`afterAll` runs, and containers accumulate. The solution class is an external reaper/watchdog rather than a better hook. ([GitHub](https://github.com/testcontainers/testcontainers-node/issues/118))

For non-container resources, the same idea can be simpler: tag every externally created thing with a test-run ID; use a lease/expiry where the service supports one; remove stale run-owned temp directories on the next startup; or have a parent process own child resources and destroy them when workers disappear. Signal cleanup is worth having as a best effort, but it should never be your only interrupted-run guarantee.

## Parallelism: solve isolation first

A minimal runner does not need an internal worker pool. A small script can discover test files, partition them across N workers, and start N independent runtime processes; CI can do the same with a matrix. **File/process isolation is usually the least surprising concurrency boundary.** Tests that mutate process-wide environment variables, current working directory, global monkey patches or module state then cannot contaminate another worker.

Inside each worker, external resources still need unique ownership. Use a fresh temp directory, unique database/schema/tenant name, unique queue/topic prefix, and let the OS allocate network ports rather than “finding” a supposedly unused one and releasing it before use. Node core's guide explicitly recommends listening on port `0` because it permits safe parallel tests. In the **18 July 2023** Node 18.17.0 release, several inspector/debugger tests were changed to random/port-0 allocation and then moved from the sequential set into the parallel set. ([GitHub](https://github.com/nodejs/node/blob/main/doc/contributing/writing-tests.md))

That is an instructive ordering: the fix was not “turn concurrency on”; it was **remove the shared resource collision, then turn concurrency on**.

Some tests should remain serial. A test of a single global lock, a fixed OS service, a process-wide installation, or a scarce physical device can legitimately be marked/partitioned into a serial lane. Trying to manufacture parallelism around intrinsically singleton state usually creates worse tests.

## Parameterised cases do not need a feature

For finite cases, ordinary language constructs are generally better than reproducing `test.each`:

```js
for (const c of cases) {
  test(`${c.name}: ${c.input}`, () => {
    assert.equal(transform(c.input), c.expected);
  });
}
```

The important part is that each row declares a separate, well-named test. That preserves filtering and gives the failure a useful identity. A five-line `cases()` helper can standardise naming if this pattern occurs everywhere, but once it has format strings, argument unpacking rules, `.only`, `.skip`, nesting, typing tricks and its own error wrapping, it has stopped paying for itself.

For a large combinatorial space, do not create a more sophisticated table helper. That is where a focused property-testing package can make sense independently of the test runner.

## Time: distinguish “what time is it?” from scheduling

Most application time should be controlled through an ordinary application seam:

```text
Clock.now()
```

Production gets a system clock; tests get a fixed or manually advanced clock. This is especially clean for expiry, billing periods, cache freshness, token validity and date calculations. The downside is that the clock dependency becomes part of the production design, but that is often desirable: dependence on wall-clock time is a real dependency whether the code admits it or not.

When the thing being tested is **timer machinery**—timeouts, debouncing, retry delays, intervals—a focused fake-clock package is appropriate without adopting its surrounding testing framework. `@sinonjs/fake-timers`, for example, can install only the timer/time globals, advance the clock deterministically, count leaked timers, and uninstall to restore the originals. ([GitHub](https://github.com/sinonjs/fake-timers?utm_source=chatgpt.com))

The project rule should be that global fake time is always registered for restoration at the moment it is installed. For ordinary business logic, prefer the injected clock because it does not affect unrelated code in the process.

Real sleeping should be rare. Node core's own test guidance says to avoid timers unless timers are actually the subject because they are a source of flakiness. ([GitHub](https://github.com/nodejs/node/blob/main/doc/contributing/writing-tests.md))

## Randomness: randomness is fine; irreproducible randomness is not

Give a run one explicit seed. Feed all test-data randomness from a deterministic PRNG, ideally derive a stable per-test seed from the root seed plus test identity so reordering or parallel scheduling does not change a test's values. On failure, print the root/test seed and provide a simple environment variable or command-line route for replay.

A focused package can do more without replacing the runner. fast-check is explicitly designed to run inside existing test blocks; it reports a seed for failed runs, supports exact replay with `seed` plus `path`, and shrinks the generated input to a smaller counterexample. Its current documentation describes the seed as replayable and its August 2026 examples show failure reports containing seed, path and the reduced counterexample. ([Fast Check](https://fast-check.dev/docs/api/interfaces/Parameters/?utm_source=chatgpt.com))

The practical rule is that `Math.random()`/equivalent should not directly generate correctness-critical test data. A nightly fuzz lane may deliberately choose a fresh seed, but that seed still has to be printed and retained when it fails.

## Assertion helpers: add semantics, not vocabulary

Native strict/deep/throws assertions should remain the default. A custom assertion earns its existence when it captures a recurring **domain invariant** or produces materially better evidence than several generic assertions.

Node's `common.mustCall` is a good example. Its value is not prettier syntax: it detects the otherwise easy-to-miss case where an expected asynchronous callback never happened. `mustSucceed` additionally refuses to ignore the error-first argument. Those helpers encode failure modes that normal end-of-test equality checks can silently miss. ([GitHub](https://github.com/nodejs/node/blob/main/doc/contributing/writing-tests.md))

A project-specific `assertHttpProblem`, `assertNoLeakedJobs`, `assertSameDomainRecord`, or `assertEventuallyConsistent` can similarly be worthwhile if its error tells the maintainer *why* the invariant failed and exposes useful actual values.

What is usually not worth building is a fluent matcher DSL merely to recover framework syntax. There is real ergonomic loss here: on **25 October 2023**, a Node user migrating from Jest specifically requested a native equivalent of `toMatchObject`, saying partial deep matching on large objects was one thing they missed. ([GitHub](https://github.com/nodejs/node/issues/50399?utm_source=chatgpt.com)) If a codebase repeatedly needs that operation, one well-tested `assertMatchObject()` is reasonable. Recreating dozens of `expect(...).toX()` matchers is not.

## Reporting: diagnostic context matters more than reporter architecture

A failing test should leave enough information that someone who was not watching it run can begin diagnosis. That normally means the full test name and file; actual/expected values and native diff; parameterised-case inputs; seed/replay information; relevant resource/run IDs; bounded stdout/stderr or a path to a retained log/artifact; and a copyable command for rerunning that test.

Do not catch a native assertion and replace it with `"test failed"`; that destroys the useful stack, diff and cause. If setup talks to a subprocess/service, capture its logs but reveal them primarily on failure—Node core follows exactly that pattern. ([GitHub](https://github.com/nodejs/node/blob/main/doc/contributing/writing-tests.md))

CI machine formats are a separate concern. When nodejs.org proposed moving from Jest on **16 November 2023**, it explicitly intended to keep generating JUnit reports even while removing Jest's reporter/coverage dependency stack. ([GitHub](https://github.com/nodejs/nodejs.org/issues/6123)) That is a good architecture: human-readable diagnostics live close to the tests; JUnit or similar is a thin transport adapter for CI.

## What people miss after leaving Jest/Vitest—and what they do not

The clearest migration record is nodejs.org's November 2023 proposal. The reasons for leaving Jest were fewer dependencies, substantially less test tooling, native ESM, speed, and the fact that the project did not need snapshots or other richer Jest features. It expected to remove Jest-related reporters and coverage generators while retaining JUnit output. The notable migration pain was module mocking: Jest's module-name mapping and `__mocks__` convention could not simply carry over and the mocks had to become explicit. ([GitHub](https://github.com/nodejs/nodejs.org/issues/6123))

The community reports line up with that. Besides partial-object matching, a **7 August 2023** Node help issue from a Jest user specifically struggled with replacing a class instantiated inside the module under test—common with SDK-style dependencies—and contrasted that with Jest's easy class mocking. ([GitHub](https://github.com/nodejs/help/issues/4220?utm_source=chatgpt.com)) This is often a useful design signal: if replacing a dependency requires loader magic, consider making that dependency injectable before adding loader magic to every test.

The migration is not confined to early adopters. Wretch's **19 October 2025** 3.0.0 changelog records “Remove jest in favour of node:test”. ([GitHub](https://github.com/elbywan/wretch/blob/master/CHANGELOG.md?utm_source=chatgpt.com)) Commander 15, released **29 May 2026**, switched its tests from Jest to `node:test` in the same release that made the library ESM-only; its notes explicitly call out test frameworks/bundlers as a potential ESM compatibility issue. ([GitHub](https://github.com/tj/commander.js/blob/master/CHANGELOG.md?utm_source=chatgpt.com))

So what teams are glad to lose is fairly consistent: dependency weight, configuration, transforms they do not require, framework-specific APIs, ESM friction, and integrated features they were not actually using. What they miss is also consistent: convenient module mocking, a few rich matchers, watch/coverage/reporting in one command, and—in UI/build-heavy projects—the ability to reproduce the application's transformed execution environment.

## When teams go back to a framework

There are important counterexamples, and they give a good boundary.

**Markpad, 12 August 2026**, deliberately ended up with **Vitest alongside `node --test`, not instead of it**. Plain TypeScript stays on the native runner. Svelte-runes modules and real-DOM tests use Vitest with the Svelte compiler and jsdom. The reason was correctness: the native-runner tests had hand-written `$state`/`$derived`/`$effect` shims whose semantics differed from compiled Svelte—most importantly, effects did not actually re-run—so a behavior test could pass against the imitation while the real application was wrong. The project explicitly says moving an ordinary passing TypeScript test to Vitest “buys nothing.” ([GitHub](https://github.com/sftwrdotdev/Markpad/blob/master/AGENTS.md))

**Wanta, by June 2026**, also moved tests from `node --test` back to Vitest in a build-related change. Its current decision record says an endpoint became a Vite `define` compile-time constant and the tests moved in the same change because Vitest gave them the native Vite transformation; otherwise they needed a runtime-injection hack. ([GitHub](https://github.com/oomol-lab/wanta/blob/main/docs/key-decisions.md)) That is almost the canonical case for adopting the framework: the framework is part of reproducing the production module/build semantics.

A third useful contrast is GEOLYTIX/xyz's current migration from its small Codi test framework to Vitest. Its stated reasons were not `describe` or assertions; Codi already had those. The server-side suite lacked dependency mocking, automatic discovery, coverage, watch mode and CI integration, and some tests were effectively un-runnable without a browser/live server. Vitest supplied that bundle and the project decided the bundle was worth having. ([GitHub](https://github.com/GEOLYTIX/xyz/blob/main/TESTING.md?utm_source=chatgpt.com))

That suggests a practical stopping rule: **do not adopt a framework because you need fixtures, tables, seeded randomness, a clock or better assertions. Those are small composable tools. Consider the framework when faithful testing requires the application's compiler/loader/browser transform environment, or when your home-grown support layer has accumulated mocking transforms, discovery, workers, watch mode, snapshots and reporter infrastructure.**

For the repository in your premise, I would keep the built-in runner and make `test/support/` an intentionally boring library: a cleanup scope, resource factories, clock/RNG helpers, a parameter-case helper if repetition warrants it, a handful of domain assertions, and a diagnostic recorder. Put parallel file execution in a separate script/CI layer. That gives most of what teams actually use from a framework without turning the test suite into a second application platform.
