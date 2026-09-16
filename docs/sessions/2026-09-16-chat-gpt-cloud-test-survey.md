# Cloud Test Survey

Source: https://chatgpt.com/share/6aab1671-3830-83ed-a3e7-52b145121773

---

## Turn 1: User

_2026-09-16T22:14:30.273Z_

A small team has a test suite that mostly runs hermetically, plus a handful of tests that create real virtual machines at a cloud provider, costing money and consuming an account-wide resource limit. Survey how projects actually structure this in practice, from primary sources and real repositories. Cover: how the credentialed suite is separated and named; how it is prevented from running by accident; how resources are named or labelled so that leaks are identifiable and reclaimable later; what cleanup looks like when a test process is killed mid-run; whether teams use a dedicated account, a dedicated project, or neither, and what each actually protects against; how spend is bounded when the provider offers no spending cap; how flakiness from real provider latency and eventual consistency is handled without making the tests meaningless; and what these teams report as the failure modes that actually bit them. Include cases where teams concluded the live tests were not worth keeping, and say why. Do not assume the described setup is correct.

---

## Turn 2: ChatGPT

_2026-09-16T22:14:29.516Z_

I’ll treat this as an evidence survey rather than a design recommendation: I’ll compare several mature projects’ live-cloud test harnesses, then separate what their mechanisms actually protect against from what they merely make easier to recover from. I’ll also look specifically for postmortems/issues where live tests leaked resources, became flaky or expensive, or were deliberately reduced/removed.

---

## Turn 3: ChatGPT

_2026-09-16T22:14:54.768Z_

One pattern is already clear from the Terraform AWS provider: the “live” suite is not merely tagged differently; it has a separate invocation path (`TestAcc…`, `make testacc`, `TF_ACC=1`) and the contributor guide explicitly tells developers to keep ordinary unit-test runs free of AWS credentials. Its cleanup model also assumes leaks will happen: it has destructive sweepers intended only for an otherwise-empty development account.

---

## Turn 4: ChatGPT

_2026-09-16T22:16:47.807Z_

The more interesting distinction is between “cleanup at normal test exit” and “reclamation after the test runner disappears.” Terraform’s `CheckDestroy`/deferred destroy covers the first; HashiCorp sweepers and Kubernetes’ Boskos Reaper/Janitor cover the second. Boskos explicitly treats a killed client as an expected state-leak case: stale leases are reset to `dirty`, janitored, and returned to the pool.

---

## Turn 5: ChatGPT

_2026-09-16T22:17:47.591Z_

## What mature projects actually do

Across Terraform providers, Packer, Kubernetes test-infra/Boskos, Pulumi, and cloud-init, the recurring pattern is not “put credentials in CI and remember to clean up.” The live-cloud tests are treated as a different operational class of test: explicitly enabled, separately credentialed, uniquely identifiable, bounded in concurrency/lifetime, and backed by cleanup that survives the test process itself.

There is no universal name. HashiCorp usually calls them **acceptance tests**; Kubernetes tends toward **e2e**; Pulumi and cloud-init use **integration tests**. More important than the label is that they have a positive opt-in and a distinct execution path. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com))

| Project | Separation / accidental-run guard | Resource identity | Cleanup after abnormal exit | Isolation |
|---|---|---|---|---|
| Terraform AWS provider | `TestAcc…`, `make testacc`, and `TF_ACC=1`; normal `make test` is documented to run with AWS credentials absent | Randomized names from a common acceptance-test prefix; sweepers expect identifiable test resources | Per-test destroy/`CheckDestroy`, plus separately runnable destructive sweepers | Sweepers are explicitly intended for an otherwise-empty **development AWS account** |
| Packer | `PACKER_ACC=1`, `make testacc`; documented as slow/billable | Azure creates a random temporary resource group and correlated random resource names | Normal cleanup, whole-RG deletion on Azure; Google users reported scheduled janitors and later gained VM max-runtime support | Often same subscription/project unless operator provides stronger isolation |
| Kubernetes Boskos | CI jobs **lease** projects/accounts instead of receiving an unconstrained shared environment | Central lease record has resource name, owner, state and last-update time | Reaper detects stale ownership; Janitor cleans dirty allocations | Can lease whole GCP projects or even whole AWS accounts |
| Pulumi | Integration harness; service-dependent tests skip when required token is missing | Stack names such as `p-it-<host>-<test>-<random>` | Lifecycle includes destroy + stack removal; panic recovery is designed so one test does not stop other parallel tests cleaning up | Depends on the provider/account behind the stack |
| cloud-init | Separate integration-test environment and explicit platform such as `CLOUD_INIT_PLATFORM=ec2` | Harness owns the launched instance/image | Fixtures tear down instance and generated image by default | Depends on configured cloud credentials/account |

