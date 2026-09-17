# Hetzner Primary IP Edge Cases

Source: https://chatgpt.com/share/6aab2c34-63f8-83eb-979c-3d8d38068c44

---

## Turn 1: User

_2026-09-16T22:55:49.597Z_

As of September 2026, from Hetzner's documentation, changelog and public issue trackers of Hetzner client libraries

(hcloud-go, hcloud-python, the Terraform provider), document the edge cases around Primary IPs and servers: what

auto_delete does and when; what happens to a Primary IP when its server is deleted, rebuilt or migrated; whether assign

and unassign are atomic and what errors concurrent attempts return; how long a deleted Primary IP address stays

unavailable before reuse; what happens when a server is created with Primary IPs in a different location; and any

documented race conditions or eventual-consistency windows between creating a resource and it being visible in list or

get calls. Report what client libraries do to work around these.

---

## Turn 2: ChatGPT

_2026-09-16T22:55:49.485Z_

I’ll triangulate the official API docs/changelog against hcloud-go, hcloud-python, and the Terraform provider’s public issues/PRs, then separate documented API guarantees from observed/client-side workarounds. I’ll also call out where Hetzner does *not* document a timing or atomicity guarantee rather than infer one.

---

## Turn 3: ChatGPT

_2026-09-16T22:56:01.943Z_

One important API change is already clear: since **1 May 2026**, assigned Primary/Floating IPs cannot be deleted directly; the API returns `must_be_unassigned`. That matters for interpreting older client/provider bugs and for `auto_delete` semantics, so I’m treating pre-May-2026 behavior separately from the current contract.

---

## Turn 4: ChatGPT

_2026-09-16T22:57:37.328Z_

The old Terraform replacement race was not just anecdotal: Hetzner’s provider maintainer identified the cause as returning from server deletion before its asynchronous delete action had completed. PR **#590** fixed it by waiting for that action, because the Primary IP could remain API-visible as “attached” for a few seconds after the delete call returned.

---

## Turn 5: ChatGPT

_2026-09-16T22:59:12.823Z_

As of **16 September 2026**, Hetzner’s model is best understood as: a Primary IP is an independently managed, location-bound resource; assignment changes are asynchronous **Actions**; and the reliable consistency boundary is successful completion of the returned Action, not the HTTP response that starts it. Hetzner explicitly says an Action reaches `success` only after its asynchronous work is complete and its target resources are in a consistent state. ([docs.hetzner.cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

## Primary-IP/server edge-case matrix

| Case | Documented/current behavior | Important edge cases / client behavior |
|---|---|---|
| **`auto_delete = false`** | Deleting the assigned server leaves the Primary IP behind, unassigned and available for later assignment. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com)) | This is the setting Hetzner’s Terraform maintainers recommend for separately managed `hcloud_primary_ip` resources that must survive server replacement. Issue #1093 shows why: with `auto_delete=true`, destroying the server also deleted the Terraform-managed IP and the replacement server then got `primary_ip_not_found`.  |
| **`auto_delete = true`** | The Primary IP is deleted when the server to which it is assigned is deleted. This is specifically tied to deletion of the assignee, not ordinary stop/reboot/rebuild operations. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com)) | Changing `auto_delete` from true→false in the **same Terraform apply that replaces the server is too late** if Terraform destroys the server first; the API may already have deleted the IP. Maintainer advice in #1093 was to apply `auto_delete=false` before replacing the server.  |
| **Deletion protection + `auto_delete`** | A protected Primary IP cannot be deleted, and Hetzner says a server with a protected Primary IP assigned **cannot itself be deleted**. Thus protection wins by preventing the server deletion rather than silently ignoring `auto_delete`. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com)) | Do not treat protection merely as protection against an explicit `DELETE /primary_ips/{id}`. It can block the server lifecycle operation too. |
| **Explicitly delete an assigned Primary IP** | Since **1 May 2026**, no longer allowed. It must first be unassigned; otherwise the API returns `must_be_unassigned`. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com)) | This changed older behavior. Terraform provider **v1.61.0** added “unassign before deleting a primary ip”; the API changelog had advised provider v1.60.0+ ahead of the transition. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/releases?utm_source=chatgpt.com)) Current `hcloud-python` source still contains a stale delete docstring saying deletion automatically unassigns an assigned IP, so code should follow the API changelog, not that docstring.  |
| **Server deleted** | `auto_delete=true`: IP deleted. `false`: IP survives, unassigned. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com)) | Unassignment resulting from server deletion itself is asynchronous enough that clients must wait for the server-delete Action. Historical Terraform #558 showed the server API call returning while the Primary IP still appeared attached; immediate replacement failed with `primary_ip_assigned`.  |
| **Server rebuilt** | Rebuild operates on the existing Server resource; it replaces/reinstalls its disk/image rather than deleting the Server. Consequently `auto_delete` is not triggered and the Primary IP remains associated with that server. Hetzner describes `Rebuild` as resetting the same server and separately describes delete/recreate when explaining how to preserve an IP. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) | This differs materially from Terraform “replace”/taint, which really does delete the old Server and create another one. For a replacement, `auto_delete` therefore matters. |
| **Hetzner live-migrates a server** | A live migration retains the existing Server resource; Hetzner documents that the power state can exceptionally change, but does not document Primary IP detachment/reallocation. The IP therefore remains attached. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) | If by “migrate” you mean moving a server to another **location**, that cannot be done in-place. Hetzner says to create a new server from a Snapshot/Backup in the new location. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) A location-bound Primary IP cannot follow it. |
| **Assign/unassign after creation** | Server must be powered off. A Primary IP can be on only one server, and the server can have at most one Primary IPv4 and one Primary IPv6. Primary IP and Server must be in the same Location. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com)) | Terraform explicitly powers down servers when changing public networking, waits for the relevant operations, then unassigns/assigns and powers back up. Current helper code also waits for every Primary-IP assign/unassign Action. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/blob/main/internal/server/resource.go?utm_source=chatgpt.com))  |
| **Server created with an existing Primary IP in another location** | Creation fails; location mismatch is not silently corrected and the IP is not moved. The documented call-specific code retained in the Go client is `primary_ip_datacenter_mismatch` (legacy error-code name despite the 2026 API transition from Datacenter fields to Location). ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) | If IPv4 and IPv6 supplied at creation are bound to different locations, there is no valid server location satisfying both, so creation cannot succeed. Also possible: `primary_ip_assigned` if one is already attached, or `primary_ip_version_mismatch` for the wrong family. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/error.go?utm_source=chatgpt.com)) |
| **Deleted address reuse** | **No fixed quarantine/reuse interval is documented** in the API reference, changelog, Primary-IP FAQ, or the three client/provider trackers I found. | Once the Primary IP resource is deleted, applications should regard that address/prefix as relinquished. The Create API chooses an address from the available pool; there is no API parameter for recreating a Primary IP with a requested previously deleted public address. “Wait N seconds and recreate to get the same address” is therefore not a documented contract. |

