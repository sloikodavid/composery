# Research Hetzner Provisioning Adapter

Source: https://chatgpt.com/share/6aa6f5a9-8210-83eb-a2fe-c97429f7c3d7

---

## Turn 1: User

_2026-09-13T19:03:31.842Z_

Research a production Hetzner Cloud provisioning adapter for a TypeScript/Convex control plane. Users can own multiple servers. The database commits desired state before an action calls Hetzner. A request can reach Hetzner even when the response or the later database commit is lost. We need create, inspect, start, stop, and delete; no frontend, billing, snapshots, or guest agent yet.

Use current official API documentation and official SDK source. Establish whether create has a documented idempotency key, whether server names are unique and in which scope, what labels guarantee, and whether any lookup consistency guarantee closes the uncertain-create gap. Analyze concurrent workers, leases expiring during requests, delayed success, action retention, missing action IDs, pagination during inventory changes, manual changes, project limits, 429 responses, capacity errors, and authentication failures. Cover creation/deletion of Primary IPs and all separately billable dependencies. Distinguish an accepted action from a completed action and from guest readiness.

Return an endpoint/guarantee matrix, the smallest defensible adapter interface, precise operation transitions, and a failure table that explains when a retry is safe, when reconciliation is required, and when operator intervention is unavoidable. Include an inexpensive disposable live verification plan. Do not infer undocumented guarantees from an SDK retry loop. Cite direct primary sources and label unknowns. Do not write a full implementation.

---

## Turn 2: ChatGPT

_2026-09-13T19:03:33.646Z_

I’ll anchor this in Hetzner’s current Cloud API documentation and official SDK/source, then separate documented guarantees from observed/SDK behavior. I’ll focus especially on the uncertain-create window and on what your Convex state machine must do when a worker loses the response or its lease.

---

## Turn 3: ChatGPT

_2026-09-13T19:04:33.062Z_

One important finding already: Hetzner documents project-scoped unique server names, but I have not found any documented `Idempotency-Key` support for `POST /servers`. I’m treating that absence as a first-class design constraint rather than relying on client retries to make creates safe.

---

## Turn 4: ChatGPT

_2026-09-13T19:06:35.315Z_

The API’s error model is also useful for the state machine: it distinguishes explicit rejections such as `resource_limit_exceeded` (403), `uniqueness_error` (409), `resource_unavailable` (412), `locked` (423), and `rate_limit_exceeded` (429), while 502/504 are specifically described as requests the backend could not answer and should be retried. For creates, I’m still treating any response-loss/transport ambiguity more conservatively than those documented HTTP errors.

---

## Turn 5: ChatGPT

_2026-09-13T19:10:44.910Z_

## Bottom line

A production Hetzner adapter should be designed as a **reconciler with durable uncertainty**, not as an RPC wrapper.

The decisive facts are:

- I found **no documented idempotency key/header/field for `POST /servers`** in the current Cloud API reference. Hetzner's official Go SDK does retry some failures, including network timeouts, but that is SDK behavior and does **not** establish create idempotency. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) 
- Server names are documented by Hetzner's official Python SDK as **unique per project**. API tokens are themselves bound to one project. ([github.com](https://github.com/hetznercloud/hcloud-python/blob/main/hcloud/servers/client.py?utm_source=chatgpt.com))
- Labels are documented as mutable key/value metadata with selector filtering. There is **no uniqueness, immutability, reservation, or idempotency guarantee** for labels. The official Go client exposes server `PUT` updating both name and labels. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))
- I found **no documented read-after-write, bounded-staleness, or lookup-consistency guarantee** for `GET /servers`, name filters, or label selectors. Pagination is ordinary page/per-page pagination with no documented snapshot isolation. Therefore a lookup does **not formally close the uncertain-create gap**. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))
- An Action means an asynchronous provider operation was accepted/tracked. `running` is not completion. Hetzner says completion is `success` or `error`, and `success` means its asynchronous work has completed and targeted resources are in a consistent provider-side state. That still says nothing about the guest OS or application being ready. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))
- Actions are only retained for **90 days**. Missing action IDs and eventually missing Action objects therefore have to be survivable. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

