# Cloud Testing Safety Guide

Source: https://chatgpt.com/share/6aa9f9c7-14e0-83eb-bda6-f8f221f8ae71

---

## Turn 1: User

_2026-09-16T02:04:33.820Z_

How do teams run tests against a paid cloud provider safely? Cover separate projects and
credentials, budget limits, leak detection for resources a failed test left behind, and how
often such tests run. Give concrete examples with citations.

---

## Turn 2: ChatGPT

_2026-09-16T02:04:32.685Z_

I’ll frame this as a practical operating model, then ground it in public examples from cloud vendors and infrastructure-tool projects—especially how they isolate credentials, cap spend, clean up leaked resources, and choose test cadence.

---

## Turn 3: ChatGPT

_2026-09-16T02:04:49.223Z_

The strongest pattern in the public examples is “contain the blast radius, don’t merely trust cleanup.” A failed test should leave garbage only inside an expendable test boundary, with short-lived credentials and an independent janitor that does not depend on the test process succeeding.

---

## Turn 4: ChatGPT

_2026-09-16T02:05:04.099Z_

Teams that test against AWS, GCP, Azure, or another metered provider usually treat “live cloud tests” as a distinct class of test: isolated, explicitly authorized, cost-controlled, and followed by independent cleanup. Terraform provider development is a particularly good public example because its acceptance tests actually create and destroy billable infrastructure. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests?utm_source=chatgpt.com))

| Concern | Common safe pattern | Concrete example |
|---|---|---|
| **Separate projects/accounts** | Give cloud tests their own AWS account, GCP project, or Azure subscription. Never point acceptance-test credentials at production. Ideally the test boundary contains nothing that cannot be deleted. | Terraform's testing guidance explicitly recommends a separate provider account/namespace. AWS itself describes accounts as a strong isolation boundary and recommends separating development/test from production. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests?utm_source=chatgpt.com)) |
| **Credentials** | Use a dedicated, least-privilege test identity and obtain **short-lived credentials through OIDC/workload federation**. Bind the trust policy to the repository/workflow/branch. Do not put permanent cloud keys in CI secrets unless federation is impossible. | GitHub Actions can exchange its OIDC token for temporary AWS credentials; AWS recommends temporary rather than long-lived credentials. Google Workload Identity Federation similarly exchanges external identities such as GitHub Actions for short-lived Google credentials. ([GitHub Docs](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws?utm_source=chatgpt.com)) |
| **Cost containment** | Put a budget on the test boundary, but also restrict expensive services, regions, machine sizes and quotas. Have progressively stronger responses at thresholds. | AWS Budgets can automatically apply an IAM policy/SCP or act on some EC2/RDS resources after a threshold. Ordinary GCP budget alerts do **not** cap spending; Google's newer spend-cap feature is currently limited to eligible services and doesn't stop ongoing charges from persistent resources. Azure budgets likewise notify but do not stop resources. ([AWS Documentation](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html?utm_source=chatgpt.com)) |
| **Resources leaked by failures** | Normal teardown is only layer one. Give every test-created resource a recognizable prefix/tag plus run ID and creation/expiry time, then run an independent “janitor” that enumerates and deletes stale test resources. | Terraform's testing framework has **sweepers** specifically because crashes, API failures and bugs can leak infrastructure. HashiCorp recommends recognizable names such as `test-acc`; its AWS provider warns that sweepers should run only in empty development accounts because they can aggressively destroy resources. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests/sweepers?utm_source=chatgpt.com)) |
| **Frequency** | Cheap unit/static tests run continuously; targeted live tests run for relevant changes; broad live suites normally run on a schedule such as nightly rather than on every commit. | The Terraform AWS provider says every PR gets linting, compilation, unit tests and static analysis, while billable acceptance tests are separately invoked and can be narrowed to particular resources. The Terraform Google provider runs broad acceptance testing nightly and runs sweepers after those nightlies. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com)) |

### A practical setup

A fairly conservative implementation looks like this:

1. **Provision a permanent “cloud-acceptance-tests” boundary.** For AWS, use a dedicated account in a sandbox/test OU; for GCP, a dedicated project or small set of projects; for Azure, a separate subscription. AWS even describes sandbox-per-builder/team with spend budgets as a common practice, while Azure recommends separate subscriptions for isolated application environments. ([AWS Documentation](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/experimental-ous.html?utm_source=chatgpt.com))

2. **Give CI an ephemeral identity.** A GitHub Actions job, for example, presents its OIDC identity and assumes something like `cloud-test-runner`. Restrict the trust relationship to the expected organization/repository and preferably branch or environment. Give that role only the APIs and regions needed by the tests. HashiCorp's HCP Terraform module testing uses the same model: an AWS role ARN is assumed dynamically rather than embedding permanent AWS keys. ([GitHub Docs](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws?utm_source=chatgpt.com))

3. **Make live testing opt-in at the test-framework level.** Terraform requires `TF_ACC` before its acceptance-test helpers will execute, specifically to reduce accidental billable test runs. A similar internal flag such as `LIVE_CLOUD_TESTS=1` is useful because `go test`, `pytest`, etc. should not silently start instances just because somebody ran the normal test suite. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests?utm_source=chatgpt.com))

4. **Stamp everything:** for example `test=true`, `run_id=123456`, `repo=foo`, `created_at=...`, `expires_at=...`. Use generated names such as `acc-123456-...`. The important property is that a cleanup process can distinguish test-owned infrastructure without relying on the original test's state file.

5. **Have two cleanup paths.** The test itself performs `destroy` in a `finally`/defer phase and then queries the provider to verify deletion. Independently, a scheduled sweeper lists resources matching the test marker and deletes anything older than a TTL. Terraform's AWS tests use `CheckDestroy` to verify resources disappeared, while its sweeper framework exists for cases where that normal teardown fails. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com))

6. **Put cost controls outside the test.** For example, deny GPU/high-end instance families, disallow most regions, cap service quotas, alert at perhaps 50/80%, and at a higher threshold block further creation where the provider supports it. This matters because “$500 budget” generally does **not** mean “the provider will stop billing at exactly $500.” GCP and Azure explicitly document this limitation for ordinary budgets. ([Google Cloud Documentation](https://docs.cloud.google.com/billing/docs/how-to/budgets?authuser=7&utm_source=chatgpt.com))

For cadence, I would normally use **unit/mock tests on every commit and PR; targeted live-cloud tests on changes affecting the relevant provider/resource; a broader live suite nightly; and exceptionally expensive or destructive scenarios less frequently or before releases**. The key public precedent is the Google Terraform provider: it has distinct GA, Beta and VCR test projects, runs its acceptance suites nightly, then runs service sweepers and finally a project sweeper after the other jobs have completed. That ordering prevents the janitor from deleting infrastructure belonging to still-running tests. ([GitHub](https://github.com/hashicorp/terraform-provider-google/wiki/Developer-Best-Practices?utm_source=chatgpt.com))

The main design principle is that **cleanup code is not the safety boundary**. The account/project boundary, restricted temporary credentials, provider-level guardrails and cost controls limit the damage; teardown and sweepers then keep the environment clean.