## Assign/unassign are Actions, not an atomic “move”

`POST .../actions/unassign` and `POST .../actions/assign` each start a distinct asynchronous Action. The Go methods simply return the `Action`; they do **not** synchronously wait inside `PrimaryIP.Assign` or `Unassign`.  Python behaves similarly: assign/unassign returns a `BoundAction`, and the caller can explicitly use the action waiting facility.  ([Hetzner Cloud Python](https://hcloud-python.readthedocs.io/en/stable/api.clients.actions.html?utm_source=chatgpt.com))

Consequently, a “move IP from server A to B” is **not one atomic API operation**. It is conceptually:

`power A off → unassign → wait success → power B off → assign → wait success`

There is a real intermediate state in which the IP is unassigned. Terraform provider v1.61.0 fixed its reassignment logic precisely because it had attempted to assign an already assigned Primary IP; Hetzner’s PR states that an existing assignment must first be removed and that otherwise the API returns `primary_ip_already_assigned`. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/releases?utm_source=chatgpt.com))

For genuinely concurrent mutation attempts, Hetzner documents two generic concurrency outcomes. **423 `locked`** means the target already has an Action running; **409 `conflict`** means the resource changed during the request and should be retried. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/hetzner?utm_source=chatgpt.com)) Timing can also move the loser into a call-specific validation error after the first operation has completed: `primary_ip_already_assigned`, `primary_ip_assigned`, `server_has_ipv4`, `server_has_ipv6`, or `server_not_stopped`, depending on the endpoint/state. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/error.go?utm_source=chatgpt.com))

So there is **not a documented guarantee that “two simultaneous Assign calls always return error X.”** While an Action overlaps, `locked` is the generic lock error; if a request races around the state change, `conflict` is possible; if it observes the post-race state, a semantic 422-style Primary-IP error can result.

Both official language clients automatically retry **`conflict`**, but notably not `locked`: current Go and Python retry network timeouts, HTTP 502/504, and application errors `conflict`, `rate_limit_exceeded`, `bad_gateway`, and `timeout`, with exponential backoff/jitter and five retries by default. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/hcloud.go?utm_source=chatgpt.com)) That means application code still needs to serialize Actions/wait for them; the retry layer is not an assignment-lock manager.

## The important eventual-consistency/race windows

