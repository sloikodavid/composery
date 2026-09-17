# Hetzner Cloud Actions Behavior

Source: https://chatgpt.com/share/6aac0b42-ef94-83ed-afd6-e9d444e25d5a

---

## Turn 1: User

_2026-09-17T13:57:06.779Z_

As of September 2026, from Hetzner's documentation, changelog and the issue trackers of hcloud-go, the Terraform provider and CAPH, document how Hetzner Cloud actions behave in practice: how long `create_server`, `start_server`, `shutdown_server`, `poweroff_server`, `delete_server`, `assign_primary_ip` and `delete_primary_ip` actions typically and at worst stay `running`; whether an action can end `error` after the resource change was applied; which resources are `locked` while an action runs and what a second request returns during that time; whether `shutdown` is guaranteed to reach `off` and what clients do when a guest ignores ACPI; and any documented case where a server's `status` and its most recent action disagree. Report measured timings from issues or blog posts where they exist, with dates.

---

## Turn 2: ChatGPT

_2026-09-17T13:57:09.080Z_

I’ll triangulate the official Cloud API docs/changelog with concrete issue reports from hcloud-go, the Terraform provider, and CAPH, and separate documented guarantees from observed timings. I’ll also flag where the evidence is only anecdotal or version-specific.

---

## Turn 3: ChatGPT

_2026-09-17T13:58:39.065Z_

The official API contract gives one important baseline: there is **no published per-action duration/SLA**. Actions are asynchronous, should be waited to `success` or `error`, and `success` is intended to mean the targeted resources are again consistent; a concurrent access to an item already involved in an action is documented as HTTP **423 `locked`**.

---

## Turn 4: ChatGPT

_2026-09-17T14:00:06.844Z_

A CAPH issue supplies a concrete example of the distinction: on 22 March 2024 it noted “many examples” where its **2-minute wait for the *server status*** expired and deletion proceeded anyway. In a reproduction posted to that issue, the API’s `shutdown_server` action itself finished in about **700 ms**—while the VM kept answering pings—because the shutdown action only records delivery of the ACPI request, not completion of guest shutdown.

---

## Turn 5: ChatGPT

_2026-09-17T14:10:04.889Z_

As of **17 September 2026**, the main thing to keep straight is that Hetzner has two different notions of completion:

**Action completion** is the control-plane operation reaching `success`/`error`; **resource-state completion** is the server/IP actually reaching the state your workflow cares about. Hetzner’s generic contract says Actions are asynchronous, should be waited to `success` or `error`, and are marked successful once their asynchronous work has completed and targeted resources are consistent. It publishes **no per-command SLA or maximum `running` time**. A conflicting access to an item already occupied by an Action can return **HTTP 423, code `locked`**. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/hetzner))

### What the timings actually look like

