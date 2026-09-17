# Survey Live Reconciliation Tests

Source: https://chatgpt.com/share/6aab2c0c-8628-83eb-95ab-6461881f1bb2

---

## Turn 1: User

_2026-09-16T22:57:14.734Z_

Survey how teams building infrastructure controllers — Kubernetes cloud providers, Crossplane providers, Cluster API

providers, Terraform providers — test reconciliation behaviour against the real cloud as of September 2026: how they

provoke partial failures on purpose, how they verify a controller converges after a resource is changed out of band, how

they bound cost and runtime, how sweepers identify leaked resources safely, and how they keep such tests from becoming

flaky. Include what these projects decided not to test live and why.

---

## Turn 2: ChatGPT

_2026-09-16T22:57:14.245Z_

I’ll compare representative AWS/Azure/GCP projects in each ecosystem, emphasizing concrete test mechanisms rather than generic CI practices. I’ll also separate “tested against real cloud” from simulated/unit coverage, because that distinction drives most of the cost, leak, and flake tradeoffs.

---

## Turn 3: ChatGPT

_2026-09-16T22:57:52.449Z_

A pattern is emerging: the strongest live-cloud tests are usually lifecycle/remediation tests, not arbitrary chaos injection. Teams tend to inject precise failures with mocks or Kubernetes-side state changes, while reserving real-cloud runs for “does the whole reconciliation loop recover?” because vendor APIs make deterministic fault injection expensive and flaky.

---

## Turn 4: ChatGPT

_2026-09-16T22:59:43.695Z_

The cleanup designs differ sharply by ecosystem. Terraform providers often implement **resource-type sweepers**; Cluster API leans on **leased, disposable environments** (Boskos plus provider teardown); Crossplane Uptest mostly relies on the managed resource’s normal deletion path. That difference matters: the safest sweeper is often one whose blast radius is structurally limited before it starts.

---

## Turn 5: ChatGPT

_2026-09-16T23:00:24.783Z_

As of **16 September 2026**, the common pattern across mature infrastructure-controller projects is a layered one: use the real cloud to prove lifecycle semantics and eventual convergence, but use mocks/emulators for precise fault injection. Teams have learned that deliberately making “the fifth EC2 call time out after the load balancer exists but before the security group update” happen against a real cloud is usually too nondeterministic, slow, and expensive to make a good merge gate.

| Ecosystem | What is normally exercised live | Deliberate partial failure / drift | Cost & runtime control | Leak strategy |
|---|---|---|---|---|
| Kubernetes cloud providers | Real clusters, Services/LBs, Nodes, routes | Mostly Kubernetes-side churn and lifecycle changes; exact cloud-API errors are generally lower-layer tests | Focused Ginkgo runs, temporary kOps clusters, provider/region-specific suites | Tear down the whole cluster; relatively little resource-by-resource sweeping |
| Cluster API providers | Whole workload-cluster lifecycle, upgrades, remediation, deletion | Live tests exercise machine failure/remediation and interrupted lifecycle; SDK-call failures use mocks | Explicit per-operation deadlines, focused labels, in-memory backend for provider-independent cases | Isolated leased cloud accounts/projects + teardown + Boskos/janitors |
| Crossplane / Upjet | Apply → stable → update → import → delete against physical cloud resources | Strong steady-state/import checking; no generic “fail cloud call N” or generic field-drift mutation step | Live tests opt-in and targeted by resource/API group | Normal MR deletion/finalizers; no Terraform-style universal sweeper documented |
| Terraform providers | CRUD, refresh, import, update, destroy against real APIs | Very explicit “disappears” tests delete cloud resources behind Terraform's back; unhappy paths are first-class | Targeted packages, `-short`, prechecks, serialization for quotas, VCR in some providers | Mature per-resource sweepers, usually restricted to dedicated test accounts/projects |

### Kubernetes cloud providers: real integration, relatively little chaos engineering