The production pattern I would use is: **deterministic never-reused provider names + identity labels + explicit Primary-IP ownership + one-attempt mutating HTTP calls + fenced operation records + reconciliation after every ambiguous outcome**.

### Endpoint / guarantee matrix

| Operation | Endpoint / official SDK behavior | Successful response means | Safe correctness primitive | Important caveat |
|---|---|---|---|---|
| Create server | `POST /servers`; official Go SDK returns preliminary `Server`, `Action`, `NextActions`, optional root password. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Request got a successful HTTP response and creation has been accepted; returned Action can still be `running`. | Persist returned server ID immediately; otherwise reconcile by deterministic name + identity labels. | **No documented idempotency key.** Lost response can mean “created, but unknown locally.” |
| Inspect by ID | `GET /servers/{id}`; official SDK maps `not_found` to nil. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Current provider observation of that ID. | Canonical after external ID is known. | No documented bounded read consistency. |
| Recover by name | Official SDK's `GetByName` is implemented using `List(... Name: name)`. Name is documented unique per project. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Candidate matching that project/name. | Best recovery key before ID is known. | Name is mutable; lookup visibility timing is undocumented. |
| Recover by labels | `GET /servers?...label_selector=...`; labels are filterable key/value metadata. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) | Resources currently matching the selector. | Secondary identity evidence and inventory discovery. | Labels are mutable and non-unique; not a deduplication token. |
| Start | `POST /servers/{id}/actions/poweron`; returns Action. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Power-on action accepted, not necessarily completed. | Action followed by `GET server`; if response lost, inspect server first. | `running` server is **not guest-ready**. |
| Graceful stop | `POST /servers/{id}/actions/shutdown`; returns Action. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Shutdown action accepted. | Wait/reconcile to `off`. | Guest may delay/fail graceful shutdown. |
| Hard stop | `POST /servers/{id}/actions/poweroff`; official SDK explicitly describes this as stopping the server. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Hard power-off accepted. | Wait/reconcile to `off`. | Different semantics from `shutdown`; adapter should not conflate them. |
| Delete server | `DELETE /servers/{id}`; current official Go SDK returns an Action. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Delete accepted. | Eventually verify `GET /servers/{id}` → 404. | Action can be lost/expire; owned dependent resources need separate verification. |
| Get Action | Prefer `GET /actions/{id}` or `GET /<resource>/actions/{id}`. Per-resource-ID nested forms were deprecated in April 2026. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com)) | Current action status. | Useful progress accelerator. | Actions older than 90 days disappear; never make them the sole source of truth. |
| Create Primary IP | `POST /primary_ips`. Primary IPs are independently manageable/billed. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) | IP creation accepted/completed according to response/action. | Give owned IPs deterministic project-unique names and reconcile like servers. | Same response-loss issue as any non-idempotent create; no documented idempotency key found. |
| Delete Primary IP | `DELETE /primary_ips/{id}`. | Successful delete request. | Verify `GET /primary_ips/{id}` → 404. | Since May 1, 2026, assigned IPs cannot be deleted; unassign first or delete the server. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com)) |

One current-version detail matters when writing this now: `datacenter` was removed from Server and Primary-IP request/response data on July 1, 2026; use `location`. Also, an unassigned Primary IP now reports `assignee_type: "unassigned"` as of August 1, 2026. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

## The uncertain-create gap

Suppose Convex contains:

`desired = server exists`

and worker A durably records that it is about to dispatch `POST /servers`. The HTTP request reaches Hetzner, Hetzner creates the server, but A loses the response or dies before committing the external server ID.

You now cannot distinguish:

1. the POST never reached Hetzner;
2. it reached Hetzner and was rejected;
3. it succeeded and the response was lost;
4. it succeeded but a subsequent lookup has not yet exposed it;
5. it succeeded and a human subsequently renamed/deleted it.

