# Testing research prompts

Paste one complete prompt into a fresh conversation. Each one stands alone. Import each finished conversation with `bun run research:import <url>`. Delete this file when every report is imported.

The prompts ask what people actually do and what the evidence shows. None of them states a preferred answer, and several invite the opposite of what this repository currently believes.

## 01: What earns a test

```text
Context: A small team builds a TypeScript backend that runs on a serverless platform and connects over SSH to customer-owned Linux servers to read and edit files. They can run real servers in containers. They have no continuous integration yet. Their stated aim is code clear enough that its correctness is visible by reading it, with tests reserved for what reading cannot settle.

Question: How do teams and projects decide which behaviour deserves an automated test, and what do they rely on instead for the rest?

Cover: written policies in well-regarded open source projects and in engineering handbooks; the reasoning of people who advocate very high coverage and of people who deliberately keep few tests; what each group relies on when they do not test something, such as types, assertions, review, staged rollout, monitoring, or formal reasoning; how each approach behaves when the code is changed a year later by someone else; and where each fails.

Include concrete named examples with links, and include projects whose policy is the opposite of "test everything".

Evidence rules: cite sources with dates, and say whether a claim is a project's stated policy, its observed practice, or a commentator's opinion. Where you find data rather than opinion, say so explicitly. Do not conclude that one school is correct; report what each buys and what each costs.
```

## 02: Which tests actually catch defects

```text
Context: A team wants tests that fail when the system is wrong, and does not want tests that merely restate the implementation and break whenever the code is rewritten.

Question: What evidence exists about which kinds of automated tests catch real defects, and which kinds mostly impose cost?

Cover: empirical studies of defect detection by test type; analyses of bug trackers, postmortems and incident reports that identify whether a test could have caught the failure; mutation testing findings; research and industry reports on assertion quality; the "test the contract, not the implementation" literature; and the criticisms of snapshot and characterisation tests, together with the cases where those are genuinely the right tool.

Also cover what makes a test brittle in practice, with examples of tests that broke on a refactor without any behaviour changing.

Evidence rules: prefer studies and postmortems over blog assertions, and say plainly which is which, with dates and links. Where the evidence is weak or contested, say so rather than choosing a side.
```

## 03: Testing against systems you do not control

```text
Context: A backend connects over SSH to Linux servers that customers own and can change arbitrarily. It reads and rewrites configuration files there, and its guarantees depend on how the remote SSH server behaves, not only on its own code. Docker is available to the developers.

Question: How do projects test code whose correctness depends on another system's behaviour, and how do they choose between running that system for real and standing in for it?

Compare: running the real software in containers or virtual machines; a local fake or simulator maintained by the project; recorded and replayed traffic; contract tests agreed with the other side; and testing only against the real production system. For each: what it proves, what it fails to catch, what it costs to run and maintain, how it behaves when the other system releases a new version, and how projects detect that their stand-in has drifted from reality.

Use named examples from projects that talk to SSH servers, databases, cloud APIs, or browsers.

Evidence rules: cite repositories, documentation and talks with dates. Distinguish what a project says from what its test code does. Include cases where a fake gave false confidence and the real system behaved differently.
```

## 04: Finding concurrency and state machine defects

```text
Context: A control plane records intent, then a worker performs provider calls and records the outcome. Runs can overlap, responses can be lost, and a late result can arrive after the work it belonged to was replaced. Defects here are rare in normal use and severe when they occur.

Question: How do teams find defects in concurrent workflows and state machines, and what does each method actually catch?

Cover: deterministic simulation testing; property based and model based testing; fault and latency injection; chaos testing; formal specification such as TLA+ or Alloy; randomized interleaving tools; idempotency and replay testing; and plain example based tests of specific interleavings.

For each: the class of defect it finds, the effort to adopt, what it demands of the code under test, how the result is reproduced when it fails, and the reported experience of teams who used it, including those who abandoned it.

Give named cases where one of these found a real bug that other methods missed.

Evidence rules: cite engineering write-ups, papers and repositories with dates. Separate what a method guarantees from what a team reports anecdotally.
```

## 05: How test suites are arranged

