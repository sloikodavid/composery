# Testing Strategy Comparison

Source: https://chatgpt.com/share/6aa92d1b-5624-83eb-8e6b-9b19aa4ca557

---

**User**

Context: A small team builds a TypeScript backend that runs on a serverless platform and connects over SSH to customer-owned Linux servers to read and edit files. They can run real servers in containers. They have no continuous integration yet. Their stated aim is code clear enough that its correctness is visible by reading it, with tests reserved for what reading cannot settle.

Question: How do teams and projects decide which behaviour deserves an automated test, and what do they rely on instead for the rest?

Cover: written policies in well-regarded open source projects and in engineering handbooks; the reasoning of people who advocate very high coverage and of people who deliberately keep few tests; what each group relies on when they do not test something, such as types, assertions, review, staged rollout, monitoring, or formal reasoning; how each approach behaves when the code is changed a year later by someone else; and where each fails.

Include concrete named examples with links, and include projects whose policy is the opposite of "test everything".

Evidence rules: cite sources with dates, and say whether a claim is a project's stated policy, its observed practice, or a commentator's opinion. Where you find data rather than opinion, say so explicitly. Do not conclude that one school is correct; report what each buys and what each costs.

---

**ChatGPT**

I’ll separate **stated policy**, **observed practice**, **commentator opinion**, and **empirical data**, because those are often blurred in testing debates. I’m also going to look for explicit counterexamples to “test everything,” not just projects that happen to have incomplete coverage.

---

**ChatGPT**

A useful distinction is already emerging: “high coverage” projects usually do **not** treat coverage as the proof of correctness. SQLite, for example, pairs 100% branch/MC/DC coverage with assertions, mutation testing, fault injection, fuzzing, static/dynamic analysis, and release checklists—and explicitly says that this effort is probably not cost-effective for a typical application.

---

**ChatGPT**

The strongest “few tests” examples are not usually “we trust eyeballing instead.” They replace tests with a **specific cheaper oracle**: OpenSSL explicitly exempts non-behavioral changes and disproportionately expensive tests but makes that exemption a reviewed, labeled decision; LLVM deliberately prefers regression tests over unit tests for compiler transformations.

---

**ChatGPT**

The clearest pattern across mature projects is that they do **not** really ask “does this line need a test?” They ask what evidence should make them confident that a particular property will survive future changes.

A fair synthesis of the policies below is:

> **An automated test earns its keep when it records an important behavior that could plausibly regress, and no cheaper, more durable mechanism already makes the mistake impossible or conspicuous.**

The disagreement is over how often that condition is true. Some teams assume nearly every behavior worth preserving needs an executable regression check. Others deliberately leave substantial territory to types, simple code, review, integration tests at a higher level, assertions, deployment controls, or operational observation.

## What well-known projects actually say