There is no documented idempotency token to query, and I found no documented read-after-write deadline saying “if name lookup is empty after X seconds, creation definitely did not happen.”

Project-unique names improve this enormously but do not turn it into a formal exactly-once protocol. An appropriate provider name is something derived from an immutable logical server generation, for example:

`cp-<logical-server-uuid>-g<generation>`

Do **not** use the customer's editable display name as this identity, and never reuse a provider name after a logical server has been deleted. Put secondary evidence in labels such as `example.com/logical-id`, `example.com/generation`, and `example.com/managed-by`. Names are documented unique per project, while labels are only filterable metadata. ([github.com](https://github.com/hetznercloud/hcloud-python/blob/main/hcloud/servers/client.py?utm_source=chatgpt.com))

After an uncertain create, query by the deterministic name. If exactly one matching server exists and its identity labels plus immutable-enough creation attributes match, adopt its ID. If the name exists but identity does not match, stop: it is a collision/manual-drift case, not a resource you should modify.

If it remains absent, there are two defensible policies:

**Practical production policy:** after repeated reconciliation over your own chosen safety window, retry the same deterministic name. Project-level uniqueness prevents two simultaneously existing resources with the same name, and a resulting `uniqueness_error` becomes another signal to reconcile. But this is an **engineered risk policy, not documented API idempotency**.

**Strict no-ambiguity policy:** keep the operation blocked for operator verification. This is the only position that avoids relying on an undocumented lookup-timing property.

I would choose the first for ordinary cloud provisioning, while making the residual ambiguity explicit in the design documentation.

## Smallest defensible adapter interface

The important abstraction is not a giant Hetzner-shaped SDK. It is that every mutation must distinguish **received success**, **received rejection**, and **unknown outcome**.

```ts
type ProviderAttempt<T> =
  | {
      kind: "accepted";
      value: T;
      correlationId?: string;
    }
  | {
      kind: "rejected";
      error: ProviderError;
      correlationId?: string;
    }
  | {
      kind: "unknown";
      error: TransportError;
    };

type ProviderAction = {
  id: string;
  status: "running" | "success" | "error";
  errorCode?: string;
  errorMessage?: string;
};

interface HetznerProvisioner {
  inspectServer(id: string): Promise<ServerObservation | null>;

  findServer(identity: {
    providerName: string;
    logicalId: string;
    generation: string;
  }): Promise<ServerObservation[]>;

  inspectAction(id: string): Promise<ProviderAction | null>;

  createServer(
    spec: CreateServerSpec
  ): Promise<ProviderAttempt<{
    serverId: string;
    actionId?: string;
    nextActionIds: string[];
  }>>;

  startServer(
    serverId: string
  ): Promise<ProviderAttempt<{ actionId: string }>>;

  stopServer(
    serverId: string,
    mode: "shutdown" | "poweroff"
  ): Promise<ProviderAttempt<{ actionId: string }>>;

  deleteServer(
    serverId: string
  ): Promise<ProviderAttempt<{ actionId?: string }>>;

  inspectPrimaryIp(id: string): Promise<PrimaryIpObservation | null>;
  findPrimaryIp(identity: ProviderIdentity): Promise<PrimaryIpObservation[]>;

  createPrimaryIp(
    spec: CreatePrimaryIpSpec
  ): Promise<ProviderAttempt<{
    primaryIpId: string;
    actionId?: string;
  }>>;

  deletePrimaryIp(
    id: string
  ): Promise<ProviderAttempt<void>>;
}
```

I would deliberately make each mutation perform **one network attempt**. Retry policy belongs above this interface, where the control plane knows whether it is reconciling an unknown outcome or retrying a known rejection.

The official API reference currently advertises Hetzner-maintained Go and Python libraries, not an official TypeScript SDK. For TypeScript I would therefore use a narrow HTTP client with automatic mutation retries disabled, rather than importing retry semantics from an unofficial SDK. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

