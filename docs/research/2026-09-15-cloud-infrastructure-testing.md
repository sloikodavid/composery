# Cloud Infrastructure Testing

Source: https://chatgpt.com/share/6aa92d05-8b78-83ed-9967-faa4d137a577

---

**User**

Context: A team can create real cloud servers in tests. Each run costs a little money and takes minutes, and a failed run can leave resources behind that continue to cost money.

Question: How do teams handle tests that create real infrastructure, and what do they run instead in everyday development?

Cover: how often such tests run and who triggers them; how resources are guaranteed to be cleaned up, including after a crashed run; how cost is bounded; how credentials are handled; what is asserted in those tests that cheaper tests cannot assert; and what teams report about whether the expense was worth it.

Include the practice of testing against a provider's own emulator or a local API implementation, and evidence on how faithful those are.

Evidence rules: cite documentation, repositories and engineering write-ups with dates. Include reports of these suites being removed or reduced, with the stated reason.

---

**ChatGPT**

I’m going to anchor this in concrete engineering practices rather than generic advice: provider acceptance-test docs, CI/repository evidence, emulator limitations, and examples where teams explicitly cut back expensive real-cloud suites.

---

**ChatGPT**

The pattern is already fairly consistent across mature provider projects: cheap deterministic tests are the default PR loop; live-cloud tests are a gated “confidence layer,” not the inner loop. I’m checking the less obvious parts now—crash cleanup, credential isolation, and cases where teams decided the live suite was not earning its keep.

---

**ChatGPT**

One important caveat from the evidence: “cleanup is guaranteed” is too strong if it means “the test’s `defer` always runs.” Mature systems treat cleanup as **eventual and out-of-process**: normal teardown first, then CI `always` cleanup and/or a sweeper that inventories the dedicated test account. GitLab’s 2025 experience shows even sophisticated destroy jobs can lose to corrupt state and orphaned resources, so inventory-based cleanup matters.

---

**ChatGPT**

Teams that do this successfully usually treat **real-cloud infrastructure tests as acceptance tests, not as the everyday development loop**. The common architecture is a three-level test stack: fast code-level tests, a local/mock/emulator integration layer, and a deliberately gated live-cloud layer.

| Layer | Typical cadence / trigger | Credentials & cost | What it proves |
|---|---|---|---|
| Unit / provider logic | Every edit, push and PR | None | Schema logic, serialization, diff/plan behavior, validation, helper functions |
| Fake API / emulator / recorded API | Local development and every PR | Usually none | Full client/provider request paths, CRUD wiring, error handling, import/state transformations |
| Real cloud acceptance | Targeted before merge, PR label/manual trigger, nightly, or release gate | Dedicated test credentials; real spend | The provider/service really creates, updates and destroys resources; real API semantics, defaults, asynchronous behavior, eventual consistency and upstream API changes |

The Terraform AWS provider is a good representative example. Its current contributor guide, checked **15 September 2026**, says ordinary CI on every PR does linting, compilation, unit tests and static analysis, whereas acceptance tests interact end-to-end with AWS and create real billable resources. Acceptance tests require the explicit `TF_ACC=1` opt-in, can be targeted down to one resource or one test, and tests longer than five minutes can be excluded with `-short` during intermediate development. The guide recommends rerunning the affected long tests before submitting the PR. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/))

### How often live tests run, and who triggers them

There is no universal “nightly” rule. The cadence is proportional to both cost and the value of detecting provider drift.

For API-provider projects, nightly can be justified because the service can change even when the client code does not. A HashiCorp engineer described on **22 August 2020** how provider teams ran acceptance tests manually while developing and also nightly, specifically so that a remote API change would be detected. The current Google provider process still reflects that model: its Release Shepherd page, edited **2 March 2026**, makes triaging both GA and Beta nightly-test failures a daily responsibility and also has the shepherd check the nightly VCR record/replay suite. ([HashiCorp Discuss](https://discuss.hashicorp.com/t/dynamic-test-environments/13200))

Expensive suites are more often human-gated. MongoDB Atlas changed its acceptance workflow in **September 2020** from running on PRs to running only when a collaborator added a `run-testacc` label; the change was merged **28 September 2020**. The PR documents the gating change but does **not** claim cost as the reason, so it should not be read as evidence of a cost-driven change. ([GitHub](https://github.com/mongodb/terraform-provider-mongodbatlas/pull/319))

A current example is the Redpanda Terraform provider repository, checked **15 September 2026**: its PR process exposes separate labels such as `ci-ready`, `ci-ready-byoc`, and `ci-ready-serverless` to request real-cloud suites, while its recommended local workflow is unit and credential-free colocated integration tests. Its README explicitly warns that the manual cluster commands create real resources and may incur costs. ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda))

So in practice, “every PR” means cheap tests. Real infrastructure tends to mean **changed-resource acceptance tests, a maintainer/PR-label gate, a nightly drift detector, or a release gate**, depending on price.

### Cleanup: the important part is surviving a dead test process

Normal teardown is straightforward but insufficient. Terraform’s AWS acceptance harness automatically destroys what it created and then calls the actual AWS API to verify deletion; if the object is still present, the test reports a dangling resource. That catches broken delete implementations rather than merely trusting Terraform state. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/))