Hetzner does **not** publish a general “GET/list becomes correct within N milliseconds” SLA. Its documented synchronization primitive is the Action: once that Action succeeds, its target resources are supposed to be in a consistent state. ([docs.hetzner.cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) I found no Primary-IP issue in `hcloud-go` or `hcloud-python` establishing a separate, repeatable create→GET or create→list propagation delay.

There are, however, several concrete edge cases worth separating from that.

**Server creation can be visible before it is successfully allocated.** Hetzner describes server creation as two stages. A best-effort availability check first allocates an ID and makes the server visible; actual host allocation then happens asynchronously. That Action may subsequently fail, at which point the apparently created server disappears. This is a *visibility-before-commit* window, rather than a “new resource invisible to GET” window. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) The Go documentation accordingly tells users to wait on all returned create Actions before using the result and only then fetch the Server. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/hcloud.go?utm_source=chatgpt.com))

**The major Primary-IP/server race was delete→recreate.** Terraform issue #558 reported that deletion was reported complete to Terraform while the Primary IP still appeared attached internally; creating the replacement immediately produced `primary_ip_assigned`, while retrying a few seconds later worked. The maintainer identified the bug as the provider failing to wait for the server delete Action.  PR #590 fixed this by waiting until that Action completes. This is consistent with the API’s documented rule that action success is the consistency boundary, rather than evidence for a supported “sleep 5 seconds” workaround.

**Terraform’s own computed-state lag is distinct from API consistency.** Open issue #688 documents that after adding/removing a Primary IP through `hcloud_server.public_net`, the provider’s computed `ipv4_address`/`ipv6_address` may not reflect the change until a **second apply**. It remains pinned as a provider/plugin-framework issue. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/issues/688?utm_source=chatgpt.com)) That should not be interpreted as Hetzner promising an API propagation window of one Terraform run.

**Provider v1.62/1.63 had another assignment-state bug.** Issue #1439 showed that an unknown/computed `assignee_type` could make an unrelated Primary-IP update spuriously issue `Unassign`; because the server was running, the API correctly rejected that with `server_not_stopped`. A protection update performed before the bad unassign could already have landed, leaving Terraform state temporarily stale until refresh. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/issues/1439?utm_source=chatgpt.com)) The fix “do not update assignee on unknown assignee_type” shipped in **v1.65.0**; further validation around unknown assignee attributes landed in **v1.66.1**. Current provider release at the surveyed cutoff is v1.68.0. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/releases?utm_source=chatgpt.com))

## What each client does about the asynchronous model

**`hcloud-go`.** Primary-IP Create/Assign/Unassign expose the returned Action and leave the decision to wait to the caller; its package example explicitly says to “always await any returned actions” before using a result. Its HTTP layer does retry transient/network errors and `conflict`, but that is separate from waiting for an Action.  ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/hcloud.go?utm_source=chatgpt.com)) The library also exposes the relevant call-specific Primary-IP errors rather than hiding them. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/error.go?utm_source=chatgpt.com))

**`hcloud-python`.** Same broad model: mutating action methods return `BoundAction`; callers use `wait_until_finished()` when subsequent operations depend on completion. Its HTTP retry policy now essentially mirrors Go’s transient-error policy, including automatic `conflict` retry. ([Hetzner Cloud Python](https://hcloud-python.readthedocs.io/en/stable/api.clients.actions.html?utm_source=chatgpt.com)) One caveat as of the cutoff is the stale Primary-IP delete docstring noted above: it still describes the pre-May-2026 “delete implicitly unassigns” behavior, while the platform now requires explicit unassignment. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

**Terraform provider.** It does much more orchestration because Terraform expects resource operations to have settled when they return. Current helpers call Assign/Unassign and then `Action.WaitFor`; server public-network updates stop the server first and sequence unassign/delete/assign operations.  ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/blob/main/internal/server/resource.go?utm_source=chatgpt.com)) Historical fixes are instructive: #590 added the missing server-delete Action wait; v1.61 added explicit unassign-before-reassign and unassign-before-delete; v1.65 fixed the computed-`assignee_type` spurious unassign. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/releases?utm_source=chatgpt.com))

### Practical contract to build against

The safest interpretation of Hetzner’s published behavior is: **never use a fixed sleep as your correctness mechanism**. Preserve IP identity with `auto_delete=false`; treat server **replacement** differently from rebuild/live migration; power servers off before Primary-IP assignment changes; explicitly unassign before deletion or reassignment; and wait for every relevant Action to reach `success` before issuing dependent operations. A successful Action is the documented point at which Hetzner says the resource is consistent. There is no published deleted-address reuse interval or separate create→GET/list visibility SLA to build against. ([docs.hetzner.cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

---

If you want, I can:

- Explain how to handle Primary IP assignment race conditions
- Describe differences in handling Primary IPs during server rebuild vs replacement
- Summarize client library strategies for waiting on asynchronous Actions