Also use strings internally for provider IDs. Hetzner announced IDs up to 52 bits; that currently fits JS safe integers, but string IDs avoid pointless numeric assumptions and make serialization/future expansion less fragile. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

### Why not expose `waitForAction()` as the central abstraction?

Because Actions are not durable enough. They expire from API visibility after 90 days, a create response can be lost before you ever obtain its Action ID, and a lost delete Action is harmless if the resource is already absent. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

Action polling should accelerate reconciliation, not define correctness.

## Operation state machine

I would keep a durable operation record roughly containing `operationId`, logical server ID, logical generation, desired-state revision, attempt counter, fencing epoch, lease expiry, provider ID if known, action IDs if known, last HTTP result, and last observation.

The common transition skeleton is:

| State | Meaning | Permitted next step |
|---|---|---|
| `planned` | Desired state is committed; no external attempt durably recorded yet. | Acquire lease/fence. |
| `dispatching` | Attempt record/fence was committed **before** network I/O. The request may have reached Hetzner. | One HTTP call only. |
| `accepted` | A successful HTTP response was received. | Persist returned IDs, then monitor Action/observed state. |
| `waiting_external` | Action is running or provider change has not yet converged. | Poll Action sparingly and inspect resource. |
| `outcome_unknown` | No authoritative response: timeout/reset/crash/expired worker. | **Reconcile before any retry.** |
| `retry_wait` | Authoritative retryable rejection. | Backoff, then re-read state and retry. |
| `blocked` | Auth, quota, foreign-resource collision, protection, etc. requires a change outside normal retries. | Operator/configuration event. |
| `verifying` | Provider claims success or desired state seems present. | Inspect canonical resource/dependencies. |
| `succeeded` | Current desired revision is demonstrably satisfied. | Terminal for this operation. |
| `superseded` | A newer desired-state revision won. | Do not overwrite newer state. |

A lease is **not** a fence at Hetzner. If a lease expires while A's HTTP request is in flight, worker B must assume A's request may still complete. The successor's first operation is reconciliation, not another POST.

Likewise, a stale worker returning after its lease expired must not be allowed to write “success” over a newer intent. Every after-the-network database mutation should compare at least `(logical generation, operationId, desiredRevision, fenceEpoch)`. A stale worker that learned a useful external ID can record it only through a CAS compatible with that original operation/generation, or as a separate observation for the reconciler.

### Create

The exact transition should be:

`planned → dispatching → POST /servers once`

On received 2xx:

`accepted(serverId, actionId?) → waiting_external → verifying → succeeded`

Do not make `action.status === "success"` alone sufficient. Re-read the server by ID and verify identity/location/type/network ownership and the intended initial power state.

On timeout/reset/crash:

`dispatching → outcome_unknown → find deterministic name`

Then:

- matching identity found → bind ID → `waiting_external/verifying`;
- name found with wrong identity → `blocked_foreign_collision`;
- absent → remain uncertain and repeat reads; only later perform your policy-approved same-name retry.

If creation is configured to start the VM, Hetzner can expose server status `running` after provider completion. That still means only **hypervisor/provider running**. With no guest agent or explicit health probe, introduce no state named `ready`; the strongest status you have is something like `providerRunning`. Actions are explicitly provider-side asynchronous work. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

### Start

First inspect. If the server is already `running` and this desired revision still wants running, succeed without a mutation.

Otherwise send one `poweron`. A received response gives you an Action; wait/reconcile until observed running. If the response is lost, inspect before another `poweron`. Repeating a start by stable server ID cannot create a second server, so its failure mode is much less dangerous than repeating create; nevertheless `locked`, a concurrent stop, or superseded desired state means “reconcile,” not “hammer it again.”

### Stop

Make the semantics explicit. Hetzner has both `shutdown` and `poweroff`; the official SDK treats them as different operations. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com))

If your product means “ask the operating system to shut down,” use `shutdown`. If it means “ensure this VM is no longer powered,” use `poweroff`. I would keep the mode in the adapter interface rather than hiding that distinction.