But `defer`, `finally`, `t.Cleanup`, or even the test harness’s destroy phase cannot guarantee cleanup if the process is killed, the runner disappears, Terraform state becomes corrupt, or the provider API is unavailable. The Google provider documentation says explicitly that panics, failed deletes and interrupted post-test destruction leave dangling resources. Its answer is an independent **sweeper**: list resources in the dedicated test project, decide which are test leftovers, and delete them. CI sweepers run after nightly tests, with project deletion deferred until other builds are finished. That page’s relevant sweeper guidance was expanded in the wiki history on **27 November 2024**. ([GitHub](https://github.com/hashicorp/terraform-provider-google/wiki/Developer-Best-Practices))

A useful two-layer variant appears in Redpanda’s current testing design: package-level cleanup after the test process, plus an `always-runs` CI postscript that invokes cloud cleanup commands specifically as protection against failed `TestMain` execution or crashed test processes. Resources are tagged/suffixed with the commit SHA so cleanup can distinguish this run from another concurrent run. ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda/blob/main/TESTING.md))

Even that is not an absolute guarantee. GitLab documented the failure mode vividly in an MR opened **4 November 2025** and edited **10 November 2025**: despite increasingly sophisticated destroy handling and cleanup scripts, flaky pipelines left corrupt Terraform state and orphaned AWS/GCP resources; cleanup fell behind, quotas were hit, and people eventually had to enter the accounts and clean them manually. Their mitigation included reusing resources per merge request instead of creating a fresh set for every pipeline, graceful SIGINT rather than SIGKILL, serialization, and cloud-specific cleanup scripts. ([GitLab](https://gitlab.com/gitlab-org/ci-cd/runner-tools/grit/-/merge_requests/302))

That leads to a practical rule: **cleanup that must survive crashes cannot depend solely on the state file or the process that created the resource**. Use normal destroy first, but also make resources discoverable from outside the run—dedicated account/project, predictable prefixes/tags/run IDs and timestamps—and have an independent janitor/sweeper. “Guaranteed” realistically means bounded-time eventual cleanup, not a mathematical guarantee during a cloud outage.

### How teams bound the bill

The first bound is opt-in. HashiCorp’s `TF_ACC=1` exists partly to stop an innocent `go test ./...` from provisioning AWS. The second is **scope**: run one changed resource/service instead of the provider’s entire acceptance suite. The third is **lifetime**: create, assert, destroy within the same test. The fourth is **reuse**: exercise many mutations and dependent objects against one expensive base resource rather than repeatedly provisioning it. Google’s provider best practices, edited **5 June 2025**, specifically recommend putting many field create/update cases into one acceptance test to reduce total test time. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/))