| Action | Observed/expected `running` time | Longest public evidence / practical bound |
|---|---|---|
| **`create_server`** | Rapid Deploy/system images can be very quick: a **19 June 2023** CLI example showed **5.8 s** for the create progress bar before the CLI separately waited for the server to start; the **March 2024** CAPH reproduction showed **4.7 s** for Ubuntu 22.04 creation. Current CAPH code comments that HCloud system-image provisioning is roughly **11 s**, versus roughly **140 s** from a snapshot. ([Will Schenk](https://willschenk.com/labnotes/2023/controlling_hetzner_with_cli/))   | There is no API maximum. Hetzner’s Ansible module says creation is normally **60–90 s on average**, but can exceed **10 min** for custom images, and allows ≈30 min. A **4 Feb 2021** Terraform issue reported 20–30 GB snapshots taking **40–60 min**, continuing after Terraform’s then-20-minute context timed out. Current Terraform gives server creation a **90-minute** timeout. ([Fossies](https://fossies.org/linux/misc/ansible-11.6.0.tar.gz/ansible-11.6.0/ansible_collections/hetzner/hcloud/plugins/modules/server.py))  |
| **`start_server`** (`poweron` endpoint) | I found **no clean published measurement of the Action itself** in these trackers. Ansible explicitly says create `next_actions`, including starting a server, can take “a few minutes” depending on project activity. The guest becoming operational is a different clock: CAPH’s July 2026 analysis describes an old path taking roughly **90–120 s** for Ubuntu to reach `Running`, plus up to 10 s polling delay. ([Fossies](https://fossies.org/linux/misc/ansible-11.6.0.tar.gz/ansible-11.6.0/ansible_collections/hetzner/hcloud/plugins/modules/server.py))  | No API maximum. CAPH deliberately does **not** need to wait for the power-on Action in its new rescue flow; the following state observes the actual boot instead. |
| **`shutdown_server`** | A March 2024 CAPH test measured the Action at about **700 ms**. That is entirely compatible with the server remaining up, because this action means “ACPI shutdown request delivered,” not “guest is off.”  | No useful bound on time-to-`off`: if the guest ignores ACPI, it may **never reach `off`**. The Action itself can already be `success`. Hetzner explicitly says to use `poweroff` when actual `off` must be ensured.  |
| **`poweroff_server`** | A **8 Dec 2022** real CLI run measured **4.9 s** until “Server stopped.” This is a hard power cut, not graceful guest shutdown. ([Major Hayden](https://major.io/p/fedora-37-hetzner/)) | No published maximum/SLA. Clients normally wait for the Action or their own context/timeout. |
| **`delete_server`** | No trustworthy isolated “typical Action duration” measurement surfaced. Deletion has asynchronous cleanup such as detaching Primary IPs; this is why hcloud-go was changed to expose the delete Action.  | A **18 Aug 2022** Terraform bug is illuminating: Terraform reported server destruction complete after **0 s**, immediately tried to recreate it, and Hetzner still considered its Primary IP assigned; retrying a few seconds later worked. That was the old client failing to await deletion’s background work, not proof that the Action itself was 0 s. Current Terraform calls `DeleteWithResult` and waits for its Action.  ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/blob/main/internal/server/resource.go)) |
| **`assign_primary_ip`** | I found **no measured duration** in the requested issue trackers. Current Terraform waits for this Action. The server must already be `off`.  ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud)) | No published maximum. The API Action schema associates the Action with **both a server and a Primary IP**. ([UNPKG](https://app.unpkg.com/openapi-directory%401.3.9/files/api/hetzner.cloud.json?utm_source=chatgpt.com)) |
| **`delete_primary_ip`** | **N/A: there is no `delete_primary_ip` Action in the September 2026 API/client.** `DELETE /primary_ips/{id}` is a direct DELETE; hcloud-go returns response/error, not an Action, and Terraform does not invoke the Action waiter.   | Therefore there is no `running` duration. Since **1 May 2026**, deletion of an assigned Primary IP is rejected with `must_be_unassigned`; it must first be unassigned. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog)) |

A useful qualification on the `create_server` numbers: **4.7–5.8 s is not inconsistent with 60–90 s or minutes-long cases**. The CLI output separates the create Action’s progress from subsequent server-start waiting, image type matters enormously, and snapshots/custom images trigger materially more backend work. The strongest documented pathological case remains the 2021 Terraform report of **40–60-minute** snapshot creation. ([Will Schenk](https://willschenk.com/labnotes/2023/controlling_hetzner_with_cli/)) 

### Locks and what a second request sees

The API-level rule is straightforward: **HTTP 423 / `locked` means the item is locked because there is already an Action running**. That should be understood primarily as protection against conflicting operations; the documentation does not say that every read of a locked object must fail. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/hetzner))

For server Actions (`create_server`, `start_server`, `shutdown_server`, `poweroff_server`, and `delete_server` while the server remains addressable), the server is the relevant Action resource. CAPH gives concrete current behavior after creation: `enable_rescue` or `poweron` can be rejected with `locked` while the fresh server is still busy, so CAPH treats 423 as transient and retries after **5 seconds**. Its July 2026 PoC created **ten servers concurrently** and happened not to encounter a single lock; it also observed the create Action finishing at the same time that the server became `off` and unlocked. 

`assign_primary_ip` is slightly more interesting. The Action's `resources[]` contains both a **server** and a **Primary IP**, and the server must be stopped before assignment. ([UNPKG](https://app.unpkg.com/openapi-directory%401.3.9/files/api/hetzner.cloud.json?utm_source=chatgpt.com)) The May 2026 changelog specifically tells clients to use `action.resources[]` to determine which resources an Action belongs to. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog)) I did **not** find a documented trace proving that every conflicting Primary-IP-only mutation during assignment necessarily returns 423, so I would not turn the resources list into a stronger lock guarantee than Hetzner documents.

`delete_primary_ip`, again, has no Action of its own. A DELETE can certainly fail because another operation has the object locked, but there is no post-DELETE "`delete_primary_ip` is running" phase for a client to monitor.

### Can an Action report `error` even though the mutation happened?

**Yes, there is historical evidence that you cannot safely equate `error` with “nothing changed.”** A Terraform-provider issue opened **20 September 2021** reported server creation failing with:

`action … failed: server is locked (unknown_error)`

while the newly created VPS was nevertheless visible in the Hetzner console. A rerun could then succeed. The provider maintainer considered it a backend/support issue rather than a Terraform bug.  

That is best treated as historical/backend-bug evidence, not the intended contract. Hetzner's contract says a **successful** Action means the asynchronous tasks completed consistently; it does not state that an **errored** Action transactionally rolls back every side effect. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/hetzner)) Consequently, robust reconciliation should re-read the resource after an Action error before assuming that retrying the mutation is safe.

There is also a very recent, slightly different example at the client-workflow level. In Terraform provider **1.63.0**, reported **2 June 2026**, a Primary IP update successfully applied `delete_protection` and then a spurious subsequent Unassign failed with `server_not_stopped`; Terraform therefore reported the overall resource update failed even though the first cloud-side change had landed. That is not one Action partially succeeding, but it demonstrates why “provider operation failed” likewise does not imply zero side effects.

### `shutdown_server` is deliberately not a state-transition guarantee

This is the most important exception to the generic “success means consistency” wording. Hetzner documents `shutdown` specially: it sends an **ACPI shutdown request**. The guest OS must support and honor ACPI; the Action status reflects **sending the request**, not whether the operating system actually powered down. If you require the server to be `off`, Hetzner says to use `poweroff`. 

That distinction is visible in the March 2024 CAPH experiment: `hcloud server shutdown` reached 100% in **700 ms**, yet the server continued replying to ICMP packets afterwards. The CAPH issue had been opened on **22 March 2024** specifically because there were “many examples” where its **2-minute** wait for server status to become `off` expired and it proceeded with deletion.  

The clients therefore behave differently:

- **hcloud-go itself does not escalate.** It exposes `Shutdown`, `Poweroff`, and the generic Action waiter. `WaitFor` waits for terminal Action state until the caller's context expires; deciding to verify `server.status` or force power-off belongs to the caller. 
- **Terraform `shutdown_before_deletion=true`** first waits for the shutdown Action, then independently polls the server until it reports `off`. Current code makes five retries using exponential backoff based at one second; if the guest still has not shut down, Terraform emits a warning and **deletes it anyway**, rather than issuing `poweroff`. The current issue tracker still has an open request, filed **29 January 2026**, to make this graceful-shutdown wait configurable. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/blob/main/internal/server/resource.go))  
- **CAPH** likewise separates request delivery from observed server status. The 2024 implementation allowed two minutes before deleting anyway; current reconciliation remains status-driven rather than assuming a successful ACPI Action proves the guest is off. Its current code retries the shutdown/reconciliation path rather than treating the immediate API result as final. 

