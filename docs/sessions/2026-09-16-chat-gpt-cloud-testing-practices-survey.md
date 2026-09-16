# Cloud Testing Practices Survey

Source: https://chatgpt.com/share/6aaad279-5dc0-83ed-be36-b1f372c4ccbd

---

## Turn 1: User

_2026-09-16T17:16:45.611Z_

A solo developer has a private repository whose test suite is split: most tests are hermetic, and a small number would create real resources at a cloud provider, costing money and requiring an API token. Survey how real projects structure this. Cover: how the two suites are separated and named; how the credentialed suite is prevented from running by accident, locally and in CI; how spend is bounded and how leaked or orphaned resources are reclaimed; how secrets are protected in GitHub Actions for private repositories and what changes for forked pull requests; whether teams run such tests on every merge, nightly, or only manually, and what they report as the actual failure modes of each choice; and what the free-tier limits and billing model for GitHub Actions on private repositories are as of 2026. Also cover whether teams find CI worth configuring at all when a single developer already runs the full suite before pushing. Give concrete public examples and report where the practice is criticised.

---

## Turn 2: ChatGPT

_2026-09-16T17:16:45.927Z_

I’ll treat this as a practice survey rather than a “best practices” essay: I’ll pull concrete repository patterns, GitHub’s current 2026 Actions/security rules, and postmortem/issue evidence about what actually breaks. I’ll separate documented project behavior from my synthesis so you can see where there’s real precedent versus judgment.

---

## Turn 3: ChatGPT

_2026-09-16T17:17:14.135Z_

Two recurring patterns are already clear. Terraform-style projects call the paid suite **acceptance tests** and make it impossible to enter accidentally without an explicit opt-in such as `TF_ACC=1`; Python projects more often keep the same pytest tree but mark credentialed tests (`requires_credential`, `live`, `system`) and exclude those markers from ordinary runs. Terraform also documents the unpleasant part explicitly: teardown can fail because of provider/API errors or test bugs, so it adds destructive “sweepers” for leaked resources rather than assuming `finally` cleanup is enough.

---

## Turn 4: ChatGPT

_2026-09-16T17:17:57.010Z_

The strongest criticism is not “live tests are bad,” but that **where you schedule them determines which failure you buy**. Public evidence shows all three: AWS acceptance runs can hit provider service quotas; Azure live CI can go red from 500s, identity outages, and rate limits unrelated to the change; and a Proxmox provider contributor explicitly added a hermetic PR test because the real `testacc` workflow was manual-only and therefore did not guard PRs.

---

## Turn 5: ChatGPT

_2026-09-16T17:20:07.524Z_

The public-project pattern is quite consistent: **make the cloud-touching tests a visibly different tier, make that tier positively opt-in, and assume cleanup will sometimes fail**. What varies is cadence. Large providers can afford nightly or merge-time live testing; smaller teams increasingly push most coverage into hermetic/mock/recorded tests and reserve real-cloud acceptance tests for deliberate runs.

## How real projects split the suites

The terminology is not standardized, but the same concepts recur.

| Project / ecosystem | Hermetic side | Credentialed side | Accidental-run guard |
|---|---|---|---|
| Terraform / HashiCorp providers | ordinary unit tests | **acceptance tests**, conventionally `TestAcc*` | Terraform's test framework requires `TF_ACC` specifically to prevent unintended chargeable runs; HashiCorp also recommends a separate provider account/namespace. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests)) |
| AWS SAM CLI | ordinary/integration tests not needing AWS | tests marked `@pytest.mark.requires_credential`, collected into a `cloud-based-tests` CI job | normal build/local jobs explicitly use `-m "not requires_credential"`; the cloud job explicitly selects `-m requires_credential`. ([GitHub](https://github.com/aws/aws-sam-cli/blob/develop/CONTRIBUTING.md)) |
| Azure SDKs | unit tests plus extensive **recorded/playback** tests | **live tests** | playback is the normal mode; live operation is an explicit test mode, and the framework treats live/recorded tests specially because real shared resources can conflict. ([GitHub](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/core/Azure.Core.TestFramework/README.md)) |
| Redpanda Terraform provider | proposed `TestUnit*` and credential-free `TestIntegration*` against a fake server | `TestAcc*` against actual clouds | live tier needs both a build/tag selection and `TF_ACC=1` plus cloud credentials. ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda/blob/main/TESTING.md)) |
| Google Cloud Python libraries | unit tests | often called **system tests** | invoked through a separate system-test command/environment with a real Google Cloud project and credentials. |

The useful distinction is therefore usually **unit/integration/recorded** versus **live/acceptance/system**. “Integration” is ambiguous: AWS SAM uses it for quite realistic tests, while Redpanda explicitly wants “integration” to mean a fake in-memory API and reserves “acceptance” for real infrastructure.

