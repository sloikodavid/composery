# Testing System Dependencies

Source: https://chatgpt.com/share/6aa92c9e-cc5c-83ed-a389-d4c97c045ae7

---

**User**

Context: A backend connects over SSH to Linux servers that customers own and can change arbitrarily. It reads and rewrites configuration files there, and its guarantees depend on how the remote SSH server behaves, not only on its own code. Docker is available to the developers.

Question: How do projects test code whose correctness depends on another system's behaviour, and how do they choose between running that system for real and standing in for it?

Compare: running the real software in containers or virtual machines; a local fake or simulator maintained by the project; recorded and replayed traffic; contract tests agreed with the other side; and testing only against the real production system. For each: what it proves, what it fails to catch, what it costs to run and maintain, how it behaves when the other system releases a new version, and how projects detect that their stand-in has drifted from reality.

Use named examples from projects that talk to SSH servers, databases, cloud APIs, or browsers.

Evidence rules: cite repositories, documentation and talks with dates. Distinguish what a project says from what its test code does. Include cases where a fake gave false confidence and the real system behaved differently.

---

**ChatGPT**

I’ll structure this as an evidence-backed comparison of five strategies, then anchor each one in named projects. I’ll separate “what the project documents” from “what its tests actually execute,” and I’ll call out documented simulator/fake mismatches where possible.

---

**ChatGPT**

One strong pattern is already emerging from SSH itself: Paramiko’s suite exercises an in-process Paramiko server, but a 2018 security bug had to be checked against a live OpenSSH 7.2 instance in Docker; OpenSSH rejected an out-of-order channel-open that Paramiko’s server accepted. That is exactly the kind of “the stand-in and reality disagree” failure mode your backend is exposed to.

---

**ChatGPT**

The recurring pattern across mature projects is not “pick the most realistic test double.” It is **use cheap stand-ins for fast feedback, but continuously calibrate them against an independent source of truth**. The closer correctness depends on undocumented quirks, state machines, filesystem/OS behavior, timing, or version-specific semantics, the more important that calibration becomes.

For your SSH backend, that points strongly toward **real OpenSSH in containers as the ordinary integration-test target, VMs for host-level semantics containers cannot reproduce, and a much smaller fake only for fault injection**. Paramiko’s history is a particularly good warning against making a self-hosted SSH implementation your compatibility oracle.

## Comparison

