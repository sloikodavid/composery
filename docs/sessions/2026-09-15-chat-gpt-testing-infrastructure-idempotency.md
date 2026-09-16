# Testing Infrastructure Idempotency


Source: https://chatgpt.com/share/6aa92d60-3c40-83eb-8abd-ffbc5fc40706

---

## Turn 1: User

_2026-09-15T11:26:26.192Z_

Context: A control plane performs operations on infrastructure that belongs to customers: creating servers, changing files on them, and recording what happened. Some outcomes are genuinely unknown, for example when a response is lost after a request was sent. Repeating an operation may be safe or may not.

Question: How do infrastructure tools test operations whose outcome may be unknown, partial, or not repeatable?

Cover: how idempotency is tested; how unknown outcomes are represented and asserted; how partial failure and rollback are exercised; how tools verify that they do not act twice; what is asserted about resources left behind; and how reconciliation loops are tested for convergence.

Use named examples from infrastructure as code tools, provisioning systems, orchestrators, and cloud control planes, including how their own repositories test these paths.

Evidence rules: cite repositories, design documents and incident reports with dates. Distinguish a tool's documented guarantee from what its tests actually cover. Include known cases where such a tool acted twice or left a resource behind, and whether a test could have caught it.

---

## Turn 2: ChatGPT

_2026-09-15T11:26:26.410Z_

I’ll compare the mechanisms at three layers: declarative IaC/provider APIs, controller/reconciler loops, and cloud/provisioning backends. I’ll separate “the project says this is guaranteed” from “the repository actually has a test that exercises it,” then use incidents/bugs to show where those test strategies have failed in practice.

---

## Turn 3: ChatGPT

_2026-09-15T11:27:02.163Z_

One especially useful pattern is emerging in Crossplane: it treats “request may have succeeded, but I failed to record the external ID” as a first-class hazardous state rather than silently retrying. That is stronger than ordinary idempotence testing because the correct assertion can be **“do not create again; stop and require observation/manual disambiguation.”**

---

## Turn 4: ChatGPT

_2026-09-15T11:30:57.469Z_

The repository evidence also shows an important distinction between **repeatability** and **duplicate suppression**. Terraform/Molecule-style “run it again and expect no diff” tests the former; Kubernetes expectations and Crossplane’s create-pending barrier test the latter by asserting that a controller with stale or ambiguous observations does **not** issue another mutation.

---

## Turn 5: ChatGPT

_2026-09-15T11:31:50.749Z_

Infrastructure systems usually do **not** test “idempotency” as one property. They split it into several different properties:

1. **Fixed-point idempotency:** once desired state is reached, running again makes no change.
2. **Replay safety:** if the caller cannot tell whether an operation completed, retrying the same logical operation cannot perform it twice.
3. **Ambiguity containment:** if replay cannot be made safe, record “outcome unknown” and refuse to repeat it.
4. **Compensation:** after a partially completed workflow, clean up the pieces that must not survive.
5. **Convergence:** repeated reconciliation, once failures cease and observations catch up, eventually reaches the desired state and then stops mutating it.

Those require different tests. A “run it twice” test exercises only the first.

## How the major systems approach it