A particularly useful 2026 public document is Redpanda's Terraform provider `TESTING.md`. It surveys six other mature providers and calls the naming taxonomy “load-bearing”: `TestUnit*`, `TestIntegration*`, and `TestAcc*`. Its existing live-only middle ground is described as “slow, expensive, flaky,” which is why the project proposes a hermetic integration tier between unit tests and real-cloud acceptance tests. ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda/blob/main/TESTING.md))

## Preventing an expensive test from running accidentally

Mature projects generally use **two independent gates**, rather than treating “credentials happen to be present” as permission to spend money.

Locally, Terraform is the clearest example. A `TestAcc*` function may sit beside ordinary `_test.go` tests, but Terraform's acceptance framework will not run it as an acceptance test unless `TF_ACC` is deliberately set. HashiCorp states explicitly that this exists to prevent unintended charges. It also recommends a separate test account so a faulty test cannot damage production infrastructure. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests?utm_source=chatgpt.com))

AWS SAM demonstrates the marker approach. Its normal jobs positively exclude credentialed tests, while a dedicated CI partition positively includes them. That is stronger than “skip if `AWS_TOKEN` is missing”: a developer who happens to have credentials in their shell can still run the ordinary test command safely. ([GitHub](https://github.com/aws/aws-sam-cli/blob/develop/CONTRIBUTING.md))

For a small private repo, that is the pattern I would copy: `pytest`/`go test`/`npm test` means **no billable side effects by definition**. A separate command such as `test-live` should require both an explicit selector and an opt-in variable. Merely detecting that `CLOUD_API_TOKEN` exists is a weak guard, because developers commonly have cloud credentials exported for unrelated work.

CI adds another boundary. Put live tests in a separate workflow or job, and make the permitted trigger explicit: for example, `workflow_dispatch`, a schedule, or a controlled main-branch event. The runner should not acquire cloud credentials until after those conditions have been checked.

## Spend containment and leaked resources

The experienced projects do not trust normal teardown alone.

HashiCorp's acceptance framework tries to destroy what it creates and can run a `CheckDestroy` assertion afterward. But HashiCorp separately documents **sweepers**, because leaked test resources are an expected operational problem: vendor API failures, bugs in resource/test code, or false reports of successful destruction can all strand infrastructure. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests/sweepers?utm_source=chatgpt.com))

There are two competing cleanup styles in public projects. The traditional Terraform-provider approach uses a periodically or manually run sweeper. Redpanda explicitly rejects that model for its smaller team and instead proposes per-package cleanup plus an **always-run CI cleanup step**, using a registry of resources created by the test. Its CI design runs the cleanup even after test failure or process trouble. ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda/blob/main/TESTING.md)) AWS SAM does something similar at account level: its integration workflow has an `if: always()` step that resets the test account after the suite. ([GitHub](https://github.com/aws/aws-sam-cli/blob/develop/.github/workflows/integration-tests.yml))

The important engineering pattern is three layers of containment:

1. **Limit the blast radius.** Use a dedicated cloud account/project/subscription, a narrowly scoped principal, restricted regions/services/SKUs where practical, and concurrency limits. Give every resource a recognizable test prefix/tag plus run ID and creation timestamp.
2. **Clean up in the test and again at job termination.** Normal fixture/`finally` teardown handles the happy case; a CI `always()` janitor catches failed tests.
3. **Have an out-of-band reclamation path.** A sweeper or janitor should list only resources with your test tags/prefix and delete those older than a conservative TTL. Never make a generic “delete everything” janitor usable against a production account.

That last layer matters because even mature suites leak. HashiCorp's documentation treats intermittent provider API errors as a normal leak cause rather than an exotic event. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests/sweepers?utm_source=chatgpt.com))

Spend itself is usually bounded indirectly, not by a perfect dollar circuit breaker. Real projects reduce fan-out, share expensive fixtures, limit parallelism and cadence, and isolate the account. Redpanda, for example, estimates one of its real clusters at roughly **30–50 minutes and $10–15**, and explicitly proposes consolidating many acceptance steps into one cluster lifecycle rather than creating one for each assertion. ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda/blob/main/TESTING.md))

Cloud quotas themselves can become a failure mode. Terraform AWS has a public issue where all Amazon Connect acceptance tests failed after the test account was flagged for an excessive number of create/delete operations and returned `ServiceQuotaExceededException`. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/issues/23381)) This is one reason “lots of cheap disposable tests” can still damage a dedicated account even when the invoice is tolerable.

## GitHub Actions secrets in a private repository