Success is observed `off`, not merely “Action accepted.”

### Delete

With a known server ID:

`desired absent → inspect → DELETE /servers/{id} → accepted/unknown → inspect by ID`

A 404 on the known ID satisfies server absence regardless of whether the delete Action ID was persisted.

Then reconcile **owned dependencies** before declaring the logical deletion complete. A successful server deletion is not equivalent to “nothing billable from this logical server remains.”

This also makes delayed success harmless. If worker A times out deleting and Hetzner finishes 30 seconds later, B simply sees 404 and proceeds with child cleanup.

## Primary IPs and other billable dependencies

This deserves explicit ownership because the default server-create behavior can otherwise create resources you cannot deterministically account for.

Hetzner states that a server does not itself include public IP addresses and that, if you create a server with a public IP but don't provide an existing Primary IP, Hetzner will **auto-create** one. Primary IPs and servers are billed independently, and an unassigned Primary IP remains billable until deleted. Primary IPv6 is currently free; Primary IPv4 is separately charged. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/overview/?utm_source=chatgpt.com))

For this control plane I would **not let `POST /servers` implicitly allocate owned public IPs**. Instead:

1. create each desired Primary IP explicitly with a deterministic name and labels;
2. reconcile its uncertain create independently;
3. persist its ID;
4. pass that existing IP ID into `POST /servers`.

The official Go server create request supports supplying existing Primary IPv4/IPv6 IDs. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com))

That adds steps but gives every potentially lingering resource a ledger entry.

Primary IP deletion has two current wrinkles. First, `auto_delete=false` means the IP survives server deletion; `auto_delete=true` makes it disappear with the server, unless protection prevents it. A protected assigned Primary IP can even prevent server deletion. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com)) Second, since May 1, 2026, deleting an assigned Primary/Floating IP is forbidden and returns `must_be_unassigned`. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

For maximum observability I favor `auto_delete=false`: delete the server, verify it is absent so the owned IP is unassigned, then explicitly delete each owned Primary IP and verify 404. The trade-off is a short interval in which that surviving IPv4 remains billable.

| Related resource | Can this server-create flow introduce it? | Billing / cleanup implication |
|---|---|---|
| Primary IPv4/IPv6 | **Yes**, implicitly if public networking is enabled without existing IDs. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/overview/?utm_source=chatgpt.com)) | Separately managed and billed; unassigned IP continues to exist. Explicit ownership recommended. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com)) |
| Volume | `POST /servers` accepts IDs of **existing** Volumes; it does not create a new Volume in the SDK request. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Volume is separately hourly billed. Hetzner instructs disconnecting and explicitly deleting it to cancel it. Do not delete manually attached Volumes unless your DB says you own them. ([Hetzner Docs](https://docs.hetzner.com/cloud/volumes/overview/?utm_source=chatgpt.com)) |
| Floating IP | Not automatically created by the normal server create request. | Separately billed. Treat any manually attached Floating IP as foreign unless separately adopted/owned. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com)) |
| Backups | Not needed by your requested scope. | Separately charged when enabled. Reject/flag rather than silently managing. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com)) |
| Snapshots | Explicitly out of scope. | Separately billed storage; never infer ownership merely because image/server relationships exist. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com)) |
| Networks / Firewalls / placement groups | Can be referenced by server create but are independent resources. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/server.go?utm_source=chatgpt.com)) | Don't delete them based solely on attachment to this server; require explicit ownership. |

So deletion of a server should have a narrow destructive rule: **delete only resources whose ownership record says this logical server generation created/owns them.** Never make “attached at deletion time” synonymous with “ours.”

## Failure and retry table

Here, “safe retry” means safe for the desired-state operation after the indicated check—not a claim that the raw HTTP method is magically idempotent.