| System | Documented contract | What its own tests actually exercise |
|---|---|---|
| **Terraform / providers** | An apply may partially succeed. Terraform records completed changes but does **not** automatically roll back the apply; the user fixes the error and applies again. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/tutorials/cli/apply?utm_source=chatgpt.com)) Terraform's provider lifecycle distinguishes plan-time `unknown` values from real state: the New State after `ApplyResourceChange` must be wholly known. ([GitHub](https://github.com/hashicorp/terraform/blob/main/docs/resource-instance-change-lifecycle.md?utm_source=chatgpt.com)) | Provider acceptance tests execute plan → apply → refresh → final plan; a non-empty final plan normally fails. `CheckDestroy` can query the real API after destruction and fail if anything remains. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/testing-patterns?utm_source=chatgpt.com)) The repository's `ExpectEmptyPlan` literally asserts that there are no output or resource changes.  That repository snapshot is from August 31, 2026.  |
| **Ansible / Molecule** | Idempotence generally means a second converge reports zero changes. Molecule's idempotence phase reruns the converge playbook and fails when the second run reports changes; its `side_effect` facility can deliberately introduce things such as a network partition. ([GitHub](https://github.com/ansible/molecule/blob/main/docs/workflow.md?utm_source=chatgpt.com)) | Ansible's own integration tests often repeat a module and assert `is not changed`. The current `deb822_repository` test creates a repository, repeats the same declaration in two forms, asserts both idempotent runs are unchanged, then removes the repositories and asserts their files no longer exist. ([GitHub](https://github.com/ansible/ansible/blob/devel/test/integration/targets/deb822_repository/tasks/test.yml?utm_source=chatgpt.com)) |
| **Crossplane** | A genuinely ambiguous create is first-class state. Providers write `external-create-pending` before creation, followed by `...-succeeded` or `...-failed`. If pending is newer than both, Crossplane says the provider may have leaked a resource and stops with `cannot determine creation result` rather than risking another create. ([Crossplane Docs](https://docs.crossplane.io/v1.20/concepts/managed-resources/?utm_source=chatgpt.com)) | `crossplane-runtime` has explicit reconciler cases named `ExternalCreatePending`; their stated reason is that it “might have leaked a resource and don't want to create another.”  The expected status is Creating plus a reconciliation error, rather than a second Create. It also has a case permitting progress when the external name is deterministic, because that makes the resource re-identifiable.   The cited runtime snapshot is September 8, 2026.  |
| **Kubernetes controllers** | Reconciliation is supposed to be idempotent, but Kubernetes also has mechanisms specifically to stop a stale controller from acting twice. Controllers set creation/deletion “expectations” and wait for informer observations before acting again. Kubernetes 1.36, released in 2026, added `ConsistencyStore`: after a write, a controller can refuse to reconcile while its informer cache is older than the resource version it wrote. ([Kubernetes](https://kubernetes.io/blog/2026/04/28/kubernetes-v1-36-staleness-mitigation-for-controllers/?utm_source=chatgpt.com)) | `TestControllerExpectations` sets outstanding creates/deletes, delivers observations concurrently, verifies reconciliation remains blocked while expectations remain, and tests expiry with a fake clock.   ReplicaSet uses `ExpectCreations` before issuing pod creates.  Current tests also explicitly verify that a write makes `EnsureReady` report the cache as stale until it catches up.  |
| **OpenStack Nova** | Nova's architecture has long recognized the classic ambiguity: POST sent, reply lost, resource may already exist. OpenStack design work proposed client tokens for this case. Nova itself also relies heavily on compensation and resource-accounting cleanup around multi-service server builds. | The current Nova repository contains a functional regression test `test_delete_stuck_build_instance_after_claim` specifically for bug 1859496: interrupt a server build after its Placement resource claim, delete the stuck server, and verify allocations are cleaned up.  The test ultimately calls a helper that checks allocations after deletion.  The cited repository snapshot is September 14, 2026.  |
| **AWS EC2 / CloudFormation** | EC2 gives the strongest API-level contract here: with an idempotency token, the operation completes no more than once; a successful retry with the same token and parameters performs no further action. AWS explicitly motivates this with timeouts that leave the caller unable to tell whether a mutating request completed. ([AWS Documentation](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html?utm_source=chatgpt.com)) CloudFormation separately specifies failure policy: `ROLLBACK`, `DELETE`, or `DO_NOTHING`; `RetainExceptOnCreate=true` makes newly created resources get deleted during rollback even when they otherwise have a Retain policy. ([AWS Documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html?utm_source=chatgpt.com)) | AWS does not publish the EC2 or CloudFormation service implementation repositories or their internal fault-injection suites, so the **documented guarantee is inspectable but the server-side test coverage is not**. That is an important distinction from Kubernetes, Crossplane, Terraform, and Nova. |

Terraform's lifecycle design document is useful precisely because it shows a terminology trap. The document, substantially revised on **June 9, 2022**, describes unknown values in a *plan*—values that will become known during apply.  That is **not** an “unknown operation outcome.” Once `ApplyResourceChange` is done, Terraform expects concrete New State. ([GitHub](https://github.com/hashicorp/terraform/blob/main/docs/resource-instance-change-lifecycle.md?utm_source=chatgpt.com)) Thus a provider that successfully creates a VM but loses the reply before learning/persisting the VM's ID has a harder problem than Terraform's normal `unknown` value machinery can express.

## Idempotency tests: fixed point versus safe retry

Terraform's normal provider test is a good example of a **fixed-point** test. Provision the resource, refresh it from the real API, then plan again. If the provider is correctly modeling the remote object, the last plan is empty. `plancheck.ExpectEmptyPlan()` makes the same assertion explicitly. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/testing-patterns?utm_source=chatgpt.com)) This catches perpetual diffs, normalization mistakes, and many create/update implementations that don't settle.

Ansible's equivalent is even more literal: execute the same desired-state operation twice and assert that the second invocation reports `changed=false`. The Ansible repository's `deb822_repository` test additionally varies argument ordering, which is a useful way of checking semantic rather than textual equality. ([GitHub](https://github.com/ansible/ansible/blob/devel/test/integration/targets/deb822_repository/tasks/test.yml?utm_source=chatgpt.com)) A real 2019 bug demonstrates the value of this rudimentary test: Ansible issue #57541, opened **June 7, 2019**, reported that Molecule's idempotence phase caught `yum_repository` reporting a change on the second run. ([GitHub](https://github.com/ansible/ansible/issues/57541?utm_source=chatgpt.com))

But neither test proves **at-most-once external side effects**. A defective module could, for example, rewrite a file or issue an API PUT on every run and still report `changed=false`. For customer infrastructure, the stronger test instruments the external boundary: run the operation twice and assert both the resulting state **and the number/identity of mutating API calls**. For a non-idempotent POST protected by a request token, the test should deliberately discard the first response, resend the request with the same token, and assert that only one remote object exists.

EC2 documents exactly the semantic result such a test ought to verify: the original and retried request with the same token complete the logical operation only once. ([AWS Documentation](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html?utm_source=chatgpt.com))

## Testing a truly unknown result

Crossplane is unusually explicit about this state. Its protocol is effectively a small write-ahead log:

`pending → external create → succeeded/failed`

The dangerous crash window is between the external create and writing `succeeded`. On restart, `pending > succeeded,failed` means **“maybe created.”** The assertion is therefore *not* “retry succeeds.” It is “Create is not called again, the managed object visibly enters an indeterminate/error condition, and reconciliation stops until the ambiguity is resolved.” ([Crossplane Docs](https://docs.crossplane.io/v1.20/concepts/managed-resources/?utm_source=chatgpt.com)) The repository's `ExternalCreatePending` test exercises exactly that branch. 

This pattern is appropriate when the underlying creation operation is not safely replayable. If the external resource has a deterministic name or another stable lookup key, the controller can instead observe by that identity and turn “unknown” back into “known.” Crossplane has an explicit test for proceeding after a pending create when the name is deterministic. 

AWS takes the opposite approach: it makes the ambiguous request **replayable** at the API boundary using a stable `ClientToken`. ([AWS Documentation](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html?utm_source=chatgpt.com)) These are the two clean solutions to the classic “request committed; reply lost” problem: either make retry safe, or make uncertainty durable and prohibit retry.

Terraform is less expressive at this level. It does preserve successful portions of a failed apply and deliberately avoids automatic rollback, but if a provider has created a resource and cannot return enough identity/state to Terraform, the resource can fall outside state. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/tutorials/cli/apply?utm_source=chatgpt.com))

A concrete example occurred in the AzureRM provider. Issue #24517, opened **January 17, 2024**, described an Azure Function App whose base resource was successfully created, after which zip deployment failed because of a transient network/DNS error. Terraform treated creation as failed, the app was not in state, and the next apply found that the Azure resource already existed; users had to delete it manually. ([GitHub](https://github.com/hashicorp/terraform-provider-azurerm/issues/24517?utm_source=chatgpt.com)) A normal happy-path “apply, refresh, empty plan” test would not exercise this. A targeted acceptance test could: inject failure *after Azure creation but before Create returns success*, then assert that either the ID remains in Terraform state and is tainted/recoverable, or cleanup removes the external app.

## Partial failure and rollback

There are three distinct test philosophies here.

**Terraform** is explicitly incremental rather than transactional. The guarantee is that after an error it records completed resource changes and exits; it does not promise to restore the pre-apply world. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/tutorials/cli/apply?utm_source=chatgpt.com)) Thus a partial-failure test should assert the exact *intermediate* state, not expect a rollback that the product never promises. Then it should remove the injected fault, run again, and prove convergence to an empty plan.

Terraform's provisioner behavior shows how non-repeatable substeps alter the assertion. A creation-time provisioner failure taints the resource because it may be only partly configured. A failed destroy-time provisioner is run again on the next apply, so such a provisioner must itself be safe to replay. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/language/provisioners?optInFrom=terraform-io&utm_source=chatgpt.com))

**CloudFormation** exposes rollback as part of the contract. A test of `ROLLBACK` should therefore verify not only stack status but the inventory of resources remaining afterward. The `RetainExceptOnCreate` flag is particularly telling: it defines whether resources *newly introduced by the failed operation* are expected to survive. ([AWS Documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html?utm_source=chatgpt.com))

**Nova and Kubernetes-style controllers** usually use compensation/reconciliation rather than an all-or-nothing transaction. The Nova server-build path spans scheduler, Placement accounting, database state, messaging and compute. Its bug #1859496 showed why checking only the primary server record is insufficient: a server build interrupted after its resource claim could be deleted while leaving its Placement allocation behind. The fix says AMQP problems or a conductor restart could create that condition, and added the functional regression test that interrupts the build and checks the allocation disappears. ([OpenDev](https://opendev.org/openstack/nova/commit/f35930eef8fa27ee972e87366abb38596839fdba?utm_source=chatgpt.com)) That is a model test for partial failure: fail at a deliberate phase boundary and enumerate **all secondary resources and reservations**, not just the headline object.

## How controllers prove they do not act twice

Kubernetes's controller expectations are essentially a short-lived local record of “writes I have issued but have not yet observed through my read path.” ReplicaSet records expected creations before firing the creates.  `TestControllerExpectations` verifies that the controller is considered unsatisfied until those observations arrive, including concurrent notifications and the TTL escape hatch. 

The newer `ConsistencyStore` attacks a related race at a lower level. Kubernetes controllers commonly write directly to the API server but read through asynchronous informer caches. On **April 28, 2026**, the Kubernetes project documented the v1.36 mitigation: remember the resource version a controller has written, and skip reconciliation until the cache's resource version has caught up. ([Kubernetes](https://kubernetes.io/blog/2026/04/28/kubernetes-v1-36-staleness-mitigation-for-controllers/?utm_source=chatgpt.com)) That turns “read-your-own-write” into an assertion that can be tested.

Why that matters is visible in Kubernetes issue #140217, opened **July 3, 2026**. Under rapid scale-out of 6,000–10,000 DRA pods, a ResourceClaim could be created, its entry evicted from a fixed-size mutation cache before the informer Add arrived, and the controller would later see NotFound and create the claim a second time. ([GitHub](https://github.com/kubernetes/kubernetes/issues/140217?utm_source=chatgpt.com)) A small ordinary reconciliation test would probably miss it. A deterministic regression test can catch it by creating more entries than the cache capacity while deliberately delivering the Pod update before the ResourceClaim add event, and then asserting the create-call count stays at one.

This illustrates an important rule for reconciliation tests: **event ordering and stale observations have to be inputs to the test**, not merely implementation details.

## What should be asserted about leftovers?

“Cleanup succeeded” cannot mean only “the control-plane record disappeared.” Terraform's `CheckDestroy` is intended to query the infrastructure API itself and fail when a real object still exists. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/sdkv2/testing/acceptance-tests/testcase?utm_source=chatgpt.com)) Ansible's repository tests assert that the files corresponding to removed repositories are actually absent. ([GitHub](https://github.com/ansible/ansible/blob/devel/test/integration/targets/deb822_repository/tasks/test.yml?utm_source=chatgpt.com)) Nova's regression test checks Placement allocations, because the leaked object in that incident was resource accounting rather than the VM object itself. ([OpenDev](https://opendev.org/openstack/nova/commit/f35930eef8fa27ee972e87366abb38596839fdba?utm_source=chatgpt.com))

Crossplane is a useful exception: in an ambiguous create the correct test may explicitly permit **one possible leaked resource**. The safety property is that the controller exposes the possibility and creates *no more* until someone establishes what happened. Trying to assert “zero resources remain” would force the controller to take another potentially unsafe action.

Terraform has historical evidence of why independent external inventory matters. Issue #9592, opened **October 25, 2016**, reported `unexpected EOF` during apply causing an existing Elastic Beanstalk environment to disappear from state; subsequent runs attempted to create it again. ([GitHub](https://github.com/hashicorp/terraform/issues/9592?utm_source=chatgpt.com)) Terraform issue #1783, opened **May 3, 2015**, is an even cleaner acted-twice example: the second plan reported no changes, but applying resulted in another resource. ([GitHub](https://github.com/hashicorp/terraform/issues/1783?utm_source=chatgpt.com)) An empty-plan assertion alone is therefore not a complete duplicate-action test; reproducing #1783 requires performing the second execution—or instrumenting provider calls—and asserting that no mutating action occurs.

## Testing reconciliation for convergence

A good reconciler test is not “call `Reconcile` once and compare an object.” It is a small state-machine test.

The property to test is:

> Starting from any reachable partial state, once injected failures stop and observations eventually reflect successful writes, repeated reconciliations reach a fixed point matching desired state; after that point, further reconciliations issue no mutations.

That decomposes into **safety** (“before convergence, don't create/delete more than allowed”), **liveness** (“temporary failures or stale caches do not leave the controller stuck forever unless the product deliberately chooses an indeterminate/manual state”), and **quiescence** (“after convergence, another reconcile is a no-op”).

Kubernetes expectations tests cover part of that: they verify that reconciliation remains gated while observations are outstanding and becomes eligible again when observations arrive or expectations expire.  Crossplane exercises a deliberately *non-convergent without intervention* state for ambiguous creates, which is a safety tradeoff rather than a liveness bug. The distinction matters: Crossplane issue #340, opened **July 14, 2022**, showed a provider pod being killed during a long create, leaving `external-create-pending` stuck and requiring manual removal. ([GitHub](https://github.com/crossplane/crossplane-runtime/issues/340?utm_source=chatgpt.com)) That behavior is inconvenient, but it is consistent with preferring “stop” over “possibly create twice.”

There is also a failure on the other side of that tradeoff. Crossplane issue #4099, opened **May 24, 2023**, describes a GCP ServiceAccount that had been created successfully; later the provider failed to observe it, attempted creation again, received GCP's `409 already exists`, and eventually entered the create-pending safety state. ([GitHub](https://github.com/crossplane/crossplane/issues/4099?utm_source=chatgpt.com)) A provider-level reconciliation regression test could simulate “resource exists, Observe temporarily returns false” and assert that the controller recovers via stable identity/grace logic rather than issuing another create. The generic Crossplane runtime tests cannot prove that every provider's `Observe` implementation is correct.

## The fault matrix I would use for a customer-infrastructure control plane

The strongest test suite places a fault at every point where durable knowledge can diverge from the external side effect:

| Fault point | Required assertion |
|---|---|
| Fail **before request send** | No external object; retry may act once. |
| Send request, service rejects it definitively | Durable `failed` result; retry according to normal policy. |
| **Service commits, response is lost** | Either same idempotency key is safely replayed and exactly one object exists, or operation becomes durable `unknown/pending` and no retrying mutation occurs. |
| Response received, crash **before local state/ID is persisted** | On restart, recover by idempotency key/deterministic identity, or halt as ambiguous. Never blindly create again. |
| First of several subresources succeeds, later step fails | Assert the documented compensation policy and inventory every surviving primary object, attachment, allocation, credential, file, reservation and metadata record. |
| Rollback itself fails halfway | Record rollback as incomplete; retries must resume compensation without repeating already-completed destructive work. |
| Write succeeds but reads are stale | Feed stale observation deliberately and assert no second action; then advance the observer and prove progress. |
| Process dies and restarts | Reload only durable information; outcome should not depend on an in-memory “already did that” flag. |
| Reconcile is invoked repeatedly and concurrently | Count external mutations, verify per-resource serialization/deduplication, eventually expose the latest observed state, then reach zero mutations. |
| Cleanup/destroy finishes | Query the authoritative external systems, not just the controller database, and assert exactly the resources the retention policy permits remain. |

The central lesson from these projects is that **“second run is a no-op” is the floor, not the ceiling**. The hard test is the one Crossplane, Kubernetes and idempotent cloud APIs point toward: manufacture the exact window where the external world has changed but the control plane does not yet know that it has changed. Then assert either **safe replay with a stable operation identity**, or **durable uncertainty plus refusal to act twice**. Terraform's and Nova's historical leaks, and Kubernetes's 2026 duplicate ResourceClaim race, are all variants of failing to test that window strongly enough.