| Strategy | What it actually proves | What it tends to miss | Run / maintenance cost | When the other side releases a new version | How drift is detected |
|---|---|---|---|---|---|
| **Run the real software in containers / VMs** | Your code interoperates with that **actual implementation, configuration and version**. Protocol parsing, error behavior, real query/parser semantics, real daemon state machines and many filesystem effects are exercised. | Anything not represented in the matrix: other versions, distro patches, customer configuration, proxies/bastions. Containers also share the host kernel; they do not reproduce a whole guest OS, whereas a VM has its own kernel. ([Docker Documentation](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/)) | Usually moderate. Containers are cheap enough for PR CI; VMs are slower and operationally heavier. Testcontainers explicitly targets throwaway real PostgreSQL/MySQL/Oracle/browser instances, including known initial state. ([GitHub](https://github.com/testcontainers/testcontainers-java/blob/main/docs/index.md)) | A **pinned** image keeps tests reproducible but learns nothing about the release until you update the image. Strong projects therefore combine pinned supported versions with an update/latest/beta lane. Playwright explicitly couples releases to specific browser binaries and recommends regular updates to catch upcoming browser failures. ([Playwright](https://playwright.dev/docs/browsers)) | There is no semantic double to drift, but your **version matrix** can drift away from what customers actually run. Detect that through scheduled latest-version lanes and support-matrix review. |
| **Project-maintained fake / simulator** | Your client behaves correctly against the **model you wrote**. Excellent for deterministic state setup, rare errors, malformed responses, timeouts and exhaustive application branches. | Any real behavior the model got wrong or omitted. The most dangerous failures are where the fake gives a plausible but incorrect answer. | Very cheap to execute; potentially very expensive to maintain. The fake effectively becomes another implementation of the external system. | Nothing necessarily happens. Existing tests can stay green forever while reality changes. | Differential or conformance tests against the real implementation. LocalStack records AWS responses then compares LocalStack against them; Moto runs a subset of Terraform AWS provider tests against MotoServer on every PR. ([GitHub](https://github.com/localstack/localstack/blob/main/docs/testing/integration-tests/README.md)) |
| **Recorded / replayed traffic** | Your client still handles **interactions that really occurred at recording time**. It gives deterministic, offline, fast tests without manually inventing responses. | New server behavior, unrecorded branches, stateful interactions that depend on earlier external state, timing/concurrency, and anything hidden by overly loose request matching. A cassette is historical evidence, not a current compatibility test. | Very cheap replay; moderate fixture/cassette maintenance. Secrets and nondeterministic fields need scrubbing. | Usually completely invisible until rerecording. VCR.py explicitly says changed APIs require deleting/rerecording cassettes. ([vcrpy.readthedocs.io](https://vcrpy.readthedocs.io/en/latest/index.html)) | Periodic forced rerecords, cassette-age limits, or a small live lane. Without one of those, there is no automatic drift detector. |
| **Contract tests agreed with the other side** | The consumer and provider remain compatible for the **interactions represented by the contract**. Pact’s consumer test makes a real request to a Pact mock; provider verification then checks the provider side. ([Pact Docs](https://docs.pact.io/getting_started/how_pact_works)) | Behavior not stated in the contract: unspecified error cases, timing, performance, OS behavior, undocumented quirks, and generally whole-system functionality. Pact itself warns contract tests should focus on messages, not become provider functional tests. ([Pact Docs](https://docs.pact.io/getting_started/how_pact_works)) | Usually low runtime and moderate organizational cost: contracts and verification results must be exchanged and owned. | This is where the technique is strongest: rerun existing consumer contracts against the changed provider before deployment. | Provider verification *is* the drift detector. But a weak or incorrect contract can let both sides agree on the wrong abstraction. The original consumer-driven-contract article, dated **12 June 2006**, framed the value as making consumer obligations visible to a changing provider. ([martinfowler.com](https://martinfowler.com/articles/consumerDrivenContracts.html)) |
| **Only test against the real hosted / production system** | That today's deployed system accepts your operation and produces what your assertions expect. There is no simulator-fidelity question. | Hard-to-trigger failures, destructive scenarios, precise state setup, reproducibility, exhaustive edge cases. Outages, rate limits and changing shared state become test failures. Literal testing in customers’ production machines is particularly hazardous for mutating software. | Highest variable cost and usually slowest feedback. Terraform AWS Provider acceptance tests create real AWS resources and explicitly warn that they cost real money; some are marked long-running. ([hashicorp.github.io](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/)) | SaaS changes are observed immediately—the advantage and the danger. Tests can start failing without your repository changing. | No stand-in can drift, but you instead need to distinguish genuine incompatibility from environmental flakiness and external outages. Terraform therefore separates ordinary CI from explicitly enabled AWS acceptance tests. ([hashicorp.github.io](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/)) |

The key distinction is that **“real” does not mean “production customer data.”** Terraform's acceptance suite talks to the real AWS control plane and creates real resources, but it requires credentials and explicit `TF_ACC=1`; it is a controlled acceptance environment, not “try destructive tests against somebody's important account.” Its tests apply Terraform and then verify results using the provider API. ([hashicorp.github.io](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/))

## Real software: where fidelity matters most

Database projects are a useful comparison because SQL is similar to SSH in one respect: a seemingly well-defined interface still has implementation-specific semantics.

Microsoft's EF Core testing guidance, last updated **30 January 2023**, explicitly warns that a test double does not guarantee production behavior. Its concrete example is SQL Server's normally case-insensitive string comparison versus SQLite's case-sensitive behavior: the same LINQ test can pass on SQLite and fail on SQL Server, or vice versa. Raw SQL, provider-specific functions and transactions introduce more differences. Microsoft consequently recommends substantial coverage against the actual production database system; EF Core itself has more than 30,000 SQL Server tests that it says run in CI on every commit and complete in minutes. ([Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy))

That is the main argument for your OpenSSH container: when starting the real dependency is cheap, **a fake often buys surprisingly little**.

The same pattern exists in browser testing. Playwright runs real browser engines, maintains explicit browser-version coupling, supports Chromium, Firefox, WebKit and branded Chrome/Edge, and tells users to update regularly so the suite sees new browser versions. ([Playwright](https://playwright.dev/docs/browsers)) It accepts the cost of real implementations because browser compatibility is precisely the thing being tested.

For SSH, Teleport's repository gives a directly analogous example. Its integration test contains a function whose comment says it “checks if Teleport and OpenSSH behave in the same way when executing commands”; the test covers stdin piping, shell invocation, TTY behavior and file effects. That is **test-code evidence**, rather than merely a statement in documentation. ([GitHub](https://github.com/gravitational/teleport/blob/master/integration/integration_test.go))

### Containers versus VMs for an SSH backend

A container is sufficient when the relevant oracle is primarily `sshd` plus users/files/filesystem and process behavior. Docker's own documentation makes the boundary explicit: containers are isolated processes sharing the host kernel; a VM has an entire OS and its own kernel. ([Docker Documentation](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/))

So a VM becomes materially better when correctness involves things such as PAM stacks, full `systemd` login/session behavior, kernel/security-module differences, mount behavior, reboot persistence, kernel-enforced filesystem semantics, or a distro setup that is awkward/artificial inside a container. You do not need to pay that price for every test.

## Fakes: fast, controllable, and capable of lying convincingly

Paramiko gives an unusually clean example.

**What its current test code does:** `tests/test_transport.py` repeatedly calls `setup_test_server()` and then drives Paramiko client channels against a Paramiko server transport. It tests exec, shells, forwarding, rekeying, unauthenticated requests and many other behaviors inside its own implementation. ([GitHub](https://github.com/paramiko/paramiko/blob/main/tests/test_transport.py))

That is extremely useful for Paramiko's internal behavior, but it is partly **self-interoperability**: Paramiko client and Paramiko server can share the same mistaken assumption.

**What happened against reality:** Paramiko issue #1175, opened **13 March 2018** and associated with CVE-2018-7750, investigated whether a server should accept connection-level requests before authentication. The maintainer then ran the test client against Ubuntu/OpenSSH 7.2 in a Docker container. OpenSSH returned a protocol error/`SSH_MSG_UNIMPLEMENTED`; Paramiko's server had been willing to dispatch the request. The issue explains that OpenSSH changes its dispatch table according to protocol phase, whereas Paramiko's dispatch model behaved differently. ([GitHub](https://github.com/paramiko/paramiko/issues/1175))

That is not merely “a mock was incomplete.” It is the more dangerous case: **the project's own server implementation supplied false confidence about the behavior of the reference server**.

There are parallel examples elsewhere:

Microsoft explicitly documents SQLite/in-memory database fakes producing different query semantics from SQL Server. ([Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy))

A jsdom issue opened **6 June 2023** showed `getComputedStyle()` returning an empty CSS custom property under jsdom 22 while equivalent browser code returned `red`; the issue was labelled as having a failing upstream Web Platform Test. ([GitHub](https://github.com/jsdom/jsdom/issues/3563))

A LocalStack issue opened **14 January 2025** showed Step Functions/S3 error handling returning different status/cause information from real AWS under LocalStack 4.0.3. ([GitHub](https://github.com/localstack/localstack/issues/12139))

Those are exactly why a simulator needs an external oracle.

LocalStack's own repository has a good calibration model: a test can be switched to `TEST_TARGET=AWS_CLOUD`; once it has been shown to work against AWS, AWS's response is captured as a snapshot and LocalStack is compared with that snapshot. Its documentation says these AWS-validated snapshot tests are preferred because they increase parity confidence. ([GitHub](https://github.com/localstack/localstack/blob/main/docs/testing/integration-tests/README.md)) Moto's documented approach is different but similar in intent: run a subset of Terraform's AWS tests against MotoServer on every PR. ([docs.getmoto.org](https://docs.getmoto.org/en/4.2.4/docs/contributing/development_tips/tests.html))

An independent DynamoDB conformance project illustrates how measurable drift can remain even in mature simulators. Its **3 September 2026** run executes the same suite against live DynamoDB first and uses that as the baseline. In that particular 1,251-test suite, LocalStack 2026.8.1 had 95.3% coverage and **8.1% divergent behavior**; AWS itself is the 0% baseline. The project's authors explicitly warn that these are point-in-time, suite-specific measurements rather than certification. ([GitHub](https://github.com/paritysuite/dynamodb-conformance)) That number should therefore not be read as “LocalStack is 8.1% wrong in general”; it demonstrates that measurable emulator divergence is a normal engineering phenomenon.

## Record/replay is a cache of reality, not a simulation of reality

VCR.py describes the attraction well: record HTTP interactions on the first execution, replay them later, and obtain offline, deterministic, faster tests. Its documentation says that if the server API changes, cassettes can be deleted and generated again. ([vcrpy.readthedocs.io](https://vcrpy.readthedocs.io/en/latest/index.html))

The logical limitation follows directly: until you do that rerecord, **the old test cannot know the remote system changed**.

That makes record/replay particularly good where obtaining a realistic response is expensive but replaying the response exercises valuable client parsing or business logic. It is less convincing for an SSH protocol compatibility test. SSH has negotiation, authentication state, channels, flow control, PTYs, exit statuses and encrypted transport; raw packet replay can quickly stop representing a valid conversation.

For your application, recording **above** that layer could still be useful: e.g. “command issued → stdout/stderr/exit status” or “SFTP operation → result.” I would regard those fixtures as application test data, not evidence that you still interoperate with OpenSSH.

A well-run replay suite therefore has a deliberately expiring notion of truth: rerecord on a cadence, or maintain a small live acceptance suite that makes stale cassettes visible.

## Contracts solve a different problem

Contract testing is most valuable when the “other system” has an owner you can coordinate with.

Pact's model illustrates why it is different from an ordinary fake. On the consumer side, the expected interaction is registered with a mock provider and the real client code makes its request to that mock. On the provider side, the provider is independently verified against those interactions. ([Pact Docs](https://docs.pact.io/getting_started/how_pact_works)) The fake therefore is not supposed to be a freehand reimplementation of the provider: it is an executable statement of the consumer's requirement, checked later against the provider.

The idea predates Pact. Ian Robinson's “Consumer-Driven Contracts: A Service Evolution Pattern,” published **12 June 2006**, argued for exposing the obligations a provider must preserve as it evolves. ([martinfowler.com](https://martinfowler.com/articles/consumerDrivenContracts.html)) Pact itself arose at realestate.com.au in 2013 from problems with slow/brittle integration testing, according to Pactflow's **14 October 2019** history; the Pact Broker subsequently became the mechanism for exchanging contracts and verification results. ([Pactflow Contract Testing Platform](https://pactflow.io/blog/everything-you-didnt-even-know-you-wanted-to-ask-about-pactflow/))

A ThoughtWorks GeekNight talk, **“Microservices: Contract Testing Using PACT,” 4 March 2021**, provides a dated practitioner treatment covering integration testing, contract testing, Pact and its code workflow.

[Microservices: Contract Testing Using PACT — GeekNight ThoughtWorks, 4 Mar 2021](https://www.youtube.com/watch?v=yaAe0aR1G-U&utm_source=chatgpt.com)


For arbitrary customer-owned SSH servers, though, there is a fundamental mismatch: **you have nobody on the provider side who has agreed to run your contract before changing `sshd`, PAM, sudoers, the filesystem or shell configuration**.

You can still create a **conformance profile**—“these are the behaviors our product requires”—and execute it against supported servers. That is very useful, but it is not consumer-driven contract testing in the Pact sense.

## “Only test the real system” is the other extreme

Terraform AWS Provider is a useful example because it genuinely exercises the external production implementation. Its contributor guide says acceptance tests are end-to-end interactions with AWS that create, read and destroy real resources; it also warns explicitly that those tests cost real money. ([hashicorp.github.io](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/))

The test harness makes that expensive activity deliberate. `TF_ACC=1` must be supplied; credentials and regions are configured; some tests exceed 300 seconds and are separately treated as long-running. An acceptance step applies Terraform configuration and checks results using the provider/API. ([hashicorp.github.io](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/))

That approach has maximum provider fidelity but would be a poor *only* test suite. It is costly, slow, harder to isolate, and bad for exercising failures like “the connection vanishes exactly between temporary-file write and rename.”

For your software, “production only” is worse still if production means **customers' real machines**. A product whose job is rewriting configuration files should not need destructive experiments on customer hosts to find out whether its update algorithm is safe. Production telemetry and carefully designed non-destructive probes can be useful evidence; they should not replace reproducible integration tests.

## What I would use for your SSH backend

I would treat the external behavior as a **compatibility envelope** rather than claiming correctness against “Linux over SSH” in general. Customer machines can be changed arbitrarily, so no finite test suite can establish that universal guarantee.

A practical hierarchy would be:

- **Every PR:** run the actual backend against real `sshd` in Docker. Use several pinned OpenSSH/distro combinations representing supported environments. Exercise the real shell/SFTP path and real filesystem operations, not an SSH mock.
- **The same black-box conformance suite against every target:** login/authentication, exec semantics, stdout/stderr and exit codes, PTY/no-PTY, SFTP operations, ownership/mode preservation, symlinks, atomic replace/rename, `sudo` where supported, disconnects, malformed/partial files, permission denial, disk-full-like failures and concurrent modification. This is the suite you can also point at a VM or customer-like test host.
- **A small local fake:** only where it gives you something real OpenSSH cannot conveniently provide—precise timeout points, packet loss, forced disconnect during a write, impossible-to-reproduce server errors. Make it obvious that these tests establish your recovery logic, not SSH compatibility.
- **Scheduled VM tests:** use them for PAM/systemd/security-module/kernel/filesystem cases where sharing Docker's host kernel makes the container materially unlike a customer's Linux host. Docker itself documents that architectural distinction. ([Docker Documentation](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/))
- **Scheduled moving-version lane:** alongside pinned CI images, regularly test the newest distro/OpenSSH packages you intend to support. A pinned container is reproducible; a moving lane tells you reality moved.
- **Differential tests for any fake:** every behavior implemented by your fake should ideally have the same black-box test runnable against real OpenSSH. Paramiko #1175 is the reason.
- **Record/replay only above SSH**, where useful for deterministic application fixtures; do not make encrypted SSH transcript replay the compatibility oracle.
- **No reliance on customer production as the test environment.** If production evidence is needed, prefer read-only capability probes and explicit compatibility diagnostics, plus controlled canary hosts.

The most useful architectural rule is: **the test that guards an external-system guarantee should have an oracle independent of the code implementing that guarantee.** Paramiko-client-against-Paramiko-server lacked that independence in the problematic case. LocalStack's AWS snapshots have it. Pact provider verification has it. Playwright running actual browsers has it. Terraform's AWS acceptance tests have it.

Because Docker is already available to your developers and `sshd` is cheap to start, your case sits unusually far toward the “run the real dependency” side of the trade-off. I would need a concrete reason *not* to put real OpenSSH integration tests in the normal CI path.