For a long-lived API token, GitHub repository secrets are the basic mechanism. But where the cloud supports it, **OIDC is materially preferable**: GitHub recommends federating the workflow to the cloud rather than keeping a long-lived cloud credential in GitHub at all. The workflow gets a short-lived identity token and exchanges it with the provider. ([GitHub Docs](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers))

AWS SAM is a real example. Its live integration workflow requests only `id-token: write` plus `contents: read`, then uses AWS's credential action to assume a role via OIDC; the action is pinned to a full commit SHA. ([GitHub](https://github.com/aws/aws-sam-cli/blob/develop/.github/workflows/integration-tests.yml)) GitHub likewise recommends full-SHA pinning because a SHA is the immutable way to reference a third-party Action. ([GitHub Docs](https://docs.github.com/en/actions/reference/security/secure-use))

If the provider only supports a static API key, keep it in a repository secret and give that API identity the minimum cloud permissions necessary. Don't put the value in workflow YAML, artifacts, caches, test snapshots, command-line arguments that get echoed, or generated test reports.

There is an important private-fork distinction. For a normal forked-PR workflow, GitHub's safe private-repository policy runs with a **read-only `GITHUB_TOKEN` and no repository secrets**. GitHub does expose settings that can deliberately send write tokens or all secrets to fork workflows, but enabling those means untrusted PR code can potentially reach those credentials. ([GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository))

Therefore the common design is:

**PR from same repo/fork → hermetic suite only.  
Trusted manual/main/scheduled workflow → live suite with cloud identity.**

Do not “solve” fork secrets by casually moving the test to `pull_request_target` and checking out/running the contributor's code. GitHub specifically recommends avoiding `pull_request_target` unless its privileged context is genuinely necessary. ([GitHub Docs](https://docs.github.com/en/actions/reference/security/secure-use))

One 2026 plan nuance is easy to miss. GitHub Pro users and Team organizations can create environments for private repositories, but **required environment reviewers on Free, Pro and Team are limited to public repositories**. So a solo developer on a private Pro repository should not design their safety model around an environment approval gate that their plan does not provide; `workflow_dispatch` plus branch/event restrictions is simpler. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments))

## Every merge, nightly, or manual?

There is no consensus because each option fails differently.

