# Evidence On Test Effectiveness

Source: https://chatgpt.com/share/6aa92d53-8270-83eb-b0f0-8ff33265c198

---

## Turn 1: User

_2026-09-15T11:25:54.915Z_

Context: A team wants tests that fail when the system is wrong, and does not want tests that merely restate the implementation and break whenever the code is rewritten.

Question: What evidence exists about which kinds of automated tests catch real defects, and which kinds mostly impose cost?

Cover: empirical studies of defect detection by test type; analyses of bug trackers, postmortems and incident reports that identify whether a test could have caught the failure; mutation testing findings; research and industry reports on assertion quality; the "test the contract, not the implementation" literature; and the criticisms of snapshot and characterisation tests, together with the cases where those are genuinely the right tool.

Also cover what makes a test brittle in practice, with examples of tests that broke on a refactor without any behaviour changing.

Evidence rules: prefer studies and postmortems over blog assertions, and say plainly which is which, with dates and links. Where the evidence is weak or contested, say so rather than choosing a side.

---

## Turn 2: ChatGPT

_2026-09-15T11:25:55.318Z_

I’m going to separate strong empirical evidence from weaker practitioner guidance, and I’ll call out where the literature does **not** support a confident conclusion. I’ll also distinguish “would have caught the defect” analyses from studies that only correlate test metrics with defect rates.

---

## Turn 3: ChatGPT

_2026-09-15T11:27:07.997Z_

The evidence is already pointing to a useful distinction: **test level is a weak predictor; oracle quality and what the test observes are much stronger predictors**. For example, one OpenStack study found unit tests overwhelmingly effective for its injected fault model, while a 17-project Java study found no significant defect-type advantage for “unit” versus “integration” tests—so blanket pyramids should be treated as heuristics, not laws.

---

## Turn 4: ChatGPT

_2026-09-15T11:29:47.357Z_

## Bottom line

The best-supported conclusion is **not** “unit tests good, integration tests bad” or the reverse. It is:

> **A test is valuable when it both reaches a plausible failure and has an oracle that observes something the system is actually required to guarantee.**

Conversely, tests become disproportionately costly when their pass/fail condition encodes **how the implementation happens to work** rather than a stable behavioral contract. Coverage, number of tests, and the label “unit/integration/E2E” are substantially weaker indicators of defect-finding ability than people often assume.

There is good empirical evidence for the first half of that statement. There is also good evidence that implementation coupling creates maintenance churn. What the literature generally **does not** give us is a clean ROI calculation proving that some whole category—snapshots, mocks, unit tests, E2E tests—is intrinsically net-negative. Claims of that form are mostly practitioner doctrine rather than established empirical results.

### What the stronger studies say