| Condition | Classification | What to do | Blind retry? |
|---|---|---|---|
| Local validation failure before network write | Known no provider attempt | Fix request/spec. | Yes after fix. |
| Structured `400 json_error`, `422 invalid_input` | Authoritative bad request | Mark permanent/config error. | **No** until input changes. |
| `401 unauthorized` | Credential invalid/unknown | Block; rotate/fix token. | **No** with same token. |
| `401 token_readonly` | Token cannot mutate | Block; install write token. | **No**. |
| `403 forbidden` | Permissions | Block/operator. | **No** until permissions change. |
| `403 resource_limit_exceeded` | Project/account quota | Block on quota increase or revised desired state. | **No** immediate retry. |
| `403 maintenance` / `503 unavailable` | Provider temporary condition | Backoff; reconcile before mutating retry. | Yes later; create should reconcile first. |
| `409 uniqueness_error` during deterministic create | Existing unique value | **Reconcile by deterministic name and identity.** | **No blind create retry.** |
| `409 conflict` | API says resource changed during request and says retry. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) | Re-read current resource, ensure desired revision is current, then retry. | Yes after read. |
| `412 resource_unavailable` | Requested capacity/resource unavailable | Backoff or choose an alternate location only if policy explicitly permits changing desired placement. | Yes later, not tight-loop. |
| `423 locked` | Another Action is running | Observe existing resource/action; retry after it settles. | **No immediate retry.** |
| `423 protected` | Provider protection blocks mutation | If protection is adapter-owned, explicitly manage it; otherwise operator. | **No**. |
| Explicit `429 rate_limit_exceeded` | Throttled | Honor `RateLimit-Reset`, add jitter, reduce polling. | Yes after delay. |
| `500 server_error` on create | Outcome semantics insufficiently guaranteed | Treat create as uncertain; reconcile. | **No blind create retry.** |
| `502 bad_gateway`, `504 timeout` | Docs say “please retry,” but do not document create idempotency. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) | For create: `outcome_unknown` → reconcile first. For ID-based desired-state actions: re-inspect, then retry if still needed. | Not blind for create. |
| Network timeout/reset after request may have been written | Unknown outcome | Durable `outcome_unknown`; reconcile. | **No blind create retry.** |
| Worker/process dies after dispatch record | Unknown outcome | Successor reconciles; lease expiration does not authorize a second POST. | No. |
| Lease expires while request is live | Potential concurrent delayed success | Fence stale DB writes; successor reconciles. | No. |
| Action is `running` | Accepted, incomplete | Keep waiting with bounded polling/backoff. | No duplicate action merely because it is slow. |
| Action is `error` | Accepted, then failed | Re-inspect target, classify action error, then decide retry/block. | Depends on resulting state/error. |
| Action ID was never persisted | Missing progress handle | Reconcile resource state directly. | Often unnecessary. |
| Action GET returns 404 / age >90 days | Action no longer authoritative/retained | State-based reconciliation. | Never fail operation merely because Action disappeared. |
| Unknown create finds exact matching name+identity | Provider create succeeded | Adopt ID and continue. | No second create. |
| Unknown create finds same name but foreign labels/spec | Identity conflict/manual intervention | Block, never overwrite/delete automatically. | No. |
| Unknown create remains absent after safety window | Fundamental undocumented ambiguity | Apply explicit same-name retry risk policy, or operator verification for strict mode. | **Not provably safe under documented guarantees.** |
| Primary IP delete says `must_be_unassigned` | Wrong dependency order | Wait for/delete server or unassign while server is off, then delete. | No immediate identical retry. |
| Manual deletion while DB still desires server | Destructive drift | I would default to operator/drift state, not recreate data-bearing VM silently. | No by default. |
| Manual power change | Reversible drift | Reconcile back toward desired power state if control plane is authoritative. | Yes after inspection. |

The general error codes and 429 headers/default 3,600 requests/hour/project are directly documented. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

For capacity specifically, do not turn a server-type availability preflight into a promise. Hetzner explicitly says `server_types.locations.available` is only an **indicator** and “is no guarantee.” ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

## SDK retries: useful evidence, not a guarantee

The current official Go client's retry handler retries API conflicts, 429, 502, 504, and network timeouts. 