| Cadence | Why projects choose it | Failure mode seen in practice |
|---|---|---|
| **Every PR / merge** | Maximum chance of catching an API incompatibility before it lands. Snowflake-style provider testing has historically leaned this way. | Expensive and slow; shared resources collide; quotas/rate limits make unrelated PRs red; external outages become merge blockers. Azure's test framework explicitly documents HTTP 409 conflicts when concurrently running live suites touch the same resource. ([GitHub](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/core/Azure.Core.TestFramework/README.md)) |
| **Nightly / scheduled** | Tests provider drift without delaying every PR; catches breaking external-service changes even when your source did not change. | Failures are harder to attribute, often unrelated to a commit, and you pay even on days nobody changed relevant code. Terraform itself says failures caused by drift in unrelated external systems are “common and expected.” ([GitHub](https://github.com/hashicorp/terraform/blob/main/.github/CONTRIBUTING.md?utm_source=chatgpt.com)) |
| **Manual / labelled** | Human explicitly chooses to incur cost; simplest secret boundary; ideal for unusually expensive cases. | It is easy to forget, so live regressions no longer gate PRs. A current Proxmox-provider issue says precisely that acceptance testing “would also catch” a bug but `testacc.yml` was `workflow_dispatch`-only, so they added a hermetic PR regression test instead. ([GitHub](https://github.com/bpg/terraform-provider-proxmox/issues/3026?utm_source=chatgpt.com)) |
| **Hybrid** | Cheap deterministic tests on every change; paid suite only at selected points. | More infrastructure and two concepts to maintain, but it decouples code correctness from cloud availability. |

The public projects demonstrate all of these choices. AWS SAM runs its big integration workflow on pushes to `master`, on a weekday-night schedule, on releases, and manually. ([GitHub](https://github.com/aws/aws-sam-cli/blob/develop/.github/workflows/integration-tests.yml)) MongoDB Atlas's provider changelog records a historical change from running acceptance tests on PRs to manually triggering them. ([GitHub](https://github.com/mongodb/terraform-provider-mongodbatlas/blob/master/CHANGELOG.md?utm_source=chatgpt.com)) Redpanda's current testing design takes the opposite of “nightly by default”: unit/integration on every PR, but live acceptance only by PR label or human trigger; its document explicitly says “No cron. No nightly.” ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda/blob/main/TESTING.md))

The criticism of frequent live CI is backed by fairly dramatic examples. In March 2026, Azure SDK for JavaScript had **239 live-test failures** spanning HTTP 500s, an Azure AD degradation and rate limiting rather than corresponding code defects. One Azure OpenAI group alone had 220 failures, most recurring quota failures. ([GitHub](https://github.com/azure/azure-sdk-for-js/issues/37506)) That is the “false red” cost of making an external system part of your merge signal.

The criticism of manual-only testing is equally real: the Proxmox example above shows the blind spot directly. The usual remedy is not necessarily “run the expensive test on every PR”; it is to reproduce each discovered bug in the cheapest hermetic tier whenever possible, leaving the live suite responsible only for things that genuinely require the provider.

## GitHub Actions private-repo allowances and billing, September 2026

GitHub's current documentation gives these monthly allowances for standard GitHub-hosted runners: ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions))

| Plan | Included Actions minutes/month | Artifact storage | Cache |
|---|---:|---:|---:|
| GitHub Free | 2,000 | 500 MB | 10 GB/repository |
| GitHub Pro | 3,000 | 1 GB | 10 GB/repository |
| Free for organizations | 2,000 | 500 MB | 10 GB/repository |
| GitHub Team | 3,000 | 2 GB | 10 GB/repository |
| Enterprise Cloud | 50,000 | 50 GB | 10 GB/repository |

For private repositories, usage belongs to and is billed to the **repository owner**, regardless of who caused the run. Included minutes reset each billing cycle. Without a valid payment method, standard-runner use stops after the quota is exhausted; with billing enabled, excess use is metered. Larger runners are chargeable regardless of the included-minute allowance. ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions))

Current baseline overage rates are **$0.006/min for a standard 2-core x64 Linux runner, $0.005 for 2-core ARM Linux, $0.010 for Windows, and $0.062 for standard macOS**. Shared artifact/Packages storage over the allowance is $0.25/GB-month; Actions cache overage is $0.07/GB-month. Storage is accrued hourly. ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions))

For most solo projects, therefore, an ordinary Linux hermetic CI job is unlikely to be economically significant; **the cloud resources created by the live tests are usually the more important cost risk**. GitHub's runner bill and the cloud provider's resource bill are completely separate concerns.

## Is CI worth it for a solo developer who already runs everything before pushing?

There is a legitimate case against it. An older but still relevant Stack Overflow discussion captures the two sides well: some solo developers argue that maintaining CI is overhead when a disciplined developer already runs the tests, while others value CI precisely because it proves that the repository contains everything needed to build and test on a machine other than the developer's workstation. ([Stack Overflow](https://stackoverflow.com/questions/130592/is-continuous-integration-important-for-a-solo-developer))

For this particular scenario, I would separate **“CI is useful” from “the full live suite belongs in CI.”**

A tiny hermetic CI workflow has advantages even if you always test before pushing: it gives you a clean checkout with no untracked local files, no accidentally installed local dependency, a durable result attached to the commit, and a reproducible environment. Those catch a different class of mistake from simply rerunning the same suite on the same development machine. At 2,000–3,000 included Linux minutes per month on Free/Pro, the monetary reason not to do that is usually weak. ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions))

But if you already reliably run the **paid cloud suite** locally before pushing, automatically running exactly the same paid suite again after every push has much weaker marginal value. It doubles resource churn and can introduce cloud-service noise without adding much independent information. That is precisely the distinction visible in smaller-provider designs such as Redpanda's.

For the described solo private repository, the public evidence points to a fairly conservative shape:

- Make the default suite entirely hermetic and run it locally plus on every push/PR.
- Call the real-provider tier `live`, `acceptance`, or `system`; never hide it under the ordinary test command.
- Require two positive opt-ins locally—test selection plus something such as `RUN_LIVE_TESTS=1`—rather than treating the presence of a token as consent.
- Give the live suite a dedicated workflow. `workflow_dispatch` is a strong default for a genuinely costly handful of tests; add a nightly/weekly schedule only if provider drift is something you specifically want detected without a code change.
- Use OIDC rather than a persistent API token where the provider supports it; otherwise use a narrowly privileged repository secret. Never expose it to fork PR code.
- Use a dedicated test account/project, single live-suite concurrency, a timeout, test-specific resource tags/names, normal teardown, an `always()` cleanup step, and a TTL-based janitor/sweeper for anything the first two layers miss.

That is close to the direction the small-team Redpanda document explicitly argues for, while retaining HashiCorp's mature assumptions about isolation and leaked-resource recovery. ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda/blob/main/TESTING.md))

The central lesson from the criticism is that **a live cloud test should earn its place**. Every defect that can instead be locked down with a hermetic regression test should be. Real-provider tests are most valuable for the irreducibly external parts—authentication, provider/API semantics, eventual consistency, lifecycle behavior, quotas and real provisioning—not as an expensive second implementation of assertions that a fake or recorded API can prove deterministically.
