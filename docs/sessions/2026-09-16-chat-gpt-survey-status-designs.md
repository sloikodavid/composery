# Survey Status Designs

Source: https://chatgpt.com/share/6aab2c24-5be8-83eb-a454-a1f3d817531e

---

## Turn 1: User

_2026-09-16T22:57:30.111Z_

A system provisions a unit made of a virtual machine, two network addresses and a management credential, polled from a

provider with no webhooks. Survey, with sources, concrete designs for representing the status of each part and a

summary: how parts are named, how "observed failure", "unknown" and "stale observation" are distinguished, how a summary

is derived and whether it is stored or computed, how a part's status is kept honest when the poll that updates it

stops, and how the model is extended when a new kind of part is added. Use Kubernetes API conventions, Crossplane,

Cluster API, AWS EC2 status checks and Juju as sources, and report where they disagree. Do not recommend one answer.

---

## Turn 2: ChatGPT

_2026-09-16T22:57:30.122Z_

I’ll treat this as a design survey rather than a recommendation: first pin down each source model, then map those conventions onto the VM + two addresses + credential unit, and finally call out the disagreements explicitly.

---

## Turn 3: ChatGPT

_2026-09-16T22:57:42.719Z_

A useful split is already emerging: Kubernetes/Crossplane/CAPI mostly model status as named conditions with tri-state truth, while AWS exposes poll-result enums, and Juju separates workload state from observer/agent state. The hard part is freshness: none of these sources treats “last bad/good fact” and “observer is no longer updating” in exactly the same way.

---

## Turn 4: ChatGPT

_2026-09-16T22:58:16.184Z_

The sources also disagree on what a “summary” is for. Kubernetes and CAPI use it as a cached, API-visible conclusion so clients don’t duplicate controller logic; Crossplane splits “usable” (`Ready`) from “reconciled successfully” (`Synced`); AWS makes unknown/missing data an explicit check result; Juju keeps workload health and observer/agent health as separate axes.

---

## Turn 5: ChatGPT

_2026-09-16T22:59:23.119Z_

The five sources converge on a few ideas—status is observational, summaries should not erase detail, and “I observed a failure” is different from “I could not observe”—but they diverge sharply on freshness and aggregation. For a polled provider, the most important gap is that Kubernetes-style `lastTransitionTime` and `observedGeneration` do **not** prove that polling is still happening.

## 1. What the source systems actually model