```text
Context: A TypeScript repository has product code and a small number of deliberately chosen tests. Some tests are pure and instant; some start a container and take a minute. The team has not decided where test files live, how they are named, or how the slow ones are kept out of the fast path.

Question: How do well-regarded repositories arrange their tests, and what follows from each arrangement?

Cover: tests beside the code versus a separate tree; naming conventions; splitting by speed, by layer, by domain, or not at all; how slow suites are separated and when they run; shared fixtures and helpers and how they are prevented from becoming a second untested framework; and how a repository keeps a suite honest when it cannot be run on every change.

Include examples from at least one large monorepo, one widely used library, and one infrastructure tool, and say how many tests each has relative to its size.

Evidence rules: cite the repositories directly with dates. Say which conventions are enforced by tooling and which are habit. Include arrangements that the projects themselves later changed, and why.
```

## 06: Testing a parser against somebody else's grammar

```text
Context: A project parses and rewrites a configuration format defined by another program, which is authoritative and changes between its own releases. The project must preserve bytes it does not intend to change, and must never widen what an entry permits.

Question: How do projects test a parser or rewriter for a format they do not own?

Cover: round trip and idempotency testing; differential testing against the authoritative implementation; corpus based testing and where corpora come from; fuzzing, including structure aware fuzzing; property based testing of preservation; golden files and their failure modes; and how projects detect that the upstream grammar changed in a new release.

Also cover how projects decide what to do with input they cannot parse, and how that decision is tested.

Use named examples such as configuration file rewriters, code formatters, linters, and protocol libraries.

Evidence rules: cite repositories and papers with dates. Where a project publishes its corpus or fuzzing setup, describe how it is run and how failures are triaged. Include examples of bugs these methods found.
```

## 07: Tests that cost money or touch real infrastructure

```text
Context: A team can create real cloud servers in tests. Each run costs a little money and takes minutes, and a failed run can leave resources behind that continue to cost money.

Question: How do teams handle tests that create real infrastructure, and what do they run instead in everyday development?

Cover: how often such tests run and who triggers them; how resources are guaranteed to be cleaned up, including after a crashed run; how cost is bounded; how credentials are handled; what is asserted in those tests that cheaper tests cannot assert; and what teams report about whether the expense was worth it.

Include the practice of testing against a provider's own emulator or a local API implementation, and evidence on how faithful those are.

Evidence rules: cite documentation, repositories and engineering write-ups with dates. Include reports of these suites being removed or reduced, with the stated reason.
```

## 08: What goes wrong with test suites over time

```text
Context: A team is choosing a testing approach they will still want in two years.

Question: What are the documented failure modes of automated test suites, and what interventions are reported to work?

Cover: flaky tests and their measured causes; suites that grew too slow to run; tests that had to be rewritten wholesale during a refactor; coverage targets and what the evidence says about them; false confidence, where a green suite accompanied a production incident; tests that encoded a bug as expected behaviour; and the maintenance cost of fixtures and helpers.

Include published data from large organisations on flakiness rates and on what they did about it.

Evidence rules: prefer measured reports over opinion, and label which is which, with dates and links. Where an intervention is reported to work, say in what context and whether anyone reports it failing.
```

## 09: A test suite without a framework

```text
Context: A repository uses a runtime whose built-in test runner provides test declaration, assertions, lifecycle hooks and filtering, and nothing else. The team does not want to add a separate test framework.

Question: What does a project actually need beyond a minimal runner, and how do teams provide it without adopting a framework?

Cover: fixtures and resource lifecycle, including cleanup after failure and after an interrupted run; parallelism and isolation between tests; parameterised cases; time control; randomness and seeds; assertion helpers and when a custom one is worth writing; and reporting when a test fails in a way a person must diagnose.

Also cover what teams say they missed after leaving a heavier framework, and what they were glad to be rid of.

Evidence rules: cite repositories that do this and describe how, with dates. Include cases where a project reverted to a framework, and the reason given.
```

## 10: Testing a system that changes other people's systems

```text
Context: A control plane performs operations on infrastructure that belongs to customers: creating servers, changing files on them, and recording what happened. Some outcomes are genuinely unknown, for example when a response is lost after a request was sent. Repeating an operation may be safe or may not.

Question: How do infrastructure tools test operations whose outcome may be unknown, partial, or not repeatable?

Cover: how idempotency is tested; how unknown outcomes are represented and asserted; how partial failure and rollback are exercised; how tools verify that they do not act twice; what is asserted about resources left behind; and how reconciliation loops are tested for convergence.

Use named examples from infrastructure as code tools, provisioning systems, orchestrators, and cloud control planes, including how their own repositories test these paths.

Evidence rules: cite repositories, design documents and incident reports with dates. Distinguish a tool's documented guarantee from what its tests actually cover. Include known cases where such a tool acted twice or left a resource behind, and whether a test could have caught it.
```