The economics can be stark. Redpanda’s current testing analysis estimates a real cluster at roughly **30–50 minutes and $10–15**, which is why its proposed methodology consolidates multiple resource/datasource scenarios around one cluster and reserves live runs for explicit labels. Whether that exact number applies elsewhere is immaterial; the useful pattern is making the expensive object the reusable fixture rather than the unit of every assertion. ([GitHub](https://github.com/redpanda-data/terraform-provider-redpanda/blob/main/TESTING.md))

Quotas also act as a safety ceiling, though relying on them as the primary cost control is a mistake: GitLab’s 2025 report shows that reaching cloud quotas simply converts leaked-resource spend into broken CI. ([gitlab.com](https://gitlab.com/gitlab-org/ci-cd/runner-tools/grit/-/merge_requests/302))

### Credentials and blast radius

Live suites are normally pointed at a **test account/project**, not production, with credentials injected at runtime rather than committed to the test. The AWS provider accepts an AWS profile or environment credentials and even supports alternate-account credentials for cross-account tests. HashiCorp’s 2020 description of its AWS acceptance setup mentioned a pair of dedicated AWS accounts because some provider capabilities require two accounts. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/))

More recent Google-provider guidance shows the direction credentials have moved. Its **5 June 2025** development guide recommends Application Default Credentials for developers and supports service-account impersonation via `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`, with the developer granted `roles/iam.serviceAccountTokenCreator`, instead of treating a long-lived downloaded service-account key as the default workflow. ([GitHub](https://github.com/hashicorp/terraform-provider-google/wiki/Developer-Best-Practices?utm_source=chatgpt.com))

The operational pattern is therefore: dedicated low-blast-radius test identity and project/account; only the permissions needed by that suite; secrets supplied by CI or the developer’s credential mechanism; and, where supported, impersonated/short-lived credentials rather than persistent keys. Local emulator/fake tests should need no cloud credentials at all.

### What the expensive tests buy that mocks cannot

The valuable assertion is not merely “my program issued a Create call.” Terraform AWS acceptance tests apply actual configuration and then query the **provider API directly** to establish that the remote object really exists. After destruction they query AWS again to prove it is gone. They also exercise create/read/update/delete/import, external disappearance and recreation, and computed values returned by the service. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/))

Real services also expose timing semantics that are intrinsically difficult to fake accurately. Google’s provider guide documents cases where an API reports successful creation but subsequent operations temporarily return 404/403 or “operation in progress” because the service is eventually consistent. A fake can test that your retry code reacts correctly to a scripted sequence; only the real service tells you whether the sequence, duration and newly introduced service behavior are actually what production does. ([GitHub](https://github.com/hashicorp/terraform-provider-google/wiki/Developer-Best-Practices))

That is also why nightly live suites can find bugs with **no corresponding code change**: the upstream API, default behavior, regional implementation or asynchronous timing changed. ([HashiCorp Discuss](https://discuss.hashicorp.com/t/dynamic-test-environments/13200))

### Provider emulators and local API implementations: useful, but deliberately incomplete

Provider-supplied emulators are one of the strongest alternatives to live infrastructure because they generally speak the real SDK/API protocol. They are still not replicas of the production control plane.

Google’s Firestore emulator documentation, updated **8 September 2026**, says it attempts to reproduce production faithfully but explicitly does not mimic production transaction concurrency, all timeout/size limits, or composite-index enforcement. Google tells users to test against real Firestore where those behaviors matter. ([Google Cloud Documentation](https://docs.cloud.google.com/firestore/native/docs/emulator?hl=en))

The Pub/Sub emulator docs, updated **17 July 2026**, list missing IAM operations, unsupported update RPCs, no real subscription expiry/retention behavior, and incomplete BigQuery-subscription behavior. That means it is excellent for publisher/subscriber protocol tests but cannot establish that your production IAM and several lifecycle features work. ([Google Cloud Documentation](https://docs.cloud.google.com/pubsub/docs/emulator?hl=en))

Microsoft’s Azurite documentation, updated **26 August 2025**, similarly says there are functional differences from Azure Storage: it covers Blob, Queue and Table but not Azure Files or Data Lake Storage Gen2; it offers no production performance/scaling guarantee; and even where error status codes align, messages can differ. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite))

AWS’s DynamoDB Local documentation, checked **15 September 2026**, is especially explicit. It ignores provisioned throughput, lacks account/region separation, performs most control-plane changes immediately, makes eventually consistent reads often appear strong because everything is local, does not raise real `TransactionConflictException`s, lacks tagging and vector indexes, and tells users to test vector-index behavior against the actual service. ([AWS Documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html))

So emulator fidelity is **feature-specific, not binary**. A good test strategy reads the emulator’s documented differences and reserves live cases specifically for those gaps.

There is useful industry evidence that this trade pays. AppsFlyer’s engineering write-up of **30 June 2022** describes moving Terraform VPC tests to LocalStack: their feedback cycle went from minutes to seconds, cloud charges disappeared, developers no longer contended for shared cloud resources, and many Terraform apply failures became locally reproducible. But they retained real AWS tests for things LocalStack did not adequately support—EKS was their cited example. ([Medium](https://medium.com/appsflyerengineering/how-we-sped-up-our-aws-infrastructure-testing-using-localstack-58ce1b1d2856))

### Do teams think the live-cloud expense is worth it?

The evidence says **yes when real-provider behavior is the product; much less clearly for broad application/system testing**.

HashiCorp’s Martin Atkins described both sides in **August 2020**. At a previous company his team spent months creating disposable dynamic environments, then abandoned the approach: duplicating infrastructure was expensive and slow, failures were hard to diagnose, destroys sometimes failed and left money-burning resources, and the extra monitoring/cleanup machinery increased human cost. A long-lived shared copy of the environment ended up cheaper overall. In contrast, he said HashiCorp’s provider acceptance-test infrastructure—with years of cleanup automation—was worth the investment because provider correctness against remote APIs was the core product, while questioning whether the same investment made sense for most other situations. ([HashiCorp Discuss](https://discuss.hashicorp.com/t/dynamic-test-environments/13200))

There are also concrete examples of suites being reduced rather than merely tolerated. GitLab’s **November 2025** GRIT change reduced per-pipeline cloud-resource generation after quota pressure and orphan cleanup became operationally painful, and it **removed its GKE Windows E2E test** because it was consistently flaky, extremely slow, and required so many retries that engineers stopped investigating failures—making the test ineffective. ([GitLab](https://gitlab.com/gitlab-org/ci-cd/runner-tools/grit/-/merge_requests/302)) MongoDB Atlas’s **27 March 2024** changelog records deletion of “outdated integration tests” and corresponding dependency cleanup; the stated reason there is simply that those integration tests were outdated, not cost. ([GitHub](https://github.com/mongodb/terraform-provider-mongodbatlas/blob/master/CHANGELOG.md?utm_source=chatgpt.com))

The resulting rule of thumb is fairly strong: **keep a small live suite whose assertions are inherently about the real provider, and make everything else cheaper**. If a test is proving serialization, Terraform plan behavior, error propagation, CRUD orchestration, or application logic, it belongs in unit/fake/emulator/VCR tests. If it is proving “AWS/GCP/Azure really accepted this, reached the expected asynchronous state, returned these actual defaults, and really deleted it,” that is where paying for the real infrastructure is justified.