The AWS and GCP cloud-controller-manager projects still use genuine cloud clusters for their high-value E2E checks. `cloud-provider-aws` provisions or reuses an AWS Kubernetes cluster and lets developers narrow the suite with Ginkgo filters—for example, just the NLB tests. `cloud-provider-gcp` similarly runs its E2E suite on a provisional kOps cluster. The intent is to verify the integration boundary Kubernetes actually exposes: Service load balancer creation/update/deletion, node initialization, ProviderIDs, routes, and similar behavior. ([GitHub](https://github.com/kubernetes/cloud-provider-aws/blob/master/docs/development.md?utm_source=chatgpt.com))

What is conspicuously *not* part of these harnesses is a generic cloud fault injector. There is no common mechanism along the lines of “make Azure ARM return 429 on this exact reconciliation call.” The live tests instead mutate Kubernetes objects, endpoints or nodes and observe the cloud-visible result. Precise API-failure branches are much more naturally deterministic in mocked tests. Azure's current 2026 Container-Native SLB tracker is illustrative: it explicitly asks for retry/recovery coverage after API failures alongside unit and E2E tests, but as feature-specific work rather than as an existing generic live-chaos facility. ([GitHub](https://github.com/kubernetes-sigs/cloud-provider-azure/issues/10428?utm_source=chatgpt.com))

The same is true of out-of-band drift. These CCM suites are principally testing **Kubernetes-as-source-of-truth reconciliation**—change a Service, endpoints or nodes and see Azure/AWS/GCP catch up—not systematically editing a load balancer through the cloud console and asking the CCM to repair every field. Upstream Kubernetes networking E2Es do exercise transitions such as rolling workloads behind a load balancer and changes to traffic-policy behavior, but those are Kubernetes-originated disturbances. ([GitHub](https://github.com/kubernetes/enhancements/blob/master/keps/sig-network/1669-proxy-terminating-endpoints/README.md?utm_source=chatgpt.com))

Cost is bounded by narrowing the test surface and by making the cloud cluster disposable. AWS explicitly documents focused Ginkgo execution. A failed run may, however, still require manual `kops delete cluster`, and the kOps S3 state bucket is the place to find clusters that failed to clean themselves up. That is much less sophisticated than Terraform's sweeping infrastructure. ([GitHub](https://github.com/kubernetes/cloud-provider-aws/blob/master/docs/development.md?utm_source=chatgpt.com))

Flake work therefore concentrates on eventual consistency and cloud timing. The AWS CCM's 2026 release history includes fixes such as increasing E2E timeouts/load-balancer propagation allowances for a slower region and avoiding unscheduled nodes in LB tests—typical examples of making the observation window match real cloud behavior rather than expecting immediate consistency. ([GitHub](https://github.com/kubernetes/cloud-provider-aws/releases?utm_source=chatgpt.com))

### Cluster API: intentionally break machines, but mock individual API failures

Cluster API takes live system failure testing further because remediation is part of its product contract. The reusable E2E framework creates an isolated namespace, provisions infrastructure, performs operations such as upgrades or moves, waits for convergence, and then deletes the Cluster API objects and waits for the corresponding infrastructure to disappear. Tests are deliberately written around real user workflows and, unless a feature is provider-specific, are supposed to remain portable between clouds. ([Cluster API](https://main.cluster-api.sigs.k8s.io/developer/core/e2e))

Consequently, the useful live “partial failures” are usually **architectural failures**: an unhealthy Machine, control-plane remediation, a deletion halfway through a rollout, node draining, an upgrade, or loss/replacement of infrastructure. CAPZ's current E2E configuration, for example, has distinct deadlines for machine remediation, machine upgrades, node drain, cluster deletion and stabilization. It gives machine remediation up to 30 minutes, ordinary cluster creation 20 minutes, some HA control-plane paths 60 minutes, and explicitly waits first for resource versions to *become* stable and then to *remain* stable. That last pair is a good example of testing convergence rather than merely checking that `Ready=True` happened once. ([GitHub](https://github.com/kubernetes-sigs/cluster-api-provider-azure/blob/main/test/e2e/config/azure-dev.yaml?utm_source=chatgpt.com))

By contrast, very precise provider errors are pushed down into controller tests. CAPA's `AWSMachine` controller tests inject mocked EC2/ELB failures, including failures while attaching a control-plane machine to a load balancer and failures during deletion. This gives maintainers repeatable coverage of awkward intermediate states without depending on AWS to fail at just the desired instant. ([GitHub](https://github.com/kubernetes-sigs/cluster-api-provider-aws/blob/main/controllers/awsmachine_controller_test.go?utm_source=chatgpt.com))

Cluster API does **not** have a portable generic E2E primitive for “go into the cloud provider and alter arbitrary VM/security-group fields.” The framework intentionally operates primarily through Cluster API resources so the same behavioral spec can run against different infrastructure providers. Provider-specific drift tests can exist, but cloud-console mutation is not the central cross-provider contract. Recent core CAPI work instead includes robustness for cases such as accidentally missing infrastructure templates and remediation of unhealthy Machines. ([Cluster API](https://main.cluster-api.sigs.k8s.io/developer/core/e2e))

The most interesting 2026 cost decision is what CAPI deliberately stopped requiring a heavyweight environment for. In the v1.14 development cycle, several ClusterClass rollout, upgrade, clusterctl-upgrade and in-place-update E2Es were migrated to CAPI's **in-memory backend**, explicitly alongside work to reduce E2E duration. Provider-independent controller semantics no longer need to consume real-cloud minutes merely because they can be expressed as an E2E scenario. ([GitHub](https://github.com/kubernetes-sigs/cluster-api/releases?utm_source=chatgpt.com))

Leak cleanup is correspondingly environment-oriented. The CAPI framework says teardown must collect diagnostics and clean every infrastructure resource, and specifically notes that tests can fail before deletion starts; Kubernetes CI therefore uses **Boskos** to manage clean test resources. Boskos leases accounts/projects, heartbeats leases, marks abandoned leases dirty, and has Reaper/Janitor components recover resources whose test process vanished. Dynamic leased resources can also expire. ([Cluster API](https://main.cluster-api.sigs.k8s.io/developer/core/e2e))

The providers add another safety layer. CAPA's E2E script leases an AWS account from Boskos, heartbeats it, releases it, and can run `aws-janitor -all`; it even checks against a list of AWS keys that must never be used for E2E. In other words, janitor safety is largely achieved by **account isolation**, not by trying to prove that every individual deletion candidate is harmless. ([GitHub](https://github.com/kubernetes-sigs/cluster-api-provider-aws/blob/main/scripts/ci-e2e.sh)) CAPG is more selective: its emergency cleanup lists cloud objects and deletes those matching the `capg-e2e` naming convention, while running inside a Boskos-leased GCP project; its network is tied to a randomized test name. ([GitHub](https://github.com/kubernetes-sigs/cluster-api-provider-gcp/blob/main/scripts/ci-e2e.sh))

### Crossplane / Upjet: test for a stable reconciler, not merely a successful creation

Crossplane's Upjet/Uptest machinery has an unusually explicit notion of convergence. Its live tests create **physical cloud resources**, which the project says are sufficiently costly that these tests are not run by default. A contributor triggers selected examples—or an API group—from a PR comment. ([GitHub](https://github.com/crossplane/upjet/blob/main/docs/testing-with-uptest.md))

The lifecycle has grown beyond Create/Delete to include **Update and Import**. More importantly, Uptest adds a test-only `UpToDate` condition. The rationale is that `Ready=True` is not enough: a resource can be Ready while late initialization is still occurring, or while the controller is stuck continuously updating the cloud resource. Uptest waits for the stronger condition so the assertion is effectively “the reconciler has settled.” Names/identifiers are randomized where necessary to prevent accidentally colliding with or updating an existing cloud resource. ([GitHub](https://github.com/crossplane/uptest/blob/main/design/design-doc-uptest-improvements-and-increasing-test-coverage.md))

The Import phase is a particularly useful recovery check. It exercises whether the provider can rediscover an already-existing cloud resource and whether its external-name configuration is correct. It has caught enough real provider bugs that the Uptest design calls it out as an important source of early detection. ([GitHub](https://github.com/crossplane/uptest/blob/main/design/design-doc-uptest-improvements-and-increasing-test-coverage.md))

But Import is not the same as systematic out-of-band **field mutation**, and this is an important limitation. The accepted Uptest design explicitly says its generic assertions concentrate on status conditions and do not, today, compare all `spec.forProvider` values with `status.atProvider`. I found no generic Uptest phase that changes arbitrary cloud-side fields through AWS/GCP/Azure and then proves every field is repaired. In other words, Uptest gives strong evidence for lifecycle stability and re-observation, but its generic suite is not an exhaustive cloud-drift verifier. ([GitHub](https://github.com/crossplane/uptest/blob/main/design/design-doc-uptest-improvements-and-increasing-test-coverage.md))

Similarly, Uptest does not try to offer a deterministic “fail this particular AWS request” primitive. It provisions real resources; when developers want controlled provider failures, its own design discusses running against mock infrastructure such as LocalStack. Upjet also uses ordinary mock-based tests below the Uptest layer. This is the same separation seen in CAPI: precise failure state-machine coverage below, real eventual behavior above. ([GitHub](https://github.com/crossplane/uptest/blob/main/design/design-doc-uptest-improvements-and-increasing-test-coverage.md))

Crossplane has several revealing “do not test this generically live” decisions. Resources that need a real public domain, valid public key, or values that cannot be generated generically are annotated `manual-intervention` and omitted from automated Uptest; maintainers require manual testing instead. The generic suite also did not test connection details, and by default only exercised `Secret`-based ProviderConfig credentials rather than modes such as IRSA and WebIdentity because those environments are difficult to prepare consistently. ([GitHub](https://github.com/crossplane/upjet/blob/main/docs/testing-with-uptest.md))

That is a deliberate anti-flake choice as much as a coverage gap: don't turn requirements for public DNS, bespoke identity federation or account-specific configuration into an unreliable universal E2E gate.

### Terraform providers: the strongest standardized out-of-band test pattern

Terraform's provider testing framework is the most formalized about live-cloud reconciliation. An acceptance test actually runs Terraform plan/apply/refresh/destroy against real infrastructure, and the framework explicitly supports unhappy paths where tests assert errors, a non-empty plan, and the cloud resources left behind. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests?utm_source=chatgpt.com))

The AWS provider's canonical **`disappears` test** is almost exactly the experiment in your question. The test creates the resource normally, uses the AWS SDK to delete it *outside Terraform*, refreshes state, and then asserts that Terraform does not fail because the resource vanished: it should remove the stale object from state and produce a plan to create it again. Parent-disappearance variants do the same for dependencies. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com))

That is a very clean convergence oracle:

`apply → delete through cloud API → refresh → stale state disappears → next plan wants create`

Field-level drift is less standardized than deletion, but ordinary multi-step acceptance tests exercise update/refresh repeatedly, while import tests independently reconstruct state through the cloud API. Google goes further in its contributor rules: nearly every resource is expected to support an import test, and `ImportStateVerify` compares the normal post-create state with separately imported state exactly, subject to documented exceptions for secrets or virtual fields. ([GitHub](https://github.com/hashicorp/terraform-provider-google/wiki/Developer-Best-Practices?utm_source=chatgpt.com))

Terraform projects also have the most explicit cost engineering. AWS documents which services can be cost-prohibitive, lets contributors hand expensive acceptance execution to maintainers, permits regex-selecting a tiny test subset, marks tests exceeding roughly five minutes so intermediate runs can use `-short`, uses a default parallelism of about 20, and serializes resources whose service quotas make parallel runs unsafe. PreChecks skip regions/accounts where a test cannot succeed rather than spending time reaching an inevitable failure. Randomized names avoid inter-test collisions. ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com)) Google recommends packing many field variations into one acceptance test specifically to reduce aggregate runtime, and its release process scopes live runs according to whether a change affects one resource, a service, or the whole provider; it warns maintainers not to collide with long/quota-sensitive suites such as GKE. ([GitHub](https://github.com/hashicorp/terraform-provider-google/wiki/Developer-Best-Practices?utm_source=chatgpt.com))

Terraform's sweeper design is also the sharpest contrast with Kubernetes controllers. Google sweepers list every resource of a given kind in a test project, determine whether each is “sweepable,” then delete it. Service sweepers execute after nightlies; the special project sweeper runs only after all other builds, so it cannot delete a project still being used by a test. ([GitHub](https://github.com/hashicorp/terraform-provider-google/wiki/Developer-Best-Practices?utm_source=chatgpt.com))

AWS chooses an even stronger isolation boundary: its sweeper documentation warns that sweepers can destroy infrastructure **and backups**, deliberately override deletion protection, and must never be run outside a development account that should be empty. Thus its primary safety proof is not clever resource-name matching; it is “this entire account/region is disposable.” ([HashiCorp](https://hashicorp.github.io/terraform-provider-aws/running-and-writing-acceptance-tests/?utm_source=chatgpt.com))

For flakiness, the Google provider adds an interesting middle tier between mocks and constantly-live acceptance tests: its test operations include a **VCR recording/replay** lane. The release shepherd is expected to investigate both recording failures and recurrent replay failures, and to label persistent test failures by observed failure frequency. Current provider code even disables certain caches during VCR runs specifically to prevent nondeterministic request sequences from breaking recordings. ([GitHub](https://github.com/hashicorp/terraform-provider-google/wiki/Release-Shepherd-Rotation?utm_source=chatgpt.com)) This preserves a large amount of real-API behavior while making repeated executions cheaper and deterministic.

### What these projects have collectively learned not to put in the live-cloud layer

The boundary is remarkably consistent. Teams avoid exhaustive live injection of exact vendor API errors because those failures cannot reliably be scheduled and often leave expensive intermediate state. They avoid running every controller-state-machine permutation in a real cloud when an in-memory backend, fake client or emulator can establish the same fact faster. CAPI's migration of provider-independent E2Es to its in-memory backend is the clearest current example. ([GitHub](https://github.com/kubernetes-sigs/cluster-api/releases?utm_source=chatgpt.com))

They also avoid making account-specific prerequisites universal E2E gates. Crossplane leaves public-domain/certificate cases and some identity modes to manual or specialized testing; Terraform uses PreChecks and selectively serializes quota-limited tests; Kubernetes provider suites let maintainers select only relevant cloud-specific cases. ([GitHub](https://github.com/crossplane/upjet/blob/main/docs/testing-with-uptest.md))

And they do not generally demand that every possible external mutation be tested live. Terraform has made **resource disappearance** a standardized contract, but Crossplane and CAPI have no comparably universal “mutate every cloud property behind the controller's back” framework. Their stronger generic invariants are instead “re-observe/import and settle without an update loop” for Crossplane, and “restore cluster health / finish the lifecycle operation within a bounded interval” for CAPI.

The resulting design rule for a new controller test suite is therefore fairly clear: make a small number of live tests prove **eventual convergence across genuine cloud asynchronous behavior**, including at least one externally deleted or unhealthy-resource case; put deterministic Nth-call errors, malformed responses, 429s and cache races into mock/emulator tests; allocate live tests an isolated account/project with an expiration mechanism; and treat cleanup and a “remain stable for N minutes” assertion as part of the test rather than as afterthoughts. That combination is what lets these projects test reconciliation rather than merely test provisioning.

---

If you want, I can:

- Compare live test strategies across Kubernetes, Crossplane, CAPI, and Terraform
- Explain how cost and flake control differ in live-cloud tests by ecosystem
- Outline the reasoning behind what live cloud tests are avoided by these projects
