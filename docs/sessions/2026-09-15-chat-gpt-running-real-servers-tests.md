# Running Real Servers Tests

Source: https://chatgpt.com/share/6aa94c2c-dc20-83ed-ac78-4694f6018c52

---

## Turn 1: User

_2026-09-15T13:38:17.979Z_

Context: A project's correctness depends on a backend server it does not want to simulate. The developers can run the real
  server locally as a separate process. They have no continuous integration.

  Question: How do projects run a real server process for their tests, and what goes wrong?

  Cover: starting one disposable instance per test run versus per test file versus sharing a long-lived one; how the
  instance is isolated from the developer's own working environment, including environment variables, configuration files,
  ports, temporary directories and credentials; how it is guaranteed to be shut down, including after a crash, an
  interrupted run, or a debugger stop; how the version of the server binary is controlled and what happens when it updates
  unexpectedly; how long startup costs in practice and what projects do about it; and how state is kept from leaking between
  tests.

  Use named examples across several ecosystems: databases, message brokers, provider emulators, headless browsers and
  application backends. Include at least one project that abandoned this approach, and say what it moved to.

  Evidence rules: cite repositories, issues and documentation with dates. Prefer evidence from harness code and CI
  configuration over prose in a README. Include concrete reports of leaked processes, port collisions, cross-contaminated
  state, or a test accidentally running against a developer's real environment.

---

## Turn 2: ChatGPT

_2026-09-15T13:38:26.118Z_

I’m going to treat “real server process” broadly as an actual server binary/emulator/browser launched for tests, whether directly as a child process or via a container wrapper. I’ll emphasize harness code and CI definitions, then use issues mainly for failure evidence (leaks, collisions, wrong-environment hits, state bleed).

---

## Turn 3: ChatGPT

_2026-09-15T13:38:54.282Z_

One pattern is already clear: projects usually optimize for one of three lifetimes—suite/session, file/worker, or test—and the failure modes map directly to that choice. Long-lived servers amortize startup but force explicit reset logic; per-test servers isolate state best but magnify startup and teardown races.

---

## Turn 4: ChatGPT

_2026-09-15T13:42:42.449Z_

The strongest safety evidence is environmental, not process-related: a May 31, 2026 HAPI bug report shows `pnpm test` inheriting a real API URL/token, silently writing sessions/runner/heartbeat rows to the production hub while the suite still passed. That is the failure to design against: a test endpoint should be *constructed* by the harness, not merely inherited and overridden when convenient.

---

## Turn 5: ChatGPT

_2026-09-15T13:43:34.242Z_

The pattern that survives across ecosystems is: **start one disposable server per test run, but give each test fresh logical state**. Starting a whole server per test maximizes isolation but is usually too expensive; sharing a developer-managed server is fastest but creates the nastiest correctness and safety failures. Per-file/per-class instances are a useful middle ground when parallelism or incompatible configuration makes one suite-wide server impractical.

Repository references below are current `main` as of **15 September 2026** unless an issue or release date is stated explicitly.

### The three useful lifetimes

| Lifetime | Where it appears | Advantages | Characteristic failures |
|---|---|---|---|
| **One disposable server per test run/session** | `pytest-postgresql`; Firebase `emulators:exec`; Grafana E2E | Startup paid once; harness owns server; easy to assign one temporary root and endpoint | Backend state must be reset between tests; a runner crash can orphan the process |
| **One per test file/class/worker** | Testcontainers/JUnit static `@Container`; browser/app-server worker fixtures | Better parallel isolation; different files can run incompatible configs | N files create N servers, ports and startup storms; file boundaries become accidental isolation boundaries |
| **One per test** | Testcontainers instance `@Container`; ad-hoc subprocess fixtures | Strongest state isolation | Startup dominates; shutdown races become frequent |
| **Long-lived developer server** | RabbitMQ `AMQP_URL`; kafka-go's manually started Compose stack; Playwright `reuseExistingServer` | Nearly zero startup cost | Version drift, stale state, fixed-port collisions, and potentially destructive tests against something the developer cares about |