### A documented server-status / latest-Action disagreement

There is a **normal, explicitly documented** disagreement:

> `shutdown_server` Action = `success`; server `status` = still `running`.

That is not eventual-consistency noise or necessarily a bug—it is the defined semantics of `shutdown`. The CAPH reproduction is a measured instance of exactly that state: the action finished in about **700 ms**, while the VM was still live.  

There is also a historical abnormal disagreement: in Terraform issue #469 the create-related Action was reported as **failed**, while the server had in fact been created and was visible. 

So, for an orchestrator, the safe practical model in September 2026 is: **wait for the Action, but do not use the Action as a substitute for checking the resource state when the state itself matters**. In particular, after `shutdown_server`, check `server.status`; after an `error`, re-GET before retrying; after 423 `locked`, wait/retry rather than starting another mutation; and after server deletion, wait for the delete Action before attempting to reuse externally managed Primary IPs. The API provides no finite backend “worst case” for these Actions, so caller timeouts such as Terraform's 90-minute create timeout or CAPH's six-minute provisioning-state guards are **client policy, not Hetzner SLAs**. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/hetzner)) 

---

If you want, I can:

- Explain implications of Hetzner action time variability for automation tooling
- Describe how to reliably detect 'off' state after shutdown in Hetzner Cloud
- Clarify resource locking behavior during Hetzner Cloud actions and client retry strategies