The Terraform AWS provider is particularly revealing because it has accumulated years of scars. The contributor guide says its regular test command should be run without AWS access keys or a default credentials profile; acceptance tests instead go through `make testacc`, which sets `TF_ACC=1`. `resource.ParallelTest` itself checks the opt-in variable, so merely having credentials available is not supposed to turn a unit-test invocation into a billable run. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/development-environment/?utm_source=chatgpt.com))

Packer uses the same positive-latch idea: `PACKER_ACC=1`. Its own repository warns that acceptance tests boot real machines, are slow, and cost money, and its plugin scaffolding teaches plugin authors the same convention. ([GitHub](https://github.com/hashicorp/packer/blob/main/AGENTS.md?utm_source=chatgpt.com))

That is materially safer than “skip unless credentials are present.” Credentials leak into developer shells, credential helpers and CI environments surprisingly easily. Pulumi does have tests that skip if `PULUMI_ACCESS_TOKEN` is absent, which is convenient, but the HashiCorp arrangement provides a stronger two-factor condition: credentials **plus an explicit test-mode latch**. ([GitHub](https://github.com/pulumi/pulumi/blob/master/tests/integration/integration_test.go?utm_source=chatgpt.com))

## Naming and identifying leaks

Real projects do not consistently depend on tags. Names, ownership records and enclosing resource containers show up at least as often.

Terraform's sweeper documentation explicitly says test resources need to be recognizable and gives a `test-acc`-style name prefix as the normal technique. The AWS provider then adds random suffixes through helpers such as `acctest.RandomWithPrefix(...)`, allowing parallel runs without giving up recognizable provenance. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests/sweepers?utm_source=chatgpt.com))

Packer's Azure builder goes further by putting a build's temporary resources in a disposable resource group. By default the group is named in a form like `packer-Resource-Group-<random>`, and the same random identity is reused across transient VM, NIC, disk, VNet and similar resource names. Cleanup can therefore be “delete the container” rather than reconstructing every child object Packer might have created. HashiCorp explicitly describes this as making failed cleanup easier. ([HashiCorp Developer](https://developer.hashicorp.com/packer/integrations/hashicorp/azure/latest/components/builder/arm?utm_source=chatgpt.com))

This is not just theoretical: in January 2026 the Packer Azure project added dynamic suffixing specifically because concurrent acceptance-test runs could collide; the PR says the change was for isolation, parallel reliability and safer cleanup. ([GitHub](https://github.com/hashicorp/packer-plugin-azure/pull/575))

Boskos takes a different approach. Rather than trusting names in the cloud as its primary source of truth, it maintains an external lease with an owner, state and last-update timestamp. That is a significant distinction: cloud labels can tell you “this looks like a test resource,” while an external lease can tell you “runner X owned this allocation and has not renewed it for N minutes.” ([GitHub](https://github.com/kubernetes-sigs/boskos?utm_source=chatgpt.com))

For a small bespoke harness, a synthesis of these practices is stronger than any single repository convention: use both a human-searchable prefix and a random run ID; where tags/labels exist, add suite/run/owner/creation/expiry metadata; and maintain enough state outside the process to enumerate a dead run. The `expires-at` tag is especially useful operationally, but it is a sensible extension of these examples rather than a convention I found uniformly implemented across the repositories.

## `defer` is not crash cleanup

Normal teardown and crash reclamation need to be designed separately.

Terraform acceptance tests perform destroy and usually a `CheckDestroy` API verification. But HashiCorp still maintains **sweepers**, explicitly because intermittent vendor errors, provider bugs and developer mistakes can leave resources behind. The AWS provider warns that its sweepers override protections and may destroy infrastructure and backups, which is why it says never to run them outside an empty development account. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests/sweepers?utm_source=chatgpt.com))

Boskos is probably the clearest production-scale answer to “what if the process receives SIGKILL?” A client leases a project/account into a busy state. A Reaper notices leases that have stopped updating, changes them to `dirty`, and a Janitor cleans them before making them available again. Its README explicitly says this exists to prevent state leaks when client processes die unexpectedly. Dynamic resources also have lifespans and are deleted when expired. ([GitHub](https://github.com/kubernetes-sigs/boskos?utm_source=chatgpt.com))

Packer users independently converged on the same thing. A Google Compute plugin issue describes temporary, non-reproducible failures leaving VMs running; the user's solution was a periodic cleanup job deleting Packer VMs that had lived too long. They requested provider support for GCE's maximum runtime and termination action so the VM itself could enforce the failsafe; that support was eventually added. ([GitHub](https://github.com/hashicorp/packer-plugin-googlecompute/issues/173?utm_source=chatgpt.com))

Packer also supplies an unusually concrete demonstration of why in-process cleanup is not enough: a Google Compute issue reported that a failed build left the VM and disk allocated because the expected cleanup path was not actually taken, whereas explicitly selecting cleanup removed both. ([GitHub](https://github.com/hashicorp/packer-plugin-googlecompute/issues/111?utm_source=chatgpt.com))

So `defer destroy()` is useful, but it is only the first line. A cleanup mechanism that must handle a killed process has to live elsewhere: a provider-side TTL, a watchdog/reaper job, an expiring lease service, or a disposable project/resource group that a later janitor can delete.

## Dedicated account, project, resource group—or neither?

These boundaries protect against different things, and conflating them causes trouble.

**A dedicated account/subscription** gives the strongest blast-radius boundary in the examples. Terraform AWS's destructive sweeper policy makes sense only because it expects an empty development account. AWS EC2 quotas are account-and-region scoped, so an independent AWS account also isolates those quotas from production. On Azure, VM/vCPU quotas are subscription-and-region scoped, so a separate resource group in the same subscription does *not* isolate that quota; a separate subscription does. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com))

What it does **not** necessarily isolate is the organization's bill. A test account connected to the same payer can still spend money. Nor does it help if the credential can assume privileged roles back into other accounts.

**A dedicated project** is much more meaningful on providers whose quotas and resources are project-scoped. Google documents Compute Engine quotas as generally applying at the project level, with usage in one project not consuming another project's quota. This is why Kubernetes test infrastructure can sensibly lease whole GCP projects through Boskos. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/quotas-limits?utm_source=chatgpt.com))

A project still does not normally constitute a billing cap. It principally isolates resources, IAM scope and project-scoped quotas.

**A resource group or equivalent namespace** is valuable for bulk reclamation and IAM restriction but is weaker. Packer points out the tradeoff directly: letting Packer create its own temporary Azure resource group makes failed cleanup easy because the whole group can be removed; using an existing group lets credentials be scoped more tightly, but leaves a greater chance of artifacts after failed builds. The Azure subscription's VM quota remains shared either way. ([HashiCorp Developer](https://developer.hashicorp.com/packer/integrations/hashicorp/azure/latest/components/builder/arm?utm_source=chatgpt.com))

**Neither** is viable only if you accept a larger blast radius. Random names prevent test-test collisions and allow a janitor to find leftovers, but they do not protect other workloads from shared quotas, a buggy sweeper, or runaway cost.

For the situation in the question, the phrase **“account-wide resource limit” matters more than the number of tests**. If that limit genuinely lives at account/subscription scope, putting tests in another project/resource group inside the same account does not solve the contention. Moving the tests to a boundary at or above the quota scope does.

## Bounding spend when there is no hard spending cap

The repositories generally bound the *causes* of spend rather than relying on billing to shut things off.

Boskos has explicit `min-count`, `max-count` and `lifespan` controls for dynamic resources; its documentation says dynamic allocations were introduced in part to reduce cost. Terraform AWS serializes tests for resources whose quotas are tiny and exposes explicit concurrency limits for resources such as Client VPN, Transit Gateway and Verified Access rather than always running its default 20 acceptance tests in parallel. ([GitHub](https://github.com/kubernetes-sigs/boskos?utm_source=chatgpt.com))

Packer's max-runtime work is another form of cost bounding: even if the test runner disappears, the VM has a provider-enforced upper lifetime. ([GitHub](https://github.com/hashicorp/packer-plugin-googlecompute/issues/173?utm_source=chatgpt.com))

That suggests a much more reliable notion of a “cap” for test infrastructure:

> maximum concurrent billable resources × maximum permitted lifetime × maximum unit price, plus separately bounded persistent/network resources.

It is not a billing-system cap, but unlike a cost alert it can be made mechanically enforceable before the bill is calculated.

Cloud billing budgets should therefore be treated as alarm/backstop infrastructure, not as the primary safety mechanism. Microsoft explicitly says Azure Cost Management budgets do not affect resources or stop consumption. Azure documents automation patterns that react to a budget event by stopping VMs, but that is orchestration layered on the alert, not an atomic spending ceiling. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/quick-create-budget-bicep?utm_source=chatgpt.com)) AWS Budgets can perform actions such as applying an IAM/SCP deny policy or targeting EC2/RDS resources at a threshold, which is useful as another backstop but still different from constraining the test fleet up front. ([AWS Documentation](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html?utm_source=chatgpt.com))

Deliberately low provider quotas can also be useful safety rails. The key is to distinguish them from the quota the test is intended to exercise: a quota set just above legitimate peak test use stops an explosion, whereas constantly running at the provider limit creates its own flaky-test failure mode.

## Keeping provider latency from turning the suite into noise

The Terraform AWS provider has fairly mature guidance here. It does **not** recommend arbitrary sleeps or indefinite retries. For known eventual-consistency failures it wraps specific API operations in bounded retries, typically around two minutes and at most roughly five, and distinguishes retryable provider responses from ordinary errors. Its documentation explicitly warns not to use retries to hide incorrectly ordered configurations. IAM propagation is called out as a common source of these transient failures. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/retries-and-waiters.md?utm_source=chatgpt.com))

That distinction is crucial for maintaining test value. Retry **the observation or operation whose consistency semantics are known**, rather than rerunning the entire test until something passes. Then keep a hard deadline and verify the eventual state.

The same provider uses prechecks for genuine environmental prerequisites, picks instance types that are actually offered in a region rather than hardcoding one everywhere, and serializes only resources whose service quota requires it. Those are ways of removing irrelevant environmental noise without weakening assertions about the provider behavior being tested. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com))

Pulumi's harness illustrates a somewhat broader approach: `RetryFailedSteps` can retry updates, refreshes and destroys up to three times. Importantly, its normal lifecycle still includes an update, state export/import, a preview expected to be empty, another no-op update, and destruction. So success means eventual convergence, not merely “one create call returned 200.” ([GitHub](https://github.com/pulumi/pulumi/blob/master/pkg/testing/integration/program.go?utm_source=chatgpt.com))

For VM tests specifically, the strongest meaningful assertion is generally not “VM launch completed in 17 seconds.” It is something like “within the provider's documented/observed convergence window, the requested VM reaches the expected state; its externally observable configuration is correct; deletion eventually makes it absent.” Latency is tolerated; semantic failure is not.

## The failures that actually bit these projects

The incidents are more instructive than the idealized harness designs.

Terraform AWS had an entire Amazon Connect acceptance-test area fail because the test account was flagged for an “excessive number” of instance creation/deletion attempts. The reported quota was not one they could simply increase through Service Quotas. This is a good example of a provider-side anti-abuse/service limit that a dedicated account does not magically remove. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/issues/23381?utm_source=chatgpt.com))

The same project's contributor guide has specific workarounds born from cleanup races: for example, logging can put new objects into an S3 bucket during a test, causing `BucketNotEmpty` deletion failures, so acceptance configurations are instructed to use forced bucket deletion where appropriate. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com))

Packer Google users reported both leaked VMs/disks from a cleanup-path bug and periodic leaks from temporary, non-reproducible failures. Those leaks hurt twice: they cost money **and** consumed project quota, making later CI jobs less reliable. ([GitHub](https://github.com/hashicorp/packer-plugin-googlecompute/issues/111?utm_source=chatgpt.com))

Packer Azure discovered concurrent-run naming conflicts late enough that it added automatic test-specific name suffixing in 2026. ([GitHub](https://github.com/hashicorp/packer-plugin-azure/pull/575))

Even the reclamation infrastructure can fail. In 2024 Kubernetes Boskos maintainers found projects wedged in an unexpected `"other"` state that the normal reaper did not repair; the issue discusses forcing unknown states back to `dirty`. In other words, a janitor needs monitoring and an escape hatch too. ([GitHub](https://github.com/kubernetes-sigs/boskos/issues/203?utm_source=chatgpt.com))

And some failures are really changes in the external product rather than regressions in the code being tested. That leads to the most interesting case of deleting live tests.

## When teams decided the live tests were no longer worth it

Packer's Azure plugin has an unusually explicit example. In April 2025 it **disabled two Azure DevTest Labs acceptance tests** after Azure removed support for Basic public-IP SKUs. The tests then required new networking/security-group setup to work. The maintainer documented several reasons for not paying that maintenance cost: DTL represented less than 1% of their internal usage telemetry, they suspected a meaningful fraction of even that traffic was their own acceptance tests, historical user issues were scarce, Azure itself showed little activity around the feature, and the available networking workarounds brought security/cost tradeoffs. They chose to spend engineering effort on the much more heavily used ARM and chroot builders instead. The maintainer also noted those tests had not historically been run regularly. ([GitHub](https://github.com/hashicorp/packer-plugin-azure/pull/490))

That case is worth taking seriously because “more realistic tests” are not automatically better tests. A live test whose dominant failure modes are external API churn, account peculiarities and fragile setup—and which protects a barely-used path—can consume more engineering attention than the regression risk it buys down.

Terraform AWS takes a less drastic version of the same economic view. Its maintainers explicitly identify services whose acceptance tests are unusually expensive and tell contributors who cannot afford them to submit best-effort tests and let maintainers run the live validation centrally. In other words, they preserve the tests but intentionally do **not** make every developer execute them. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com))

## What I would take from this for the small-team scenario

I would not start from “we have hermetic tests plus five cloud tests; how do we bolt the five onto CI?” The evidence points to asking whether each live case is buying a specific piece of coverage that cannot be obtained below the cloud boundary. For the ones that survive that test, the defensible structure is:

1. Call them something operationally explicit such as `acceptance` or `live`, and require a positive `LIVE_TESTS=1`-style latch **in addition to** credentials. Keep credentials unavailable to the ordinary test job.
2. Give every run a recognizable prefix plus an unpredictable run ID, and preferably provider labels for suite, run, owner and expiry. Never make cleanup depend solely on an in-memory list of IDs.
3. Normal teardown should verify deletion, but assume it sometimes fails. Have an independent hourly/daily reaper keyed by run identity or expiry; use provider-enforced VM lifetime when available.
4. Put the tests at an isolation boundary that matches the contested quota. For an AWS-account or Azure-subscription quota, a project/resource-group name is not sufficient. For GCP Compute project quotas, a dedicated project genuinely separates much of that contention. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/quotas-limits?utm_source=chatgpt.com))
5. Bound spend mechanically through maximum parallelism, allowed resource size/type, resource quotas and maximum lifetime. Treat billing alerts or budget-triggered shutdown as the final backstop rather than the cap.
6. Handle eventual consistency with narrow, error-aware bounded retries and state waiters. Do not make “rerun the whole test three times” the default success criterion.
7. Run the smallest useful live matrix. Tests protecting low-usage functionality with high setup cost deserve periodic/manual execution—or removal—rather than automatic elevation to a permanent per-PR tax.

The strongest lesson from these repositories is that **leaks and provider flakes are not exceptional cases to solve later**. Terraform built sweepers because cleanup fails; Kubernetes built leases and janitors because processes die; Packer users built scheduled cleanup because VMs survive jobs. A small suite does not need Boskos, but it does need those same failure assumptions. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests/sweepers?utm_source=chatgpt.com))

---

If you want, I can:

- Outline steps to implement a secure and isolated live test suite
- Describe best practices for handling cleanup of killed or crashed live tests
- Explain tradeoffs in isolation boundaries for live cloud tests