| Evidence | What was measured | Main result | How much I would trust the conclusion |
|---|---|---|---|
| Yuan et al., OSDI **2014**, 198 real production failures in Cassandra, HBase, HDFS, MapReduce and Redis. [Paper and materials](https://www.usenix.org/conference/osdi14/technical-sessions/presentation/yuan?utm_source=chatgpt.com) | User-reported production failures | Almost all failures could be reproduced with ≤3 nodes; many catastrophic failures arose in mundane error-handling paths. A later USENIX summary reports 92% of catastrophic failures involved incorrect handling of non-fatal errors. ([Usenix](https://www.usenix.org/conference/osdi14/technical-sessions/presentation/yuan?utm_source=chatgpt.com)) | **Strong**, for these distributed systems |
| Kochhar et al., IEEE TR **2017**, 100 Java OSS projects. [Microsoft Research page](https://www.microsoft.com/en-us/research/publication/code-coverage-and-post-release-defects-a-large-scale-study-on-open-source-projects/?utm_source=chatgpt.com) | Coverage versus actual post-release bug reports | Coverage had an insignificant relationship with post-release bugs at project level and none at file level. ([Microsoft](https://www.microsoft.com/en-us/research/publication/code-coverage-and-post-release-defects-a-large-scale-study-on-open-source-projects/?utm_source=chatgpt.com)) | **Strong caution** against treating coverage as a quality score |
| Inozemtseva & Holmes, ICSE **2014**, 31,000 suites. [Paper](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf?utm_source=chatgpt.com) | Coverage versus mutation fault detection | Once suite size was controlled, coverage correlated only weakly/moderately with effectiveness; stronger coverage criteria added little. ([Computer Science at UBC](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf?utm_source=chatgpt.com)) | **Strong**, but effectiveness was measured with mutants |
| Shamshiri et al., ASE **2015**, 357 real Defects4J faults. [Study page](https://orbilu.uni.lu/handle/10993/21589?locale=en&utm_source=chatgpt.com) | Automatically generated tests versus real bugs | Collectively generated tests found 55.7% of faults, but only 19.9% of individual generated suites found the target fault. Failures commonly came from not reaching the fault, not propagating it, or having an insufficient oracle. ([ResearchGate](https://www.researchgate.net/publication/281640540_Do_Automatically_Generated_Unit_Tests_Find_Real_Faults_An_Empirical_Study_of_Effectiveness_and_Challenges?utm_source=chatgpt.com)) | **Strong** evidence that execution/coverage without a good oracle is insufficient |
| Trautsch et al., JSS **2019/2020**, 38,782 tests in 17 projects. [Paper page](https://www.sciencedirect.com/science/article/pii/S0164121219301955?utm_source=chatgpt.com) | Unit versus integration tests on 627,507 mutants | No statistically significant advantage for either test category in detecting the five defect types examined. ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0164121219301955?utm_source=chatgpt.com)) | **Good**, but mutants rather than real defects |
| Marques et al., ESE **2022**, OpenStack. [Paper record](https://www.researchgate.net/publication/355914741_Injecting_software_faults_in_Python_applications_The_OpenStack_case_study?utm_source=chatgpt.com) | Bug-derived fault model plus 11,309 injected faults | In this particular suite, unit tests caught 96.3%, functional tests 69.6%, integration tests 2.9%; functional tests still caught 29.2% of faults missed by units. ([Scribd](https://www.scribd.com/document/1071706402/Martins-et-al-2022-Injecting-software-faults-in-Python-applications?utm_source=chatgpt.com)) | **Strong case study, poor basis for a universal hierarchy** |
| Papadakis et al., ICSE **2018**. [IEEE paper](https://ieeexplore.ieee.org/document/8453121/?utm_source=chatgpt.com) | Mutation score versus real-fault detection | Raw correlation largely reflected suite size. At equal suite size, higher mutation scores did improve real-fault detection. ([IEEE Xplore](https://ieeexplore.ieee.org/document/8453121/?utm_source=chatgpt.com)) | **Strong** |
| Petrović et al., ICSE **2021**, Google, ~15m mutants. [ICSE study](https://2021.icse-conferences.org/details/icse-2021-papers/70/Does-mutation-testing-improve-testing-practices-?utm_source=chatgpt.com) | Longitudinal mutation use and real high-priority faults | Mutation feedback caused developers to improve tests, and historical real bugs were often coupled to surviving mutants. ([2021.icse-conferences.org](https://2021.icse-conferences.org/details/icse-2021-papers/70/Does-mutation-testing-improve-testing-practices-?utm_source=chatgpt.com)) | **Strong industrial evidence** |
| Spadini et al., ESE **2019**, mocks. [Study](https://link.springer.com/article/10.1007/s10664-018-9663-0?utm_source=chatgpt.com) | >2,000 mocked dependencies plus repository history/interviews/survey | Production changes frequently forced mock changes; developers themselves identified coupling and keeping mocks synchronized as major costs. ([Springer](https://link.springer.com/article/10.1007/s10664-018-9663-0?utm_source=chatgpt.com)) | **Good direct evidence of brittleness** |
| Kashiwa et al., ICSME **2021**, 615,196 tests. [Study record](https://waseda.elsevierpure.com/en/publications/does-refactoring-break-tests-and-to-what-extent/?utm_source=chatgpt.com) | Test breakage during refactorings | Most refactorings rarely broke tests, but some—especially renames, parameter additions and return-type changes—did so appreciably and required test edits. ([Waseda University Pure](https://waseda.elsevierpure.com/en/publications/does-refactoring-break-tests-and-to-what-extent/?utm_source=chatgpt.com)) | **Strong corrective** to claims that all tests are constantly brittle |

That last result is important: **test brittleness is real, but it should not be exaggerated**. A well-designed suite does not inevitably collapse every time code is reorganized.

## Real defects and incidents: what could tests actually have prevented?

The unusually valuable study here is **Yuan et al. 2014**, because it starts with production failures rather than test metrics. The researchers randomly examined 198 user-reported failures from five mature distributed data systems. Despite the scale of those systems, almost all failures required three nodes or fewer to reproduce. Many needed particular *sequences* of events, and catastrophic cases were dominated by bad handling of otherwise non-fatal errors. ([Usenix](https://www.usenix.org/conference/osdi14/technical-sessions/presentation/yuan?utm_source=chatgpt.com))

That argues for tests around **failure semantics**—timeouts, corrupt responses, retries, partial writes, exception paths, recovery after an earlier error—rather than merely replaying the normal implementation structure. An error-handler test with three nodes might technically be an “integration test”, but its value comes from the scenario and oracle, not the taxonomy.

The OpenStack study is an interesting hybrid. Marques et al. first manually analyzed **2,048 real Nova bug reports**, extended the classification of 512 of them, and used those data to construct a realistic Python/OpenStack fault model. They then injected 11,309 faults and ran more than 245 million test executions. ([Scribd](https://www.scribd.com/document/1071706402/Martins-et-al-2022-Injecting-software-faults-in-Python-applications?utm_source=chatgpt.com)) In *that particular architecture*, local unit tests were extraordinarily effective, while the integration suite detected very few of the injected faults. Yet the authors still found complementary value from functional tests, and timing/serialization failures remained difficult at every level. ([Scribd](https://www.scribd.com/document/1071706402/Martins-et-al-2022-Injecting-software-faults-in-Python-applications?utm_source=chatgpt.com))

So this is evidence for **putting a defect check at the cheapest level capable of reproducing it**, not evidence for deleting integration tests.

There is also counter-evidence against interpreting the mere *presence* of unit tests as protection. Chioteli, Batas & Spinellis analyzed more than **2 million Eclipse crash reports**, reducing them to 126,026 unique stack traces, and related crashes to test coverage. Unit-tested code was not associated with fewer crashes. The authors explicitly discuss selection effects—the difficult, fault-prone code may be exactly the code developers choose to test—so this should not be read as “unit testing doesn't work.” It does demonstrate how poor a proxy “this method has unit tests” can be for field reliability. [ACM study record, 2021](https://research.tudelft.nl/en/publications/does-unit-tested-code-crash-a-case-study-of-eclipse/?utm_source=chatgpt.com) ([arXiv](https://arxiv.org/abs/1903.04055?utm_source=chatgpt.com))

Formal retrospective studies saying “this exact incident would have been prevented by test X” are surprisingly scarce. Many company postmortems recommend a missing regression test afterward, but those anecdotes suffer severe hindsight bias. The OSDI work is considerably stronger because prevention/reproduction was itself the subject of systematic analysis.

## Coverage and test quantity are weak proxies

Two studies deserve to shape team policy here.

In **ICSE 2014**, Inozemtseva & Holmes generated 31,000 suites across five substantial Java systems. After controlling for the number of test cases, statement, decision and MC/DC coverage had only low-to-moderate relationships with mutation effectiveness. Their recommendation is unusually clear: coverage is useful for identifying **untested regions**, but should not be a test-suite quality target. ([Computer Science at UBC](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf?utm_source=chatgpt.com))

Then Kochhar et al. looked at **real post-release defects** in 100 projects and found essentially no useful coverage/defect relationship. ([Microsoft](https://www.microsoft.com/en-us/research/publication/code-coverage-and-post-release-defects-a-large-scale-study-on-open-source-projects/?utm_source=chatgpt.com))

That does **not** mean coverage is useless. “0% coverage” is excellent evidence that a path is not dynamically tested. “95% coverage” is poor evidence that the tested behavior is correct.

A test such as:

```text
call calculateInvoice()
assert result != null
```

may execute every branch while being nearly useless against wrong prices. Coverage can tell you the code ran; it cannot tell you whether anyone noticed the wrong answer.

The automated-test-generation study makes this oracle problem concrete. Even sophisticated tools that obtain substantial coverage frequently failed to detect the actual Defects4J bug because the bad internal state either did not propagate to an observed value or the generated assertions did not distinguish correct from incorrect behavior. ([ResearchGate](https://www.researchgate.net/publication/281640540_Do_Automatically_Generated_Unit_Tests_Find_Real_Faults_An_Empirical_Study_of_Effectiveness_and_Challenges?utm_source=chatgpt.com))

## Assertions and test oracles matter at least as much as test inputs

This is one of the more consistent empirical themes.

Memon, Banerjee & Nagarajan's **ASE 2003** experiment constructed 11 different GUI oracle strategies, 100 faulty versions of each of four applications, and performed roughly 660,000 runs per application. Richer oracles detected faults earlier and needed fewer test cases, though each test was more expensive. [Study, 2003](https://www.cs.umd.edu/~atif/papers/MemonASE2003-abstract.html?utm_source=chatgpt.com) ([UMD Computer Science](https://www.cs.umd.edu/~atif/papers/MemonASE2003-abstract.html?utm_source=chatgpt.com))

Zhi & Garousi's **2013** empirical study of three open-source suites used mutation and state coverage to examine “inadequate assertions”; they found the problem widespread—on their measure, roughly 55–65% in some sampled suites—and associated with more complex test code. The important limitation is that their definition of assertion adequacy is mutation/state based, not observed real-bug prevention. [IEEE study record, 2013](https://pure.qub.ac.uk/en/publications/on-adequacy-of-assertions-in-automated-test-suites-an-empirical-i/?utm_source=chatgpt.com) ([ResearchGate](https://www.researchgate.net/publication/261092581_On_Adequacy_of_Assertions_in_Automated_Test_Suites_An_Empirical_Investigation?utm_source=chatgpt.com))

A newer **FSE 2026** study across 12 real projects reached a complementary result: human-written assertions often observe much less program state than is available. More systematic choices about which state to observe improved regression detection by an average 35.7%. Crucially, exhaustive state capture was not always necessary: carefully selected observable state could provide much of the benefit with vastly less oracle material. [FSE 2026 study](https://spideruci.org/publication/du-spectra-2026/?utm_source=chatgpt.com) ([ResearchGate](https://www.researchgate.net/publication/408291756_Revealing_Regressions_A_Comparative_Study_of_State-Capture_Strategies_in_Validating_Program_Behavior?utm_source=chatgpt.com))

There is also older Microsoft evidence concerning **runtime/software assertions**, rather than specifically xUnit assertions. Kudrjavets, Nagappan & Ball (**2006**) studied two commercial components and found higher assertion density associated with lower fault density; assertions also exposed many recorded faults. Because this is observational and only two components, causal claims should be restrained. [Microsoft Research, 2006](https://www.microsoft.com/en-us/research/publication/assessing-the-relationship-between-software-assertions-and-code-qualityan-empirical-investigation/?locale=zh-cn%2Fbibtex%2F&utm_source=chatgpt.com) ([Microsoft](https://www.microsoft.com/en-us/research/publication/assessing-the-relationship-between-software-assertions-and-code-qualityan-empirical-investigation/?locale=zh-cn%2Fbibtex%2F&utm_source=chatgpt.com))

So the useful principle is not “add lots of asserts.” It is **make the oracle sensitive to the ways the contract could be wrong**.

## Mutation testing: useful microscope, poor KPI

Mutation testing has some of the best evidence of any test-quality technique, but the nuanced conclusion matters.

Earlier work found encouraging relationships between mutants and real defects. The stronger corrective came from Papadakis et al. (**ICSE 2018**): after controlling for test-suite size, mutation score itself was only weakly predictive of real-fault detection. Nevertheless, when comparing suites of the **same size**, suites selected for higher mutation scores detected significantly more real faults. ([IEEE Xplore](https://ieeexplore.ieee.org/document/8453121/?utm_source=chatgpt.com))

That makes mutation particularly useful in this form:

> “Here is a concrete change that your existing tests fail to notice. Is that something they ought to notice?”

It is much less defensible in this form:

> “Our mutation score is 91.7%, therefore our software is safe.”

Google provides unusually strong industry evidence. Its **ICSE 2021** longitudinal study examined almost 15 million mutants over six years. Developers exposed to mutation feedback added more and better tests, and retrospective analysis of high-priority real defects found surviving mutants that would have signaled inadequate testing at the defect-introducing change. ([2021.icse-conferences.org](https://2021.icse-conferences.org/details/icse-2021-papers/70/Does-mutation-testing-improve-testing-practices-?utm_source=chatgpt.com))

But mutation has substantial cost. Google's separate **TSE 2021/2022** work says conventional whole-codebase mutation simply did not scale. Their practical system mutates only changed code, filters unhelpful mutants and selects operators based on historical usefulness. It was used across more than 24,000 developers and 1,000 projects and reduced mutant volume by orders of magnitude. [Practical Mutation Testing at Scale](https://research.google/pubs/practical-mutation-testing-at-scale-a-view-from-google/?utm_source=chatgpt.com) ([Google Research](https://research.google/pubs/practical-mutation-testing-at-scale-a-view-from-google/?utm_source=chatgpt.com))

That is probably the best-supported implementation policy: **mutation-test changed/high-risk code as a diagnostic, rather than making global mutation score a gate.**

## “Test the contract, not the implementation”

This slogan is primarily **design/practitioner literature**, not the conclusion of a controlled trial. But there is empirical evidence underneath part of it.

Martin Fowler's **2007** *Mocks Aren't Stubs* explicitly distinguishes tests that inspect resulting state from tests that specify the precise sequence of collaborator interactions. He points out that interaction-heavy/mockist tests are more coupled to implementation and therefore more likely to break under refactoring. He also presents the advantages of mockist testing rather than claiming mocks are simply wrong. [Mocks Aren't Stubs, 2007](https://martinfowler.com/articles/mocksArentStubs.html?utm_source=chatgpt.com)

Google's **2014–2015** Testing on the Toilet pieces are likewise practitioner guidance, **not empirical studies**. They advocate testing through public APIs and call tests that mechanically mirror code “change-detector tests.” One example asserts that collaborator A must be called and then collaborator B; rearranging the implementation while preserving its output makes the test fail. [What Makes a Good Test, 2014](https://testing.googleblog.com/2014/03/testing-on-toilet-what-makes-good-test.html?utm_source=chatgpt.com) [Change-Detector Tests Considered Harmful, 2015](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html?utm_source=chatgpt.com)

The important empirical support comes from Spadini et al.'s mock study. Across three open-source projects and one industrial system, production changes frequently forced mock changes; keeping fake expectations synchronized and the additional test/production coupling were prominent maintenance problems. ([Springer](https://link.springer.com/article/10.1007/s10664-018-9663-0?utm_source=chatgpt.com))

So “contract” should be interpreted carefully. It does **not** mean “only test the public HTTP endpoint.” A meaningful contract can be quite local:

- `sort(xs)` returns the elements ordered, without caring which sorting algorithm ran.
- A payment operation emits **one** charge, not merely the right return value. Here an interaction is genuinely part of the contract.
- A retry component must stop after three attempts. Number/timing of calls may therefore be behavior, not implementation detail.
- A protocol adapter must emit a particular wire representation. Exact bytes may be the contract.

The question is: **would a legitimate consumer notice the difference?** If yes, the test can justifiably observe it.

## What brittleness looks like empirically

Brittleness is best thought of as a high probability of a **false maintenance alarm**: the test requires editing even though the behavior relevant to its purpose has not become wrong.

Kashiwa et al.'s **ICSME 2021** study is particularly useful because it looked at 615,196 test cases around real refactorings. Most refactorings rarely broke tests, which argues against caricatures of unit suites as intrinsically fragile. But renaming attributes/classes and changes such as adding parameters or changing return types had materially higher breakage/edit costs. ([Waseda University Pure](https://waseda.elsevierpure.com/en/publications/does-refactoring-break-tests-and-to-what-extent/?utm_source=chatgpt.com))

Spadini et al.'s **ICSME 2018** analysis of more than one million test cases across 221 releases found that tests containing recognized “test smells” were more change- and defect-prone. Indirect Testing, Eager Test and Assertion Roulette were particularly associated with change-proneness. This is observational evidence: smelly tests may occur disproportionately in difficult code, so it does not prove that removing the smell will eliminate defects. [ICSME 2018 study](https://research.tudelft.nl/en/publications/on-the-relation-of-test-smells-to-software-code-quality/?utm_source=chatgpt.com) ([TU Delft Research Portal](https://research.tudelft.nl/en/publications/on-the-relation-of-test-smells-to-software-code-quality/?utm_source=chatgpt.com))

Even the individual-smell evidence is contested. A **2022** experiment with 42 students found only modest effects from Assertion Roulette, while a **2023** experiment with 96 students found that Assertion Roulette/Eager Test slowed troubleshooting, especially Assertion Roulette. Both use students and artificial tasks. ([Researcher Conference Management](https://conf.researchr.org/details/vlhcc-2022/vlhcc-2022-vl-hcc-main-conference/11/Is-Assertion-Roulette-still-a-test-smell-An-experiment-from-the-perspective-of-testi?utm_source=chatgpt.com)) That is a good example of an area where the evidence is too weak to justify rigid lint rules.

Concrete refactor-only breakages include an exact mock sequence failing because `A(); B()` became `B(); A()` even though the result is identical; dozens of tests requiring constructor edits because an irrelevant dependency was added; a test reaching into a private helper failing when the helper is inlined or extracted; an exact SQL-string assertion failing because the query was equivalently rewritten; or a DOM snapshot changing because a wrapper, CSS class, generated identifier or attribute ordering changed while user-visible semantics did not. The first two are represented directly in the practitioner literature and are consistent with the empirical mock/refactoring results. ([Google Testing Blog](https://testing.googleblog.com/2014/03/testing-on-toilet-what-makes-good-test.html?utm_source=chatgpt.com))

## Snapshot tests: criticism is plausible, but the evidence base is thin

The evidence here is noticeably weaker.

Cruz, Rocha & Valente's **Journal of Systems and Software 2023** paper is peer-reviewed, but its underlying data are a **grey-literature review** of 50 practitioner documents—not experiments showing how many real bugs snapshots catch. Practitioners most often praised ease of creation and regression detection; the dominant criticism was fragility and constant updating of the golden snapshot. The authors explicitly noted the scarcity of prior academic evidence. [Snapshot Testing in Practice, 2023](https://www.sciencedirect.com/science/article/pii/S0164121223001929?utm_source=chatgpt.com) ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0164121223001929?utm_source=chatgpt.com))

That makes the common snapshot failure mode credible but not strongly quantified:

```text
expected.html changed
```

The developer sees a 400-line diff, decides it looks unsurprising and updates it. If a genuine regression is buried among 399 intentional changes, the nominally very rich oracle has become a poor human oracle.

The newer FSE 2026 state-observation work gives the debate more substance. Broad snapshot-like state capture really can expose regressions, but carefully choosing observable state can retain substantial detection power while producing dramatically less oracle data. ([ResearchGate](https://www.researchgate.net/publication/408291756_Revealing_Regressions_A_Comparative_Study_of_State-Capture_Strategies_in_Validating_Program_Behavior?utm_source=chatgpt.com)) This supports a **signal-to-noise** criticism of huge snapshots rather than “snapshots cannot catch bugs.”

Snapshots are genuinely appropriate when the *whole deterministic artifact* is itself a useful contract: compiler output, generated source/configuration, serialization formats, protocol messages, rendered visual output, complex error diagnostics, or a large stable data structure where enumerating individual assertions would merely reproduce the same information less readably. They work best when snapshot changes are uncommon, reviewable and meaningful.

They are poor when the captured representation contains lots of incidental churn: random IDs, timestamps, ordering with no semantics, internal DOM structure, object addresses, whitespace or formatting that consumers do not depend upon.

## Characterisation tests: intentionally different from correctness tests

Characterisation testing has an even weaker empirical defect-detection literature. Its principal source is Michael Feathers' legacy-code work; his **2016** explanation is explicit that the purpose is to record **what the program currently does**, not to establish that what it does is correct. [Feathers, Characterization Testing, 2016](https://michaelfeathers.silvrback.com/characterization-testing?utm_source=chatgpt.com) ([michaelfeathers.silvrback.com](https://michaelfeathers.silvrback.com/characterization-testing?utm_source=chatgpt.com))

That distinction resolves much of the apparent contradiction with “don't write change-detector tests.”

A characterization test is appropriate when:

> “I am about to replace/refactor code whose real behavior I don't fully understand, and accidental behavior changes are currently riskier than preserving some questionable behavior.”

For example, before replacing a 20-year-old pricing parser, capturing 500 representative input/output pairs can be enormously valuable even if some outputs seem odd. It gives you a behavioral perimeter within which you can refactor.

It becomes harmful when the team subsequently treats every captured accident as a permanent requirement. Characterisation suites should normally lead to investigation: identify which behaviours are genuine contracts, write clearer contract tests for those, deliberately change known bugs where appropriate, and delete obsolete characterization checks.

So characterization testing is **a migration/refactoring technique**, whereas ordinary regression tests aspire to be statements about correctness. Conflating the two is the source of much snapshot controversy.

## What I would infer for the team

The evidence supports a policy more like this than a fixed testing pyramid:

1. **Start from failure modes and contracts.** Ask what can be wrong from a consumer/system perspective, including error and recovery behavior. Put each check at the cheapest test boundary capable of creating that condition and observing the right outcome. Production-failure studies support this much more strongly than arbitrary ratios of unit/integration/E2E tests. ([Usenix](https://www.usenix.org/conference/osdi14/technical-sessions/presentation/yuan?utm_source=chatgpt.com))
2. **Treat coverage as a searchlight, not a score.** Uncovered critical code is actionable; 100% coverage is not proof of a good suite. ([Computer Science at UBC](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf?utm_source=chatgpt.com))
3. **Review the oracle, not merely the setup.** For important tests ask, “What plausible bug would execute this test and still pass?” Mutation testing is one of the better-supported ways of answering that. ([IEEE Xplore](https://ieeexplore.ieee.org/document/8453121/?utm_source=chatgpt.com))
4. **Prefer observations stable under implementation substitution.** If replacing an algorithm, extracting classes, changing helper calls, or swapping persistence technology leaves the contract intact, most corresponding tests should remain green. Make exceptions where the interaction itself is contractually significant.
5. **Audit churn.** A particularly useful local metric may be “tests edited because behavior changed” versus “tests edited merely because implementation changed.” The latter is direct evidence of brittleness in *your* system, often more informative than generic arguments about testing schools.
6. **Keep a small number of boundary/E2E checks for failures that genuinely require boundaries.** Neither the OpenStack result nor the unit/integration comparison establishes that integration tests are generally waste; different levels can expose complementary faults. ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0164121219301955?utm_source=chatgpt.com))
7. **Use snapshots and characterization deliberately.** Snapshot a stable artifact when the artifact is the contract; characterize legacy behavior when preserving it temporarily is the goal. Do not confuse either technique with independently specifying correctness.

The clearest empirical warning sign is therefore not “too many unit tests” or “too many snapshots.” It is a suite where **large amounts of test code can be changed mechanically in parallel with a refactor without anyone having to reconsider an expected behavior**. That is very close to the phenomenon Google's “change-detector” terminology describes, and the mock/refactoring studies show that this kind of coupling has measurable maintenance consequences. ([Google Testing Blog](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html?utm_source=chatgpt.com))

The clearest positive sign is the opposite: a test survives arbitrary implementation rewrites but reliably fails under realistic mutations, historical regressions or reconstructed production failure conditions. That is the closest the available evidence gets to the team's stated goal: **tests that fail because the system is wrong rather than because the code is different.**
