# Test Repository Organization

Source: https://chatgpt.com/share/6aa92dba-a428-83ed-a89d-fa0f9a627ff6

---

**User**

Context: A TypeScript repository has product code and a small number of deliberately chosen tests. Some tests are pure and instant; some start a container and take a minute. The team has not decided where test files live, how they are named, or how the slow ones are kept out of the fast path.

Question: How do well-regarded repositories arrange their tests, and what follows from each arrangement?

Cover: tests beside the code versus a separate tree; naming conventions; splitting by speed, by layer, by domain, or not at all; how slow suites are separated and when they run; shared fixtures and helpers and how they are prevented from becoming a second untested framework; and how a repository keeps a suite honest when it cannot be run on every change.

Include examples from at least one large monorepo, one widely used library, and one infrastructure tool, and say how many tests each has relative to its size.

Evidence rules: cite the repositories directly with dates. Say which conventions are enforced by tooling and which are habit. Include arrangements that the projects themselves later changed, and why.

---

**ChatGPT**

I’ll ground this in repository layouts and CI/config files, not style-guide summaries. I’ll also distinguish “the runner makes this true” from “contributors usually do this,” because that is where many test-layout recommendations become misleading.

---

**ChatGPT**

One useful distinction is already visible in the examples: mature repos rarely encode “unit/integration/e2e” only in directory names. They usually make the expensive boundary executable—via Bazel targets/tags, a dedicated command/config, or an opt-in environment variable—so “fast by default” cannot silently regress into “sometimes starts Docker.”

---

**ChatGPT**

The library case has an instructive wrinkle: date-fns has recently become a monorepo root, so I’m treating layout claims as dated observations rather than timeless rules. That also gives a concrete example of why copying a famous repository’s current folder names without copying its runner configuration is unsafe.

---

**ChatGPT**

The strongest pattern is not “put unit tests here and integration tests there.” It is to treat **ownership/layout** and **execution cost** as separate design problems. Mature repositories tend to organize tests physically by the code or domain they belong to, while making “may contact the network / start a service / take much longer” an explicit runner or CI boundary. Directory names help humans; the command that selects the suite is the real control.

For scale, I used a deliberately crude but comparable measure: conventional test files divided by all primary-language files at a dated repository snapshot. It is **test-file density, not test-case count**—parameterization and large test files make case counts misleading. At Angular commit `c60c41e` (committed September 13, 2026), GitHub finds 711 `_spec.ts` files among 6,016 TypeScript files; at Zod `59bbc03` (September 13), 195 `.test.ts` files among 425 TypeScript files; at Terraform `4c9023a` (September 15), 658 `_test.go` files among 1,752 Go files.         