| Source | Primitive status model | Known bad vs unknown | Freshness / stopped observer | Summary | Extension model |
|---|---|---|---|---|---|
| Kubernetes API conventions | Named conditions, normally `metav1.Condition`: `type`, `status=True/False/Unknown`, `reason`, `message`, `observedGeneration`, `lastTransitionTime`. `observedGeneration` tells whether the condition reflects the current desired generation. ([Kubernetes](https://kubernetes.io/docs/reference/kubernetes-api/apiextensions/custom-resource-definition-v1/?utm_source=chatgpt.com)) | `False` is a definite negative observation; `Unknown` means the truth cannot currently be determined. | `lastTransitionTime` is **transition time**, not heartbeat time. Kubernetes solves actual observer liveness separately for Nodes: kubelets renew `Lease.spec.renewTime`, and the node controller turns `Ready` to `Unknown` after missing heartbeats. ([Kubernetes](https://kubernetes.io/docs/concepts/architecture/leases/?utm_source=chatgpt.com)) | Controllers often store a summary condition so consumers don't reproduce domain logic. | New condition types can be introduced; their semantics then become API contract. Conditions are keyed by `type`. |
| Crossplane | Managed resources conventionally have `Ready` and `Synced`. `Ready=True/Available` means usable; `Ready=False/Unavailable` means the provider actually reports it unhealthy. `Synced=False/ReconcileError` means reconciliation failed; `Synced=True/ReconcileSuccess` means the most recent reconcile succeeded. Providers may add conditions. ([Crossplane Documentation](https://docs.crossplane.io/v2.3/managed-resources/managed-resources/)) | This creates a useful separation between “external thing is unhealthy” and “controller failed while trying to observe/reconcile it.” | Conditions carry `observedGeneration`, but `Synced=True` describes the **most recent** reconcile; it is not by itself a heartbeat proving a controller remains alive. ([Go Packages](https://pkg.go.dev/github.com/crossplane/crossplane-runtime/apis/common/v1?utm_source=chatgpt.com)) | An XR has `Ready` and `Synced`; XR `Ready` becomes true when its composition pipeline reports all composed resources ready. ([Crossplane Documentation](https://docs.crossplane.io/master/composition/composite-resources/?utm_source=chatgpt.com)) | Add another composed resource, provider condition, or readiness rule. |
| Cluster API | Now builds on `metav1.Condition`, but adds explicit machinery for mirroring, aggregating and summarizing conditions. Missing expected conditions are treated as `Unknown` with `NotYetReported`. ([Go Packages](https://pkg.go.dev/sigs.k8s.io/cluster-api/util/conditions?utm_source=chatgpt.com)) | Its merge machinery explicitly orders “issue”, “unknown”, then informational/healthy observations. | It inherits Kubernetes generation semantics; it does not make condition transition timestamps into leases. | Machine `Ready`, for example, is derived from a defined set such as `BootstrapConfigReady`, `InfrastructureReady`, `NodeHealthy`, health-check conditions, plus optional readiness gates. CAPI also distinguishes one-time initialization facts from ongoing operational conditions. ([GitHub](https://github.com/kubernetes-sigs/cluster-api/blob/main/docs/proposals/20240916-improve-status-in-CAPI-resources.md?utm_source=chatgpt.com)) | Third parties can inject conditions and add them through readiness/availability gates, giving extension without redefining the core condition structure. ([GitHub](https://github.com/kubernetes-sigs/cluster-api/blob/main/docs/proposals/20240916-improve-status-in-CAPI-resources.md?utm_source=chatgpt.com)) |
| AWS EC2 status checks | Check-specific enums: detail checks are `passed`, `failed`, `initializing`, `insufficient-data`; summaries are `ok`, `impaired`, `initializing`, `insufficient-data`, `not-applicable`. System, instance and attached-EBS checks run automatically every minute. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html?utm_source=chatgpt.com)) | `impaired`/`failed` is observed failure. `insufficient-data` explicitly means the monitoring system did not have enough information. AWS advises treating missing-data states as missing data rather than as failure. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating_status_check_alarms.html?utm_source=chatgpt.com)) | AWS itself keeps running the checks. The API records `impairedSince` for failure, but this does not solve freshness of a **separate cache/poller** consuming EC2. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_InstanceStatusDetails.html?utm_source=chatgpt.com)) | The top-level categories are comparatively closed: system, instance, EBS, application. New application checks are configurable, but this is not an arbitrary Kubernetes-style condition namespace. |
| Juju | Separates workload status (`active`, `blocked`, `maintenance`, `waiting`, `error`, `unknown`, …) from agent status (`idle`, `executing`, `error`, `lost`, …). A unit can therefore be `active/idle` or `unknown/lost`. ([Ubuntu Documentation](https://documentation.ubuntu.com/juju/3.6/reference/status/?utm_source=chatgpt.com)) | Workload `error`/`blocked` expresses actual trouble; workload `unknown` expresses missing knowledge. | `lost` explicitly reports that the observer/agent is unresponsive. This is the strongest built-in distinction here between “last workload state” and “the thing reporting it has disappeared.” ([Ubuntu Documentation](https://documentation.ubuntu.com/juju/3.6/reference/status/?utm_source=chatgpt.com)) | If application status is not explicitly supplied, Juju infers it from unit workload statuses using priority; the operator framework uses `blocked > maintenance > waiting > active`. ([Ubuntu Documentation](https://documentation.ubuntu.com/juju/3.6/reference/status/?utm_source=chatgpt.com)) | New charms/components map their domain state into the same small generic status vocabulary rather than adding global status enums. |

One especially important Kubernetes distinction is that `observedGeneration=7` when `metadata.generation=8` means “this observation predates the current desired specification.” It does **not** mean “the observation is ten minutes old.” Likewise, `lastTransitionTime` can legitimately remain unchanged through thousands of successful polls if the result never changes. ([Kubernetes](https://kubernetes.io/docs/reference/kubernetes-api/apiextensions/custom-resource-definition-v1/?utm_source=chatgpt.com))

## 2. Concrete design A — flat Kubernetes conditions

For a fixed four-part unit, the whole resource can carry one condition per part plus an overall condition:

```yaml
status:
  conditions:
  - type: VirtualMachineReady
    status: "True"
    reason: ProviderHealthy
    observedGeneration: 12
    lastTransitionTime: "2026-09-16T20:00:00Z"

  - type: PublicAddressReady
    status: "False"
    reason: ProviderReportedFailure

  - type: PrivateAddressReady
    status: "Unknown"
    reason: ObservationFailed

  - type: ManagementCredentialReady
    status: "True"
    reason: CredentialValid

  - type: PollingHealthy
    status: "True"
    reason: PollsArriving

  - type: Ready
    status: "False"
    reason: PartNotReady
```

The two network addresses are named by semantic role (`PublicAddress`, `PrivateAddress`); if they have no such stable roles, instance-specific condition types such as `NetworkAddressAReady` and `NetworkAddressBReady` become part of the API.

Here, observed failure is `Ready=False`; inability to know is `Unknown`; generation staleness is detectable with `observedGeneration`. Time staleness is separate: a poll heartbeat or `lastObservedAt` must be supervised. Following the Kubernetes Node pattern, a **different liveness controller** can watch a poller Lease and convert component conditions to `Unknown/ObservationStale` when renewal stops. That independence matters: a dead poller cannot honestly mark its own status stale. Kubernetes does exactly this separation between kubelet heartbeat production and node-controller interpretation. ([Kubernetes](https://kubernetes.io/docs/concepts/architecture/leases/?utm_source=chatgpt.com))

`Ready` is stored as a condition and recomputed whenever any participating condition changes. Adding a fifth part requires defining another condition type and adding it to the summary rule.

This is closest to a small, fixed-shape Kubernetes API. Its extension cost grows with the number of independently named parts.

## 3. Concrete design B — Crossplane-style child resources

Here the unit is a composite, and each provisioned thing has its own object:

```text
Unit/demo
 ├─ VirtualMachine/demo-vm
 ├─ NetworkAddress/demo-public
 ├─ NetworkAddress/demo-private
 └─ ManagementCredential/demo-management
```

Every child exposes something like:

```yaml
status:
  observedAt: "2026-09-16T22:48:00Z"
  conditions:
  - type: Ready
    status: "False"
    reason: Unavailable
  - type: Synced
    status: "True"
    reason: ReconcileSuccess
```

That combination means something quite precise: **the poll succeeded and established that the part is unhealthy**. Crossplane's own `Unavailable` means the provider reports the resource unhealthy, whereas `Synced=False/ReconcileError` identifies trouble reconciling it. ([Crossplane Documentation](https://docs.crossplane.io/v2.3/managed-resources/managed-resources/))

If an API timeout prevents observation, the child can instead expose `Synced=False/ObservationError`, with `Ready=Unknown` in this adapted model. A freshness supervisor changes an old child to `Ready=Unknown`, `Synced=False`, `reason: ObservationStale`.

The Unit's stored `Ready` condition is derived from the four child `Ready` conditions. Its own `Synced` means the Unit controller reconciled successfully; it should not be mistaken for an aggregate of the children's `Synced` values. This mirrors an actual Crossplane distinction: XR readiness is cumulative, while `Synced` principally describes the resource's own reconcile. ([Crossplane Documentation](https://docs.crossplane.io/master/composition/composite-resources/?utm_source=chatgpt.com))

Naming is object identity rather than condition identity, so two addresses are naturally distinct objects. Adding a new kind such as `Disk` means adding another composed child implementing the same readiness contract; the parent shape does not need a new fixed field.

## 4. Concrete design C — Cluster API mirrors, aggregates and gates

This keeps separate part objects but makes the parent explicitly surface their important status:

```yaml
status:
  initialization:
    virtualMachineProvisioned: true
    addressesAllocated: true
    credentialCreated: true

  conditions:
  - type: VirtualMachineReady
    status: "True"

  - type: NetworkAddressesReady
    status: "Unknown"
    reason: NotYetReported

  - type: ManagementCredentialReady
    status: "True"

  - type: Ready
    status: "Unknown"
    reason: ReadinessUnknown
```

`NetworkAddressesReady` is an **aggregate** of `Ready` on the two address objects. `VirtualMachineReady` and `ManagementCredentialReady` are mirrors of child conditions. `Ready` summarizes those three parent-level conditions. CAPI's current condition utilities explicitly support mirrors, aggregation, summary, and treating missing expected source conditions as `Unknown/NotYetReported`. ([Go Packages](https://pkg.go.dev/sigs.k8s.io/cluster-api/util/conditions?utm_source=chatgpt.com))

This also demonstrates a CAPI-specific distinction: creation milestones can be monotonic initialization facts, while the corresponding ongoing health remains a condition. CAPI moved in this direction specifically so “was successfully provisioned once” is not confused with “is healthy now.” ([GitHub](https://github.com/kubernetes-sigs/cluster-api/blob/main/docs/proposals/20240916-improve-status-in-CAPI-resources.md?utm_source=chatgpt.com))

Time-stale polling again requires an external freshness observer; it can turn the affected child's `Ready` to `Unknown/ObservationStale`, which naturally propagates through aggregation.

For extension, the Unit can expose:

```yaml
spec:
  readinessGates:
  - conditionType: BackupReady
```

A new controller may add `BackupReady`; the generic summary logic incorporates it because it is named as a gate. That is directly analogous to CAPI Machine readiness gates and Cluster availability gates. ([GitHub](https://github.com/kubernetes-sigs/cluster-api/blob/main/docs/proposals/20240916-improve-status-in-CAPI-resources.md?utm_source=chatgpt.com))

This design therefore distinguishes “core conditions known by the API” from “additional conditions participating by declaration.”

## 5. Concrete design D — AWS-like check vector

Instead of tri-state propositions, each part is a check result:

```yaml
status:
  checks:
  - name: virtual-machine
    kind: VirtualMachine
    result: ok
    observedAt: "2026-09-16T22:50:00Z"

  - name: address/public
    kind: NetworkAddress
    result: impaired
    observedAt: "2026-09-16T22:50:00Z"
    impairedSince: "2026-09-16T22:41:00Z"

  - name: address/private
    kind: NetworkAddress
    result: insufficient-data
    observedAt: "2026-09-16T22:50:00Z"

  - name: credential/management
    kind: ManagementCredential
    result: ok
    observedAt: "2026-09-16T22:50:00Z"
```

The AWS-derived vocabulary is useful because it makes `impaired` and `insufficient-data` peers rather than encoding both as generic failure. AWS itself uses this distinction and explicitly cautions against treating missing status-check data as a failed check. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating_status_check_alarms.html?utm_source=chatgpt.com))

For your poller, add a second dimension:

```yaml
summary:
  health: impaired
  freshness: stale
```

`health` is computed from the last observations; `freshness` is computed from `now - observedAt`. Thus an old `ok` remains historically “the last check said OK,” while `freshness: stale` says it must no longer be trusted.

That summary can be **computed on read** rather than persisted. Doing so has a special property for a polling system: freshness becomes stale merely because clock time advances; no dead poller has to write another object. An alternative is a separate TTL/watchdog writer.

Part names are data (`name`, `kind`), not fields or condition types, so adding `disk/root` requires no status schema change. That is more extensible than AWS's actual EC2 API: EC2's standard status categories themselves are enumerated rather than an arbitrary list. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_InstanceStatus.html?utm_source=chatgpt.com))

## 6. Concrete design E — Juju-style two-axis status

Each part gets a domain/workload status and an observer status:

```yaml
status:
  parts:
  - name: vm
    kind: VirtualMachine
    workload:
      status: active
      since: "2026-09-16T18:22:00Z"
    observer:
      status: idle
      since: "2026-09-16T22:50:00Z"

  - name: address/public
    kind: NetworkAddress
    workload:
      status: unknown
    observer:
      status: lost

  - name: credential/management
    kind: ManagementCredential
    workload:
      status: blocked
      message: Credential rejected by provider
    observer:
      status: idle
```

A known bad credential can be `blocked/idle`: the observer is fine and has conclusively discovered a problem. A failed poller is `unknown/lost`: the thing's current state is not claimed, while the failure of the observer is explicit. Juju uses exactly this conceptual split in unit status; its documented example notation includes combinations such as `active/idle` and `unknown/lost`. ([Ubuntu Documentation](https://documentation.ubuntu.com/juju/3.6/reference/status/?utm_source=chatgpt.com))

A generic workload summary could use Juju's severity ordering—`blocked`, then `maintenance`, then `waiting`, then `active`—while keeping observer health as a separate aggregate. Juju itself infers application status from unit workload statuses when no application status is explicitly set. ([Ubuntu Documentation](https://documentation.ubuntu.com/juju/3.6/reference/status/?utm_source=chatgpt.com))

Adding a new kind does not add a new top-level health vocabulary. Instead its adapter decides what `active`, `waiting`, `blocked`, etc. mean for that domain. Juju explicitly notes that workload status semantics ultimately depend on the charm author. ([Ubuntu Documentation](https://documentation.ubuntu.com/juju/3.6/reference/status/?utm_source=chatgpt.com))

## Where the sources disagree

The most consequential disagreements can be summarized like this:

| Question | Kubernetes / CAPI | Crossplane | AWS | Juju |
|---|---|---|---|---|
| **Is status a proposition or a state enum?** | Mostly propositions: `Ready=True/False/Unknown`. | Propositions, with separate `Ready` and reconciliation `Synced`. | Result enums such as `ok`, `impaired`, `insufficient-data`. | Operational state enums. |
| **Does “can't observe” equal failure?** | No: use `Unknown`; CAPI treats missing expected conditions as Unknown. | Separates external unavailability from reconcile failure. | No: `insufficient-data` is distinct from impairment. | No: `unknown` and agent `lost` are distinct from workload error. |
| **Is generation freshness the same as clock freshness?** | No. `observedGeneration` only relates status to desired generation. | Same issue. | Not really applicable to AWS's own checks; a consuming poller's cache still needs timestamps. | Uses liveness/agent status rather than resource generation. |
| **Who detects a stopped reporter?** | Kubernetes's strongest example uses a second actor: Lease producer vs node controller. | Standard `Synced` alone does not expire itself. | AWS owns its check machinery; your external poller still needs its own watchdog/age test. | Controller detects the agent as `lost`. |
| **How is the summary represented?** | Usually a stored condition calculated by controller. | Stored `Ready`, with composition determining child readiness. | Service-computed aggregate/check result; a client can similarly compute. | Application status may be explicitly set or inferred. |
| **How does a new kind become summary-relevant?** | Add conditions and summary logic; CAPI can make this data-driven with gates. | Add another resource implementing readiness. | Add another check/category and its aggregation semantics. | Map the kind into the existing generic status vocabulary. |

The deepest disagreement is therefore not `True/False/Unknown` versus `ok/impaired`. It is **whether freshness belongs inside the health value at all**. Kubernetes Node and Juju effectively allow observer failure to invalidate or qualify workload status; AWS keeps “insufficient data” in the result vocabulary; Crossplane primarily distinguishes usability from reconcile success. For a no-webhook polling architecture, all four interpretations can be represented, but they produce materially different APIs when the last successful poll was healthy and the poller subsequently disappears.

---

If you want, I can:

- Explore adding 'stale observation' handling to a Kubernetes-style condition model
- Detail how to extend the Crossplane child resource pattern with a new part
- Describe integrating observer and workload status axes like Juju for this unit