That is exactly why I would not copy the SDK's retry behavior blindly into this adapter. A network timeout after a `POST /servers` can occur after Hetzner received the request. Retrying automatically inside a transport layer destroys the control plane's ability to know whether one or two calls were attempted.

For this particular architecture:

- reads can use ordinary bounded automatic retries;
- mutating operations should have transport retries **off**;
- the reconciler decides whether another mutation is warranted;
- every HTTP response you do receive should persist useful diagnostics such as status/error code and Hetzner's correlation/request identifier if available.

The API's generic “please retry” wording for 502/504 is not an idempotency contract. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

## Concurrent workers and superseding desired state

Serializing workers with leases is still useful to reduce noise, but correctness must come from fencing plus reconciliation.

Imagine A starts `shutdown`, loses its lease, B observes a newer desired state of `running` and begins a start operation, and A's shutdown succeeds late. The correct answer is not “whichever Action completed last.” The **latest desired revision wins**. B's reconciler eventually observes `off` and powers the VM back on.

So action completions should update observations, never directly overwrite current desired state.

Similarly, if A creates the server, gets ID 123, loses its lease, and B has already adopted 123 by name, A's late response is harmless. A conditional DB mutation can recognize “same generation, same provider ID” as compatible. If A reports a different provider ID for the same logical generation, that is a high-priority reconciliation anomaly—not something to resolve by deleting one arbitrarily.

## Pagination and inventory reconciliation

Hetzner's pagination is numeric `page`/`per_page`, default 25/max 50, with pagination metadata; there is no documented snapshot token or snapshot isolation. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

Therefore, while resources are added/deleted, a single multi-page walk can in principle see page shifts, duplicates, or omissions. Do not use:

> “Resource was missing from one inventory sweep”

as proof that it has been deleted.

For correctness-critical resources:

- use direct ID GET once the ID is known;
- use exact deterministic-name recovery before the ID is known;
- use label/paginated scans for inventory, drift detection, and finding orphans;
- deduplicate inventory by ID and preferably require repeated/stable absence before garbage-collection decisions.

In particular, never run orphan deletion solely from one mutable paginated scan.

## Manual changes

There are two kinds of drift worth treating differently.

Reversible drift—manual power-on/off, label modifications—is usually safe to reconverge automatically if this control plane is explicitly authoritative.

Destructive or identity drift—manual server delete, rename during an uncertain create, foreign resource taking the deterministic name, unexpected billable attachments—should normally stop automatic destructive behavior.

With no snapshots, backups, or guest-state layer in this scope, I would **not automatically recreate a manually deleted desired server**. Recreating a VM satisfies topology but not the lost disk contents. Record `externally_deleted`/`drifted` and require an explicit product policy or operator decision.

Manual rename is also the clearest reason name uniqueness does not mathematically solve the uncertain-create problem: if the response was lost and somebody renames the newly created server before reconciliation, the original name lookup cannot prove what happened.

## Accepted, completed, and ready are three different states

This distinction should appear in your external model:

| Layer | Meaning |
|---|---|
| **Accepted** | Hetzner returned successful HTTP and, for asynchronous operations, an Action. |
| **Provider completed** | Action reached `success`, and/or subsequent resource observation satisfies provider state. Hetzner says Action success occurs after its async tasks complete and targeted resources are consistent. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) |
| **Guest ready** | OS booted, networking configured inside guest, SSH/application/agent usable. **UNKNOWN in this scope.** |

A server can therefore legitimately be `providerRunning` while you expose no assertion about guest readiness.

Don't overload “running” into “ready.”

## Disposable live verification plan

A cheap verification can be done in a fresh project with one cheapest currently orderable shared server, one free Primary IPv6, and optionally one paid Primary IPv4. A server used only for minutes is still billed for at least one hour, so keep the experiment compact. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com))