| Repository | Physical arrangement | Operational split | What is actually enforced | Test-file density |
|---|---|---|---|---:|
| **Angular** — large monorepo | Mostly package-local test trees such as `packages/core/test/acceptance/component_spec.ts`; also distinct repository-level `integration/` and other specialized areas. ([GitHub](https://github.com/angular/angular/blob/main/packages/core/test/acceptance/component_spec.ts?utm_source=chatgpt.com)) | Bazel targets. Ordinary CI deliberately excludes `//integration/...` and several other suites; `integration-tests:ci` selects `//integration/...` separately. ([GitHub](https://github.com/angular/angular/blob/main/package.json?utm_source=chatgpt.com)) | **Enforced:** Bazel target/CI selection. **Mostly convention:** `_spec.ts` and finer folder taxonomy; a file matters because a BUILD target includes it, not because its English label says “acceptance.” | 711 / 6,016 TS = **11.8%** |
| **Zod** — widely used TS library | A middle ground: tests are in `tests/` directories *inside* implementation/domain slices, e.g. `packages/zod/src/v4/classic/tests/lazy.test.ts`. ([GitHub](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/tests/lazy.test.ts?utm_source=chatgpt.com)) | Core tests are simply `pnpm test`/Vitest; the project does not invent a fast/slow taxonomy for a largely fast library suite. Separate resolution/integration packages get their own jobs. ([GitHub](https://github.com/colinhacks/zod/blob/main/CONTRIBUTING.md?utm_source=chatgpt.com)) | **Enforced:** the commands/hooks/CI that invoke Vitest. **Documented convention:** create tests in each workspace's `tests` directory; `.test.ts` is the prevailing discoverable naming pattern. ([GitHub](https://github.com/colinhacks/zod/blob/main/CONTRIBUTING.md?utm_source=chatgpt.com)) | 195 / 425 TS = **45.9%** |
| **Terraform** — infrastructure tool | Ordinary tests sit with their Go packages as `_test.go`; a few genuinely cross-cutting systems have separate areas such as `testing/equivalence-tests`. ([GitHub](https://github.com/HashiCorp/terraform?utm_source=chatgpt.com)) | Default unit suite is offline/self-contained. Tests hitting external systems are explicitly enabled with `TF_ACC=1`, normally scoped to the affected package. ([GitHub](https://github.com/hashicorp/terraform/blob/main/.github/CONTRIBUTING.md?utm_source=chatgpt.com)) | **Hard-enforced:** Go only treats `_test.go` as test source. **Hard operational boundary:** acceptance behavior is opt-in through `TF_ACC`. “Acceptance” as a conceptual label is secondary. | 658 / 1,752 Go = **37.6%** |

## Beside the code or a separate tree

For a **small, deliberately selected suite**, exact or near colocation has an important advantage: tests participate in the same mental unit as the implementation. A rename or deletion makes the associated test conspicuous; reviewers looking at a domain see its tests; and there is no second directory hierarchy that gradually stops matching the product hierarchy.

Zod illustrates the useful compromise. It does not require every `foo.ts` to have `foo.test.ts` next to it, but it keeps `tests/` inside the implementation slice. Angular does something similar one level higher: `packages/core/src/...` and `packages/core/test/...` belong to the same package, while truly cross-package integration work gets a repository-level boundary. ([GitHub](https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/classic/tests/lazy.test.ts?utm_source=chatgpt.com))

A top-level mirror such as `tests/unit/domainA/...` becomes attractive when test code has a **different operational environment**—large fixture trees, an assembled application, deployment manifests, certificates, Docker Compose files, browser projects. Its cost is indirection. A product move now needs a corresponding test-tree move, and stale tests can look perfectly tidy while having lost their obvious owner.

So the practical rule is: **organize physically by the most durable thing, usually domain/ownership. Split physically only when the harness itself is cross-cutting.** “Fast” and “slow” are usually not durable enough to deserve the primary directory hierarchy.

## Naming and what the name should encode

The least surprising TypeScript convention is one ordinary suffix, normally `*.test.ts` or `*.spec.ts`, throughout the repository. Pick one rather than assigning philosophical meaning to both. Angular strongly prefers `_spec.ts`; Zod prefers `.test.ts`. Neither choice carries useful semantics by itself.

If one class of tests has a concrete operational property that must never enter the inner loop, adding one modifier is useful. In the repository you described, `repository.test.ts` versus `repository.container.test.ts` is clearer than `unit` versus `integration`: “container” tells you exactly why it is expensive. Then make the runner use that distinction. A naming rule that CI does not parse is only a comment.

Layer labels such as `unit`, `integration`, and `e2e` work when the architecture has genuine layer contracts, but they decay surprisingly quickly. A test can exercise five modules yet be pure and take 3 ms; another can test one adapter but launch PostgreSQL and take a minute. For developer feedback, **resource requirement and duration matter more than the textbook layer name**.

That gives four reasonable axes with different jobs: domain should normally drive directories; layer can describe test intent where genuinely useful; speed/resource class should drive runner selection; and no classification at all is best when the entire suite is fast. Zod is a good example of the last case rather than creating categories merely because categories sound mature. ([GitHub](https://github.com/colinhacks/zod/blob/main/CONTRIBUTING.md?utm_source=chatgpt.com))

## Slow tests: separate execution, not merely separate prose

Angular makes this concrete. Its current root scripts define normal CI as a Bazel selection that explicitly subtracts `//integration/...` and several other specialized targets, while `integration-tests:ci` explicitly selects `//integration/...`. That is much safer than “developers know not to run that folder.” ([GitHub](https://github.com/angular/angular/blob/main/package.json?utm_source=chatgpt.com)) Angular's contributor guide also says Bazel is the primary build/test system, contributors should run package tests before submission, affected tests run on CI, and a PR cannot merge unless the tests pass. ([GitHub](https://github.com/angular/angular/blob/main/contributing-docs/building-and-testing-angular.md?utm_source=chatgpt.com))

Terraform makes the same separation without moving the files. Unit tests remain colocated and offline; external-service tests stay in their natural packages but are inert unless `TF_ACC=1` is set. The contributor guide recommends enabling them only for the relevant package, both to shorten the run and to avoid failures caused by unrelated external-system drift. ([GitHub](https://github.com/hashicorp/terraform/blob/main/.github/CONTRIBUTING.md?utm_source=chatgpt.com)) This is an important counterexample to the idea that a slow suite must live in `tests/integration/`.

For your particular numbers, a test taking **one minute** is slow for an edit–test loop but not necessarily slow for pull-request CI. I would keep it out of the default local `test` command while still running the container suite as a separate, visible CI job on every PR if the total is only a few minutes and reasonably reliable. “Not in the fast path” and “not on every change” are different decisions.

If eventually it becomes too expensive for every PR, use targeted/path-aware execution for relevant changes plus an unconditional backstop on main or the merge queue and a scheduled clean-environment run. Do not let “nightly” become the *only* place it runs: that turns failures into archaeology.

## Fixtures and helpers

The healthiest test support code is deliberately boring. Static fixture data can be widely shared. Factories can remove irrelevant setup. A container lifecycle wrapper can standardize start/stop and readiness. The warning sign is when the helper starts containing branching business logic, retries, implicit state, its own object model, or a mini-DSL that makes test code unreadable without learning another framework.

At that point it should be treated like product code: narrow API, explicit owner, and tests of its own. A useful threshold is not a specific line count but **whether a bug in the helper could make many tests pass incorrectly**. If yes, leaving it untested defeats the suite.

Angular has a very recent example of pruning this kind of support structure. Its September 13, 2026 commit moved animation acceptance tests away from a bespoke `fakeAsync` frame utility toward async/await and a shared animation-frame helper, then removed the obsolete helper and its Bazel dependency.  The lesson is not “always centralize helpers”; it is that shared test abstractions should be removable when the platform or test style makes them unnecessary.

For a small TypeScript suite, I would therefore start with local factories and fixtures. Promote something to `test/support` only after multiple tests genuinely need the same behavior. Keep container support as a thin adapter over the underlying container library rather than creating your own orchestration API.

## Keeping a suite honest when it cannot run everywhere

There are two different failure modes: a slow suite can **fail**, or it can silently stop being meaningful. The latter is worse. A credible setup therefore needs selection integrity and freshness: the slow command should fail if it unexpectedly discovers zero tests; scheduled/main runs should have an owner and visible last-success status; quarantined tests should have explicit owners/expiry rather than becoming permanent skips; and release policy should say how recent a successful slow run must be when that suite is not a per-PR gate.

External dependencies need an additional distinction between **signal** and **gate**. Zod has a particularly clean recent example. On July 13, 2026, issue #6185 documented that every PR had been red since TypeScript 7.0.2 became npm's `latest`, including documentation-only changes—the bleeding-edge compiler leg was breaking the build for an external/toolchain reason. ([GitHub](https://github.com/colinhacks/zod/issues/6185?utm_source=chatgpt.com)) Its current release workflow now says explicitly that the publishing matrix is deliberately narrower than `test.yml`: stable TypeScript versions gate publishing, while `test.yml` carries the TypeScript 7 signal, because a bleeding-edge compiler regression must not block a release. ([GitHub](https://github.com/colinhacks/zod/blob/main/.github/workflows/release.yml?utm_source=chatgpt.com))

That is a useful model for slow or environmentally fragile tests too: **do not suppress valuable signal just because it is unsuitable as a universal gate. Give it a separate lane with a clear escalation policy.**

Terraform's guide describes the other half of the problem: acceptance tests against external systems can fail because those systems drift. It recommends first running the existing acceptance tests against an unchanged worktree before blaming a new change. ([GitHub](https://github.com/hashicorp/terraform/blob/main/.github/CONTRIBUTING.md?utm_source=chatgpt.com)) That is essentially a control experiment, and it is especially valuable for container/service tests whose environment may move independently of the product.

## What I would adopt for the TypeScript repository you described

With only a handful of intentionally chosen tests, I would **not** create `tests/unit`, `tests/integration`, `tests/e2e`, and a parallel copy of the source tree. Keep ownership local. Put pure tests beside their subject as `foo.test.ts`; put a container test beside its subject as `foo.container.test.ts` unless it genuinely tests several domains, in which case a small top-level `test/container/` area is justified.

Then make the distinction executable: the normal `test`/watch command explicitly excludes `*.container.test.ts`; `test:container` explicitly includes it; CI shows them as separate jobs. Imports of your container library can even be lint-restricted to `*.container.test.ts` or `test/container/**`, which turns “fast tests must stay pure” from tribal knowledge into an enforceable invariant.

The resulting policy is small enough to remember: **location says who owns the test; the filename says that it is a test and, only when necessary, what expensive resource it needs; runner configuration determines what executes; CI determines when.** Angular, Zod, and Terraform differ substantially in directory layout, but all three point toward that separation of concerns rather than toward one canonical `tests/` tree.