| Source | Evidence type | What deserves a test | What carries the rest |
|---|---|---|---|
| [Google, Software Engineering at Google: Testing Overview](https://abseil.io/resources/swe-book/html/ch11.html), March 2020 | **Engineering handbook / stated Google practice** | The “Beyoncé Rule”: test every behavior you do not want to break. But think in **behaviors**, not coverage percentages. | Code review, static analysis, human exploratory testing, larger tests, canaries and monitoring. Google explicitly warns that a bad/brittle suite can be worse than none. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html)) |
| [SQLite, How SQLite Is Tested](https://www3.sqlite.org/testing.html), current page; figures mostly snapshot SQLite 3.42.0, 16 May 2023 | **Project policy + project-reported quantitative data** | SQLite core maintains 100% branch coverage and MC/DC and adds a regression test for every reported bug. | Assertions, fuzzing, fault injection, mutation testing, static/dynamic analysis, independent harnesses and release checklists. SQLite explicitly says this level of effort is probably not cost-effective for a typical application. ([SQLite](https://www3.sqlite.org/testing.html)) |
| [OpenSSL Testing Policy](https://openssl-library.org/policies/technical/testing/), current policy accessed 15 Sep 2026 | **Explicit project policy** | New functionality and fixes to functional behavior require tests. | Refactoring, performance changes, comments, internal naming and several other categories **do not require new tests**. A test may also be exempted when its cost is disproportionate. The exemption is visible and reviewed. ([OpenSSL Library](https://openssl-library.org/policies/technical/testing/)) |
| [LLVM Testing Infrastructure Guide](https://llvm.org/docs/TestingGuide.html), current guide accessed 15 Sep 2026 | **Explicit project guidance** | Compiler transformations and analyses are primarily covered by small regression tests; bugs normally get a minimized reproducer. | LLVM deliberately reserves unit tests mainly for support libraries and generic data structures rather than unit-testing every compiler component. ([LLVM](https://llvm.org/docs/TestingGuide.html)) |
| [GitLab Testing Strategy](https://docs.gitlab.com/development/testing_guide/testing_strategy/), current docs accessed 15 Sep 2026 | **Explicit project strategy** | Start at the lowest useful level; test important behavior without duplicating evidence. | “Every test should earn its keep”; unreliable tests should be fixed or deleted. If unit/feature/integration coverage is sufficient, GitLab explicitly says an E2E test is unnecessary. ([GitLab Docs](https://docs.gitlab.com/development/testing_guide/testing_strategy/)) |
| [curl, Verify](https://curl.se/docs/verify.html), current docs accessed 15 Sep 2026 | **Stated project practice** | Ideally each functionality is tested, with extensive failure-path testing. | Human review, complexity limits intended to keep code readable, compiler warnings as errors, static analysis, sanitizers, Valgrind, fuzzing, reproducible releases. curl acknowledges that its billions of build configurations make exhaustive testing impossible. ([cURL](https://curl.se/docs/verify.html)) |
| [seL4 proofs](https://sel4.com/Verification/proofs.html), current 2026 site; original functional-correctness proof completed 2009 | **Formal project policy + project-reported field history** | Tests remain for assumptions, unverified configurations, integration and whether the specification matches developer expectations. | For verified properties, the principal evidence is machine-checked mathematical proof. The project says no code change bypasses proof validation. ([seL4](https://sel4.org/About/fact-sheet.html)) |

So there are strong, reputable counterexamples to a literal “test everything” policy. OpenSSL is perhaps the cleanest one: it writes the distinction into governance. A refactor need not come with a new test merely because code changed, and even a behavioral test can be explicitly exempted on cost grounds. LLVM makes a different distinction: it certainly tests heavily, but says **the right unit of testing for compiler transformations is normally a regression example, not a unit test of each implementation object**. GitLab goes further in explicitly treating duplicate tests as waste.

That is materially different from simply having poor coverage.

## The high-coverage argument

There are two somewhat different versions.

Google's 2020 handbook is close to “cover all important behavior,” but decidedly **not** “hit every line.” Its rule is that if a property matters, there should be an automated check for that property. Google explicitly argues against a numerical coverage target: executing a line says nothing about whether the test made a meaningful assertion, and an 80% target can readily turn into an 80% ceiling. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html))

The motivation is mostly **change over time**. Google says a piece of code may be modified dozens of times, including by other teams and automated tools; a test written by the original author becomes shared executable knowledge for all those later editors. Its unit-testing chapter therefore says the ideal test changes only when the required behavior changes: a pure refactoring should not require test edits, while a bug fix should normally add the previously missing regression case. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html))

Google gives one piece of **self-reported operational data**, rather than a controlled experiment. Its Web Server project had reached a point around 2005 where, according to the handbook, more than 80% of production pushes contained user-affecting bugs requiring rollback. After requiring new changes to carry automated tests and continuously running them, emergency pushes reportedly halved within a year despite increasing change volume. That is suggestive before/after operational evidence, but many things could have changed at the same time; it is not causal experimental evidence. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html))

SQLite represents a more literal high-coverage position. Its current documentation reports 100% branch coverage of core SQLite in the deployed configuration, MC/DC coverage, millions of cases, simulated OOM and I/O failures, crash testing, fuzzing and thousands of assertions. For the 3.42.0 snapshot, SQLite reported about 155.8 KSLOC of library code versus 92,053.1 KSLOC of test code/scripts—about 590 times as much. Those are **project-reported quantitative data**, not an independent measurement. ([SQLite](https://www3.sqlite.org/testing.html))

Its reasoning is illuminating: SQLite says full coverage lets developers make substantial changes with confidence that unrelated branches have not silently changed. But the same page says maintaining 100% MC/DC is laborious and “probably not cost effective” for a normal application; SQLite considers it justified because it is extraordinarily widely deployed infrastructure and a database can preserve the consequences of an old bug indefinitely. ([SQLite](https://www3.sqlite.org/testing.html))

Robert C. Martin states the stronger philosophical version. In his 6 March 2017 article [“Testing Like the TSA”](https://blog.cleancoder.com/uncle-bob/2017/03/06/TestingLikeTheTSA.html), he argues that 100% should be an **asymptotic goal** and that there is no principled lower number at which one should stop trying to increase coverage. He also says roughly 1:1 production-to-test LOC feels appropriate. That is **commentator opinion**, not empirical evidence. Interestingly, even Martin says there is generally no reason to retest trusted framework functionality, which shows that “high coverage” still involves decisions about where responsibility resides. ([Clean Coder Blog](https://blog.cleancoder.com/uncle-bob/2017/03/06/TestingLikeTheTSA.html))

What this school buys is durable, machine-readable memory. The original programmer can leave, comments can rot and reviewers can misunderstand the implementation, but a well-chosen behavior test continues objecting when that behavior changes.

Its characteristic failure is **false contracts**. If tests pin implementation details, mock call sequences or incidental output rather than externally meaningful behavior, they make legitimate change expensive. Google's own handbook describes this as a serious problem: brittle tests can make teams afraid to refactor, and Google specifically reports trouble from excessive mocking. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html))

And coverage itself is not the cure. A suite can execute every line while checking the wrong things.

## The deliberately-selective argument

David Heinemeier Hansson is one of the clearest proponents. His 11 April 2012 [“Testing like the TSA”](https://signalvnoise.com/posts/3159-testing-like-the-tsa.html?utm_source=chatgpt.com) explicitly says not to aim for 100% and argues that tests have writing, reading and maintenance costs, so preventing sufficiently improbable or cheap bugs can cost more than the bugs. He says the hard skill is deciding what **not** to test. That is **commentator opinion**.

His practice was not “no tests.” In January 2012 he described his approach as “less testing than the average”: test things with enough logic to be worthwhile, and let functional/integration testing cover the rest rather than directly testing trivial framework declarations. ([Signal v. Noise](https://signalvnoise.com/posts/3094-code-statistics-for-basecamp-next)) His 2014 Basecamp write-up reported a model suite with 3,333 assertions, all hitting the real database, and a whole suite taking about 4½ minutes with roughly a 1:1 test/code ratio. Those are **self-reported practice data**; they show that his dispute was substantially about *granularity, duplication, isolation and architecture*, not an absence of automated tests. ([DHH](https://dhh.dk/2014/slow-database-test-fallacy.html))

His 29 April 2014 [“Test-induced design damage”](https://dhh.dk/2014/test-induced-design-damage.html) makes the deeper argument relevant to your stated philosophy: code can become **less clear** if it acquires repositories, interfaces, command objects and mocks primarily so that everything can be unit-tested in isolation. His preference is to let system design determine test boundaries: intricate model logic gets direct tests, controllers can be integration-tested and UI behavior system-tested. Clarity of production code comes before the convenience of isolated tests. Again, this is a **commentator's position**, not data. ([DHH](https://dhh.dk/2014/test-induced-design-damage.html))

Kent C. Dodds makes a TypeScript-specific version in his 13 July 2019 [“Write tests. Not too many. Mostly integration.”](https://kentcdodds.com/blog/write-tests). He argues that TypeScript and linting already supply substantial confidence, so tests should address confidence they *cannot* supply—especially business behavior. He opposes blanket 100% application coverage and warns that reaching the last few percent often induces tests of implementation detail. He also says many of his small reusable libraries do reach 100%, because the cost is low and the blast radius of a break is high. This is explicitly **commentator opinion**; he even flags one numerical diminishing-return threshold in the article as something he made up rather than scientific evidence. ([Kent C. Dodds](https://kentcdodds.com/blog/write-tests))

This school buys less duplicate specification and greater freedom to simplify or refactor implementation. Its costs become visible when some “obvious” fact was obvious only to the original author.

A future engineer cannot query the absent test to discover why a particular odd condition mattered. If the substitute was “David would notice this in review,” the substitute leaves with David.

## What can legitimately substitute for a test?

“Not tested” only works as an engineering strategy when there is some other oracle. The examples above use several.

**Types and static analysis** are particularly attractive because they automatically survive refactoring. If the property is “this function cannot receive this variant without handling it,” a good discriminated union plus exhaustive checking may provide stronger, cheaper evidence than several examples. But the type checker does not tell you that `rename(2)` behaves as you expect across filesystems, that a remote user's permissions are correct, or that your business rule is the intended one. Dodds's TypeScript argument draws exactly that line. curl similarly combines tests with compiler warnings-as-errors and several static analyzers. ([Kent C. Dodds](https://kentcdodds.com/blog/write-tests))

**Assertions and invariants** make reasoning assumptions executable. SQLite currently reports 6,754 `assert()` statements checking preconditions, postconditions and loop invariants; some are disabled in production for performance but active in debug/testing builds. Its `ALWAYS`/`NEVER` machinery deliberately turns supposedly impossible states into assertion failures during testing. ([SQLite](https://www3.sqlite.org/testing.html)) This works well for “if control reaches here, X must be true”; it does not help with a case that is never exercised.

**Human review** handles properties that are easy for a knowledgeable reader to verify and expensive to encode. OpenSSL turns this into an explicit governance mechanism: every PR gets a testing-status label, exemptions are visible, and disagreements over whether tests are needed go through normal review. curl says every PR is reviewed and separately imposes complexity ceilings specifically to keep functions understandable. ([OpenSSL Library](https://openssl-library.org/policies/technical/testing/)) Review's weakness is repeatability: the next reviewer may not possess the same history or notice the same issue.

**Higher-level tests instead of lower-level ones** are another substitute. LLVM does not conclude that a compiler transformation is safe merely because it lacks a unit test; it uses minimized IR regression examples. GitLab says not to add an E2E test when lower-level coverage already settles the behavior. These are really arguments about finding one durable test at the right abstraction, not minimizing the test count for its own sake. ([LLVM](https://llvm.org/docs/TestingGuide.html))

**Manual exploratory testing** is used for things whose failure modes are not known in advance. Google's 2020 handbook explicitly retains it, particularly for discovering surprising paths and qualitative problems, but says defects found this way should generally become automated regression tests afterward. ([Abseil](https://abseil.io/resources/swe-book/html/ch14.html))

**Staged rollout and monitoring** cover the unavoidable gap between laboratory and production. Google's 2018 SRE Workbook says test environments are not identical to production and tests cannot cover every possible scenario; a canary exposes only a fraction of traffic to a candidate and evaluates production metrics before widening rollout. This is a **stated SRE practice**, not an argument that tests are unnecessary. It limits the cost of omissions rather than proving them absent. ([Google SRE](https://sre.google/workbook/canarying-releases/))

The weakness is obvious but important: by the time a canary tells you about a semantic bug, some real workload has exercised it. It also catches only faults reflected in the measurements you chose.

**Formal proof** is the most radical replacement. seL4's current project material says verified configurations have machine-checked proofs that the C implementation conforms to a formal specification, with proof validation required for code changes. The project still tests machine/hardware assumptions, unverified configurations, integration and whether the *formal specification itself* captures what developers actually intended. ([seL4](https://sel4.org/About/fact-sheet.html))

The seL4 project reports **field-history data** of no functional-correctness defect in verified code since the proof was completed in 2009, while defects have been seen in unverified configurations and unverified assumptions. That is remarkable project-reported evidence, but it is not a controlled comparison with an otherwise-identical conventionally tested kernel. And it illustrates formal verification's boundary very well: a proof is only as comprehensive as its specification and assumptions. ([seL4](https://sel4.com/Verification/proofs.html))

## The “someone else changes it a year later” test

This thought experiment exposes what each strategy is optimizing.

With a good behavior-oriented automated test, the new engineer does not need to know *why* the old author cared. They make a change; CI presents a counterexample. This is the central Google/SQLite benefit. The useful test is an executable historical fact.

With a badly chosen automated test, precisely the opposite happens. The new engineer makes a harmless internal change and encounters twenty failures explaining implementation details nobody actually cares about. They must either reconstruct obsolete architecture or mass-update tests. Eventually people stop trusting failures. Google reports that at scale, flakiness and brittleness can make an otherwise impressive suite lose its value. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html))

With **types**, the future engineer gets very good protection against exactly those properties encoded in the type system, usually without needing to understand the old implementation at all. But an unwritten semantic condition remains unwritten.

With **clear code plus review**, the year-later experience can be excellent when correctness really is local. A five-line transformation whose complete invariant is visible in those five lines may be easier to verify afresh than to understand 50 lines of test setup. The failure mode is hidden context: what was “obvious” may have depended on a production incident, an odd customer configuration or an undocumented external-system behavior.

With **integration-first tests**, the future maintainer has good protection against observable system behavior and considerably more implementation freedom. The cost is weaker localization: when a broad test fails, it may take more work to discover which component violated the contract.

With **canaries and monitoring**, a future engineer is protected even against some failure modes nobody predicted. But the oracle operates late, potentially after customer impact, and silently misses anything outside the metrics.

With **formal proof**, the new engineer cannot land a change to a verified property without restoring the proof. That is an exceptionally strong form of institutional memory. Its price is the specification/proof engineering itself, and properties outside the proof remain ordinary software-engineering problems.

## Coverage data does not resolve the argument

There is actual empirical work here, but it is considerably less decisive than testing rhetoric often implies.

Inozemtseva and Holmes's ICSE 2014 study, [“Coverage Is Not Strongly Correlated with Test Suite Effectiveness”](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf), generated **31,000 test suites for five Java systems up to 724,000 LOC** and used mutation faults to measure fault detection. This is **empirical experimental data**. After controlling for the number of tests, coverage had only low-to-moderate correlation with effectiveness, and stronger coverage criteria did not provide much more information. The authors concluded that coverage is useful for locating undertested areas but not a good standalone quality target. ([Computer Science at UBC](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf))

Kochhar, Lo, Lawall and Nagappan's large-scale study, published in IEEE Transactions on Reliability in 2017, examined **100 large open-source Java projects and their actual post-release bug reports**. This is **empirical observational data**. They found an insignificant correlation between coverage and post-release bug count at project level and no such correlation at file level. ([Microsoft](https://www.microsoft.com/en-us/research/publication/code-coverage-and-post-release-defects-a-large-scale-study-on-open-source-projects/))

That does **not** establish that adding a good test has no causal benefit. Cross-project coverage is entangled with project type, difficulty, engineering culture and the quality of the assertions, and the 2014 study used mutants rather than actual field failures. What these studies do undermine is the shortcut “90% is demonstrably better than 70% merely because it is 90%.”

Martin Fowler's 17 April 2012 [“Test Coverage”](https://martinfowler.com/bliki/TestCoverage.html) reaches a similar conclusion as **commentator opinion**: he expects thoughtful suites often to produce high coverage, regards very low coverage as a useful warning, but is suspicious of a numeric target—particularly 100%—because the number is easy to game. ([martinfowler.com](https://martinfowler.com/bliki/TestCoverage.html))

That position is compatible both with “write lots of tests” and “delete low-value tests.”

## Applying those schools to the TypeScript/SSH system you described

Your “correctness should be visible by reading; tests are for what reading cannot settle” principle has respectable precedents. It is close to DHH's emphasis on clarity, OpenSSL's distinction between behavior and implementation, and LLVM's preference for testing compiler behavior at the useful boundary rather than every internal object.

The important question is what **reading actually can settle**.

For pure TypeScript logic with a small state space, strong types, exhaustive switches and explicit invariants can move a surprising amount into that category. A thin function that converts one validated value into another may genuinely acquire little from a separately maintained example test. Tests written solely to prove that TypeScript assignment or a trusted library's trivial forwarding method works resemble exactly the duplication the selective camp objects to.

SSH and a customer-owned Linux machine move in the opposite direction. Whether a file operation behaves correctly can depend on process credentials, permissions, symlinks, filesystem semantics, quoting/argument boundaries, existing file state, interrupted operations and what actually happens when the remote process dies halfway through. Those facts are not all present in the TypeScript source, however readable it is.

Because this team can cheaply start **real Linux servers in containers**, an integration test using a real SSH daemon and real filesystem is unusually attractive. It need not imply hundreds of mock-heavy unit tests. In fact it fits DHH's argument for using the real database and Google's preference for real dependencies when feasible: put the executable evidence at the boundary where the uncertainty actually exists. Google explicitly notes that larger/local-machine tests are appropriate when integration with real processes and resources is the behavior being checked. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html))

The selective interpretation would therefore be something like: let the compiler settle static structural facts; let simple, reviewable code settle genuinely local facts; use assertions for invariants that should be impossible; use a small number of real-server tests for Linux/SSH/filesystem behavior; turn escaped bugs into regression cases; and rely on rollout/observability for production-specific conditions you cannot reproduce. The high-coverage interpretation would use those same mechanisms but add substantially more executable examples around each behavior so that less depends on future readers reconstructing the reasoning.

Neither eliminates the other's failure mode. The sparse version can lose an undocumented assumption. The dense version can accumulate a second codebase of stale or implementation-coupled tests.

There is one separate issue with **no CI**. Every project above that treats automated tests as durable protection also treats **running them automatically** as part of the mechanism. Google says automated tests get their value from being run frequently and its current workflow uses CI; LLVM says unit/regression tests should be run before every commit; curl reports more than 200 CI jobs for every commit and PR and refuses unexplained failures. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html))

So without CI, a test can still be useful as executable documentation and as a local debugging tool, but it is much weaker answer to the “new engineer a year later” problem: that engineer can simply not run it. That observation applies whether the project chooses ten tests or ten thousand.

The durable dividing line in these examples is therefore less **“pro-testing versus anti-testing”** than **“where do we want the proof obligation to live?”** SQLite deliberately puts an extraordinary amount into executable tests. OpenSSL divides it between tests and review. DHH is willing to put more into simple design, framework trust and broader integration checks. Google combines a broad behavioral test contract with review, static checks, exploratory work and production safeguards. seL4 moves selected obligations into formal proofs. Each buys confidence in a different place, and each pays maintenance cost—and admits failures—at the boundaries of the evidence it chose.