Testcontainers' JUnit 5 integration makes the distinction unusually explicit: a static `@Container` is started once for the class and shared by its test methods; an instance field is started and stopped for every test method. Its documentation also warns that parallel execution of this integration is unsupported and may have unintended side effects. ([GitHub](https://github.com/testcontainers/testcontainers-java/blob/main/docs/test_framework_integration/junit_5.md))

`pytest-postgresql` illustrates what I think is the best default. Its `postgresql_proc` fixture is **session-scoped**: PostgreSQL starts on first use and stops after the tests. But its client fixture is function-scoped; after each test it terminates leftover connections and drops the test database. For expensive schemas, it loads a template database once and clones a clean database from it for every test. Thus process lifetime and state lifetime are deliberately different. ([GitHub](https://github.com/dbfixtures/pytest-postgresql))

### Isolation means isolating more than the port

A good harness treats the developer's shell and home directory as hostile input.

**Environment variables and credentials.** Do not simply inherit everything and override `SERVER_URL`. Both Firebase's and Playwright's launchers currently spread `process.env` into child processes before adding their own variables. Firebase then injects emulator endpoint variables and project configuration; its own source has explicit warnings for commands where an emulator variable is set but the operation will nevertheless affect production. ([GitHub](https://github.com/firebase/firebase-tools/blob/main/src/emulator/commandUtils.ts))

The danger is demonstrated rather than hypothetical. On **31 May 2026**, HAPI issue #757 reported that its Vitest configuration spread `...process.env`; contributors who had `CLI_API_TOKEN` and `HAPI_API_URL` exported for normal work then ran integration tests against their **real, often production, hub**. The tests passed while writing session, runner and heartbeat rows to production, producing “ghost sessions.” ([github.com](https://github.com/tiann/hapi/issues/757))

So for a local-only project I would create the server environment from a **whitelist**: `PATH` only if required, locale variables, the harness-created temp directory and port, deliberately fake/test credentials, and whatever test flags are necessary. Explicitly delete AWS/GCP/Azure credentials, production URLs, proxy settings where dangerous, and application-specific tokens. Before any destructive test setup, assert that the resolved endpoint is loopback and that the server returns some run-specific identity.

Firebase also provides a useful mitigation: demo project IDs are treated differently specifically because accidental production calls to a fake project will fail. ([GitHub](https://github.com/firebase/firebase-tools/blob/main/src/emulator/commandUtils.ts))

**Configuration files and home directories.** Never let a test server discover the developer's normal `~/.config`, database directory, browser profile or application home. Grafana's E2E harness constructs a separate run directory, copies test `custom.ini` and provisioning data into it, and starts the Grafana binary with an explicit `--homepath`, PID file and HTTP port. Its workflow similarly creates a standalone `grafana-server` directory rather than booting against the checkout's normal runtime state. ([GitHub](https://github.com/grafana/grafana/blob/main/scripts/grafana-server/start-server))

Browsers make the same point vividly. Playwright says an empty `userDataDir` creates a temporary profile, warns against pointing automation at the user's normal Chrome profile, and notes that two browser instances cannot safely use the same profile directory. ([GitHub](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-browsertype.md))

**Ports.** Prefer an OS-assigned/random port and pass the actual endpoint to tests. `pytest-postgresql` uses a random port for a spawned server; its externally managed `noproc` mode instead defaults to the conventional 5432, which is precisely why the latter is a different risk class. ([GitHub](https://github.com/dbfixtures/pytest-postgresql)) OpenTable's Postgres wrapper likewise exposes a random ephemeral host port. ([GitHub](https://github.com/opentable/otj-pg-embedded/blob/master/README.md))

Fixed ports eventually collide. Firebase issue #8007, opened **29 November 2024**, documents a particularly instructive case: Ctrl-C appeared to stop the Windows Pub/Sub emulator, but its old process remained; the next launch failed because port 8085 was still occupied. ([GitHub](https://github.com/firebase/firebase-tools/issues/8007))

A shared-broker setup makes collisions and cross-use easier. RabbitMQ's `amqp091-go` integration tests take `AMQP_URL`, but otherwise silently default to `guest:guest@127.0.0.1:5672`. Consequently, whatever RabbitMQ happens to own the developer's standard port becomes the test broker. ([GitHub](https://github.com/rabbitmq/amqp091-go/blob/main/integration_test.go)) Kafka-go's Compose setup similarly fixes host ports 9092/9093 and ZooKeeper 2181, although it at least pins Kafka 2.3.1 and creates explicit test topics. ([GitHub](https://github.com/grafana/segmentio-kafka-go/blob/main/docker-compose.yml))

**Temporary directories.** Give every run a newly created root; put data directories, Unix sockets, logs, PID files, browser profiles and generated configuration underneath it. For parallel workers, create a subdirectory per worker. Deleting the run root then becomes both cleanup and an orphan detector: if the previous run left a root plus live PID, you know something went wrong.

### Shutdown is not something `finally` can guarantee

Normal shutdown is straightforward: context manager / fixture finalizer → graceful server shutdown → wait with a deadline → kill the whole process tree if necessary.

Playwright's web-server harness shows a fairly mature implementation. Setup tears down if startup fails; normal teardown invokes the stored process killer. It can send SIGINT or SIGTERM to the entire Unix process group and wait for a configured grace period. Its launcher also checks whether the target URL is already occupied and, unless `reuseExistingServer` is enabled, refuses to proceed rather than silently attaching to somebody else's process. ([GitHub](https://github.com/microsoft/playwright/blob/main/packages/playwright/src/plugins/webServerPlugin.ts))

But **a finalizer cannot run after `SIGKILL`, a runner crash, power loss, or many IDE “Stop” operations**. Signal handlers cover Ctrl-C only when the process is allowed to handle the signal. Firebase registers shutdown handling for SIGINT, SIGTERM, SIGHUP and SIGQUIT and keeps PID/locator information, yet its code also contains logic to print PIDs of emulator subprocesses that “may still be running.” ([GitHub](https://github.com/firebase/firebase-tools/blob/main/src/emulator/commandUtils.ts))

And bugs happen. Firebase issue #2477, **21 July 2020**, reproduced `firebase emulators:exec --only firestore 'cat'`; Ctrl-C killed the test command but left the Java Firestore emulator alive, and the next invocation failed because its port was taken. ([GitHub](https://github.com/firebase/firebase-tools/issues/2477)) Playwright issue #26980, **9 September 2023**, reported Chromium processes accumulating after developers repeatedly Ctrl-C'd test runs, eventually driving laptop CPU usage up. ([GitHub](https://github.com/microsoft/playwright/issues/26980))

The only way to get substantially stronger guarantees is to move cleanup **outside the test runner**. Testcontainers does this with the Ryuk resource-reaper process; testcontainers-python explicitly integrated Ryuk for “better container cleanup” in release 4.1.0 on **19 March 2024**. A June **10, 2026** issue is revealing by exception: its `ComposeContainer` path lacked equivalent Ryuk cleanup, so containers could remain after crashes or force-stops. ([GitHub](https://github.com/testcontainers/testcontainers-python/blob/main/CHANGELOG.md))

For direct processes, the analogous design is an OS-level job/process group plus a tiny supervisor/watchdog. On Windows, a Job Object with kill-on-job-close is stronger than ordinary parent/child tracking. On Linux, a wrapper can use parent-death semantics; elsewhere a watchdog can observe the test runner PID. On the next test start, also reap any process carrying your run marker/PID file. You need both mechanisms: parent-death cleanup for abrupt termination and next-run recovery for cases it misses.

### Version control is part of test isolation

Using “whatever server is installed” makes the operating system's package manager part of your test input.

`pytest-postgresql`, unless configured otherwise, searches configured paths, `pg_config --bindir`, Windows PostgreSQL installations and finally `PATH` for `pg_ctl`. Convenient locally, but an OS/Postgres upgrade can silently change the server version used by the tests. ([GitHub](https://github.com/dbfixtures/pytest-postgresql))

Kafka-go documents the consequences directly: later Kafka versions caused subtle behavioural changes that broke historical tests, hence its examples use Kafka **2.3.1** and its Compose file pins a corresponding image. ([GitHub](https://github.com/segmentio/kafka-go))

Browsers are an especially good counterexample. Playwright couples each Playwright release to specific browser binaries and tells users to reinstall those browsers after Playwright upgrades. ([GitHub](https://github.com/microsoft/playwright/blob/main/docs/src/browsers.md)) When people opt out and use system Chrome, the system updater returns as an uncontrolled dependency: issue #41883, opened **20 July 2026**, reports Chrome auto-updating around July 17 from roughly 129 to 150.0.7871.125; without test/config changes, browser startup, navigation and OAuth flows became noticeably slower. ([GitHub](https://github.com/microsoft/playwright/issues/41883?utm_source=chatgpt.com))

For your case, I would therefore pin the server binary as an ordinary development dependency: exact version plus checksum, or an immutable image digest if containers are acceptable. A versioned tag is better than `PATH`; an image digest is better than a moving tag such as `latest`. Make upgrades explicit pull requests/commits, not consequences of `brew upgrade`.

### Startup cost is real, and it drives the lifecycle choice

The numbers vary enormously. A bare local daemon can start in tens or hundreds of milliseconds; JVM/provider emulators and complicated database images can take seconds to more than a minute.

A Testcontainers/Postgres report from **11 July 2020** had a custom Postgres image taking **1 minute 20 seconds**, already longer than the library's one-minute readiness timeout. A Testcontainers user on **1 July 2023** was experimenting with container reuse specifically to avoid waiting “about a minute” for MySQL during development. ([GitHub](https://github.com/testcontainers/testcontainers-java/issues/2990))

Firebase issue #3594, **21 July 2021**, measured the first Firestore-emulator query at **8.4 seconds**, a hot repeat at 36 ms and a new test app at about 3 seconds; the reporter ended up issuing a warm-up request before the real test because otherwise the suite cost roughly `number of tests × 3s`. ([GitHub](https://github.com/firebase/firebase-tools/issues/3594))

Even headless browser launch is material: a Playwright proposal opened **3 March 2026** measures **2–5 seconds of heavy CPU per browser launch** and proposes pre-warming a browser pool. Playwright's normal answer at the test level is more elegant: keep the actual browser running and give every test a cheap new `BrowserContext`. ([GitHub](https://github.com/microsoft/playwright/issues/39499))

Projects consequently amortize startup rather than pretending it does not exist. `pytest-postgresql` creates an expensive initialized template once and clones it per test. Grafana starts its server in the background while Playwright browsers install, then polls `/health` for up to 60 seconds instead of sleeping a fixed interval. ([GitHub](https://github.com/dbfixtures/pytest-postgresql/blob/main/CHANGES.rst))

The readiness probe matters: “process exists” or “TCP port opened” is often earlier than “server can correctly serve tests.” Poll an application-level health operation with a hard timeout and capture logs on failure.

### State leakage is usually the harder problem than launching the process

The rule is: **share the expensive process, not mutable test identity**.

For a database, allocate a database/schema per test, clone a template, or recreate it. Transactions alone are insufficient when background workers or separate connections write outside the transaction. `pytest-postgresql` has historical scar tissue here: its changelog records a bug where a random test subprocess could reconnect before a database was dropped, causing the drop to fail and cascading into many later setup failures. ([GitHub](https://github.com/dbfixtures/pytest-postgresql/blob/main/CHANGES.rst)) It also added an option to drop a leftover test database at the beginning of a new run specifically for cases where an earlier run ended before cleanup. ([GitHub](https://github.com/dbfixtures/pytest-postgresql/blob/main/CHANGES.rst))

For brokers, use a run/test prefix for **every** topic, queue, consumer group, exchange and durable subscription. RabbitMQ's integration suite performs explicit close/delete cleanup because the broker itself is shared. A fixed name on a long-lived broker is latent cross-test state; cleanup of a queue with a generic name is also capable of deleting a developer's own object.

For provider emulators, prefer a unique fake project/account per run or test plus an explicit clear/reset API. Firebase's emulator hub itself warns that multiple suites using the same project may cause “unexpected behavior.” ([GitHub](https://github.com/firebase/firebase-tools/blob/main/src/emulator/hub.ts))

For browsers, Playwright's isolation model is the archetype: one browser can be expensive and shared, while every test gets a fresh context containing its own cookies, local/session storage and other profile state. Its documentation specifically argues that trying to clean a reused environment is easy to get wrong—some state, such as visited-link state, is not realistically scrubbed—and recommends starting from a clean context. ([Playwright](https://playwright.dev/docs/browser-contexts?utm_source=chatgpt.com))

For application servers, backend data has to receive the same treatment. Grafana's current Playwright configuration explicitly serializes two test projects because they toggle the **same backend fixture**; the second declares a dependency on the first so they cannot modify it concurrently. ([GitHub](https://github.com/grafana/grafana/blob/main/playwright.config.ts)) That is a real example of browser-level isolation not being enough when the shared server has external state.

### An instructive abandonment

OpenTable's `otj-pg-embedded` is a particularly useful history because it **abandoned the native local-process form of this approach**. Pre-1.0 releases unpacked and ran native PostgreSQL tarballs. Version 1.0, released **31 January 2022**, moved to Docker/Testcontainers and the official PostgreSQL image. The maintainers cite Apple/Windows/Linux ARM, the disappearance of universal PG10+ Linux binaries, maintenance/security costs and cross-platform consistency as reasons. Earlier issue #142, **2 April 2020**, is representative of the native-process pain: an integration test inside Jenkins/Docker failed because `initdb` refused to run as root. ([Maven Repository](https://mvnrepository.com/artifact/com.opentable.components/otj-pg-embedded/1.0.0))

It was not a free win. OpenTable says the container approach is **2–5× slower** than its old tarball launcher and explicitly observes that increasing the server lifetime improves speed but can make tests non-reproducible when they modify the same tables. ([GitHub](https://github.com/opentable/otj-pg-embedded/blob/master/README.md)) In other words, they traded native-process speed for packaging and lifecycle isolation.

### What I would build for a project with no CI

I would make the ordinary `test` command own a **single disposable server for the complete run**, with no dependency on a separately started developer instance. The developers may still be able to opt into a long-lived server for fast exploratory work, but that should be a visibly different command/mode.

The harness contract would be:

- Resolve an **exact pinned server binary** from the project/tool cache, not from an unqualified `PATH`; record its version in test output.
- Create one unique run root containing data, generated config, logs, PID/ownership metadata and any socket files; bind only to loopback and obtain an ephemeral port.
- Construct a minimal child environment and test credentials from scratch. Reject non-loopback production-style URLs before doing anything destructive.
- Start the server once, poll a real readiness operation, and expose the resulting endpoint only through the test fixture—not through the developer's normal configuration.
- Give each test a fresh logical namespace: database/schema, broker prefix, emulator project ID, browser context or application tenant. For expensive database setup, snapshot/template once and clone.
- On normal completion or Ctrl-C, gracefully terminate the whole process tree, wait with a short deadline, then force-kill it. Add an external watchdog/OS parent-death mechanism because a test finalizer alone cannot cover debugger force-stop or runner crashes.
- At the beginning of the next run, inspect ownership metadata and reap stale servers/directories from previous interrupted runs. Never kill a process merely because it happens to occupy “your” conventional port.
- Make reuse an explicit `--reuse-server` development optimization, never the default. If enabled, verify a run/test marker and exact server version before attaching; do not interpret “something answers on localhost:5432/5672/3000” as sufficient identity.

That arrangement gives most of the fidelity of a real backend while keeping the failure domain close to the test run. The biggest lesson from the projects above is that **process launch is the easy part**. The engineering work is establishing ownership: ownership of the environment, endpoint, filesystem state, credentials, server version, mutable server data and, crucially, the process after the test runner itself stops behaving normally.