1. Create a disposable project and read/write API token. Use raw HTTP or a client with mutation retries disabled. Create two deterministic Primary IPs if you want to test both cleanup paths: IPv6 with `auto_delete=false`, optionally IPv4 with `auto_delete=true`. Record every ID, timestamp, HTTP status, error code, Action ID, and correlation header.

2. Create one server with `start_after_create=false`, deterministic provider name, identity labels, and the existing IP IDs. Immediately exercise GET by ID, exact name, and label selector. Measure what you observe, but explicitly record that a successful experiment is **not evidence of a contractual consistency guarantee**.

3. While that server exists, attempt another `POST /servers` with the exact same name. Confirm the observed uniqueness behavior/error payload. This validates your parser and recovery path; the documented invariant remains the official SDK's “unique per project,” not whatever one experiment happens to return. ([GitHub](https://github.com/hetznercloud/hcloud-python/blob/main/hcloud/servers/client.py?utm_source=chatgpt.com))

4. Put a one-shot local proxy between the test client and Hetzner that forwards a create/mutation request and then intentionally drops the downstream response. Do this for a disposable create if budget allows, or at minimum for start/stop. Confirm that your state becomes `outcome_unknown`, that a second worker does **not** immediately resend, and that reconciliation discovers the eventual state.

5. Exercise `poweron`; persist the initial Action status and poll until terminal. Then inspect server state. Exercise `shutdown` or `poweroff` similarly. Record the timing between HTTP acceptance, Action success, and resource status. Do not infer guest readiness from any of them.

6. Explicitly simulate a lease expiring while a response is delayed in your proxy. Start worker B after expiry. Assert B performs reads only until it has resolved A's possible result. Then allow A's response to arrive and verify its stale fence cannot overwrite B/current desired state.

7. Delete the server. Verify it becomes absent by ID. Check both IP ownership cases: the `auto_delete=true` IP should disappear with the server according to documented semantics; an `auto_delete=false` IP should remain unassigned. Explicitly delete the latter and verify 404. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com))

8. Exercise cheap error paths: invalid token → `401 unauthorized`; read-only token → `token_readonly` if convenient; duplicate name → uniqueness case; malformed request → 400/422. Do **not** deliberately consume 3,600 requests to test 429 or exhaust quota/capacity; cover those with deterministic HTTP fixtures based on documented error bodies.

9. Do not try to “prove” 90-day Action retention, pagination consistency, or capacity behavior with this disposable test. Those tests cannot improve the documented guarantees. Unit/integration-test your controller against missing actions, moving pagination, 429, quota, 412 capacity, 502/504, and indefinite uncertain lookup using fault injection.

10. Finish from a cleanup ledger, not the Console view: assert every test server ID is 404; every adapter-owned Primary-IP ID is 404; search the disposable identity labels for leftovers; check for Volumes/Floating IPs if you deliberately introduced any; then revoke the token.

## Recommended production invariants

The few invariants worth building the whole adapter around are these:

**A logical server generation gets one never-reused deterministic provider name.** User-visible naming is separate.

**Once learned, Hetzner's server ID is the canonical binding.** Name and labels become validation/recovery aids.

**Every network mutation is preceded by a durable dispatch record.** A crash after that point implies “possibly reached provider.”

**No mutating call has an invisible automatic retry beneath the reconciler.**

**Lease expiration never proves that the old request stopped.** A successor reconciles first.

**Action IDs are optional hints.** Resource state must be sufficient to finish reconciliation.

**A provider operation is not successful merely because the HTTP request was accepted.** Verify the terminal external state.

**Deletion is not complete until every adapter-owned independently billable child is gone.**

**Never delete resources solely because they were attached or had a matching label.** Ownership comes from your database plus provider identity.

And the central limitation should be documented explicitly:

> **UNKNOWN / not guaranteed by Hetzner:** there is no documented API mechanism in the sources reviewed that gives exactly-once `POST /servers` semantics after an ambiguous response, nor a documented lookup-consistency deadline that proves an absent lookup means the create did not happen.

Project-unique deterministic names make the practical design strong enough for production, but they do not convert that unknown into a provider guarantee.
