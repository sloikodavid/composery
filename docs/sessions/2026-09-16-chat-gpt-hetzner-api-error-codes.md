# Hetzner API Error Codes

Source: https://chatgpt.com/share/6aab2c02-c1a8-83eb-b5a7-9457187ff968

---

## Turn 1: User

_2026-09-16T22:55:35.361Z_

As of September 2026, from Hetzner's own documentation and API specification, list every error code the Hetzner Cloud

API returns, with its HTTP status. For each, report what Hetzner says it means and whether retrying the same request

unchanged can succeed. Specifically distinguish codes that mean the request is invalid forever, codes that mean an

outside condition must change (quota, limits, locked resources, a server being in the wrong state), codes that mean a

transient failure, and codes where the request may or may not have taken effect. Include any codes documented as

eventually consistent or as returned during maintenance. Where Hetzner's documentation is silent or ambiguous about

retryability, say so rather than inferring.

---

## Turn 2: ChatGPT

_2026-09-16T22:55:35.161Z_

I’ll reconcile Hetzner’s Cloud API docs with its published API specification, then separate documented retry semantics from any places where Hetzner is silent. I’ll treat “retry unchanged” narrowly: same method, URL, headers/body, and relevant resource state.

---

## Turn 3: ChatGPT

_2026-09-16T22:55:44.383Z_

The top-level docs list 22 generic codes, but that is not the whole API surface: individual operations document additional call-specific codes. I’m enumerating those operation-level codes separately so the final table does not silently omit them.

---

## Turn 4: ChatGPT

_2026-09-16T22:56:41.307Z_

One important limitation in Hetzner’s own OpenAPI is now clear: many operation-specific errors are documented only under a generic `4xx` response, without pinning them to a single numeric status. I’ll preserve that ambiguity rather than assigning `422` just because that is common in practice.

---

## Turn 5: ChatGPT

_2026-09-16T23:02:18.020Z_

As of **16 September 2026**, the current official Hetzner Cloud OpenAPI document identifies itself as the **Hetzner Cloud API**, version 1.0.0, served at `api.hetzner.cloud/v1`; I also checked Hetzner’s changelog through its 15 September 2026 entry. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json))

Under the spec’s **Error Codes** and **Operation specific errors** tables, I find **69 distinct documented error-code strings**: 22 generic codes and 47 operation-specific ones. Sixty-one have at least one documented HTTP status. The remaining eight are certificate-retry errors for which Hetzner has literally left the HTTP-status column blank. Separately, the Action schema uses `action_failed` as an example `action.error.code`; it is not enumerated as an HTTP error code and has no HTTP-status mapping. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json))

I use four retry classes below. **INVALID** means the unchanged request is not documented as capable of succeeding under the same request/resource pairing; something in the request, credentials, endpoint, or selected resource must change. **CONDITION** means the request bytes can in principle stay the same, but some outside state—quota, lock, capacity, resource state, DNS, etc.—must change first. **TRANSIENT** is reserved for cases where Hetzner actually tells the caller to retry, or explicitly documents recovery of the limiting condition. **UNKNOWN** means Hetzner does not say enough to classify it safely.

### Generic API error codes

These 22 come directly from Hetzner's global error-code table. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json))

| HTTP | Code | Hetzner says it means | Class | Can the identical request later succeed? |
|---:|---|---|---|---|
| 400 | `json_error` | Invalid JSON input. | **INVALID** | **No**; the body has to be corrected. |
| 401 | `unauthorized` | Token is invalid or unknown. | **INVALID** | **No** with the same invalid credentials. |
| 401 | `token_readonly` | Token permits only GET requests. | **INVALID** | **No** for the same non-GET operation; token/method must change. |
| 403 | `forbidden` | Insufficient permission. | **CONDITION** | Only if the authorization/permission context changes. Hetzner gives no retry guidance. |
| 403 | `maintenance` | Operation cannot be performed because of maintenance. | **CONDITION** | It can potentially work once maintenance is over, but Hetzner documents no retry interval or guarantee. |
| 403 | `resource_limit_exceeded` | Account has exceeded the maximum quantity of a resource. | **CONDITION** | Only after quota/resource usage changes. |
| 404 | `not_found` | Entity not found. | **UNKNOWN** | Hetzner says nothing about whether the entity might subsequently become visible/exist. |
| 405 | `method_not_allowed` | HTTP method is not allowed. | **INVALID** | **No**; method/endpoint must change. |
| 409 | `uniqueness_error` | A field that must be unique collides. | **CONDITION** | Only after the conflicting object/value changes, or the request changes. |
| 409 | `conflict` | Resource changed during the request. | **TRANSIENT** | **Yes. Hetzner explicitly says to retry.** It does not document what, if anything, the first attempt changed. |
| 410 | `deprecated_api_endpoint` | Endpoint functionality has been removed. | **INVALID** | **No**; another endpoint/API must be used. |
| 412 | `resource_unavailable` | Requested resource is currently unavailable, e.g. unavailable to order. | **CONDITION** | Potentially after availability changes; no retry promise or timing is documented. |
| 422 | `invalid_input` | Error parsing or processing the input. | **INVALID** | **No**; the input needs to change. |
| 422 | `service_error` | Error within a service. | **UNKNOWN** | Retryability **and** effect of the failed call are undocumented. |
| 422 | `unsupported_error` | Resource does not support the requested Action. | **INVALID** | **No** for that documented resource/action pairing. |
| 423 | `locked` | Item is locked because another Action is already running. | **CONDITION** | It may succeed after that Action ceases to hold the lock; no retry timing is stated. |
| 423 | `protected` | Requested Action is protected on this resource. | **CONDITION** | Protection/state must change first. |
| 429 | `rate_limit_exceeded` | Too many requests. | **TRANSIENT** | **Yes, after rate capacity recovers.** Hetzner supplies `RateLimit-Reset`, and says remaining capacity replenishes gradually. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json)) |
| 500 | `server_error` | Error within the API backend. | **UNKNOWN** | Hetzner does **not** say to retry and does not state whether a mutation took effect. |
| 502 | `bad_gateway` | API backend could not answer the request. | **TRANSIENT** | **Yes; Hetzner explicitly says to retry.** Whether the original request took effect is not documented. |
| 503 / 412¹ | `unavailable` | A service/product is currently unavailable. | **CONDITION** | It may succeed after availability changes; Hetzner gives no general retry guarantee. |
| 504 | `timeout` | Request could not be answered in time. | **TRANSIENT** | **Yes; Hetzner explicitly says to retry.** Whether the original request took effect is not documented. |

¹ The generic table assigns `unavailable` to **503**, but Hetzner changed `POST /v1/primary_ips` and `POST /v1/floating_ips` so that lack of an IP with the requested properties returns **412** while retaining the same `unavailable` error code. That change has applied since 1 July 2025. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

### Operation-specific codes with an HTTP status

Hetzner's current OpenAPI adds the following call-specific codes. The Firewalls, Load Balancer, Primary/Floating IP, Server, Volume, and DNS/Zone tables explicitly supply the statuses below. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json))

| HTTP | Code | Hetzner says it means | Class | Identical-request retry |
|---:|---|---|---|---|
| 422 | `server_already_added` | Same Server was applied more than once while creating a Firewall. | **INVALID** | No; duplicate entry must be removed. |
| 422 | `incompatible_network_type` | Resource network type is unsupported by Firewalls. | **INVALID** | Not for the same resource/configuration. |
| 404 / 422 | `firewall_resource_not_found` | Resource to attach/apply/remove the Firewall to/from was not found. | **UNKNOWN** | Retry semantics are not stated. It is 422 during Firewall creation, 404 for apply/remove operations. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json)) |
| 422 | `resource_in_use` | Firewall is still applied to a resource. | **CONDITION** | Only after it is no longer applied. |
| 422 | `firewall_already_applied` | Firewall is already applied to that resource. | **CONDITION** | Desired state already exists; repeating remains invalid unless state changes. |
| 422 | `private_net_only_server` | Server has no public interface. | **CONDITION** | Server/interface state must change. |
| 422 | `firewall_managed_by_label_selector` | Firewall was applied through a label selector and cannot be manually removed. | **CONDITION** | Label-selector/application state or operation must change. |
| 422 | `must_be_unassigned` | Primary/Floating IP is still assigned to a resource. | **CONDITION** | **Yes after it is unassigned.** This behavior has applied since 1 May 2026. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json)) |
| 422 | `floating_ip_assigned` | Floating IP is already assigned. | **CONDITION** | Assignment state must change. |
| 412 / 422 | `source_port_already_used` | Load Balancer source/listen port is already in use. | **CONDITION** | Port/service state or request must change. It is 412 on LB creation/add-service and 422 on update-service. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json)) |
| 422 | `ip_not_owned` | Target IP is not owned by the Project owner. | **INVALID** | Not for the documented IP/project combination. |
| 422 | `load_balancer_not_attached_to_network` | Load Balancer is not attached to a network. | **CONDITION** | Yes only after network attachment. |
| 422 | `resolve_cloud_private_targets_error` | Target Server is not attached to the same network as the Load Balancer. | **CONDITION** | Network topology must change. |
| 422 | `resolve_cloud_public_targets_error` | Server being added as a public target has no public IPv4. | **CONDITION** | Server/public-IP state must change. |
| 422 | `target_already_defined` | Load Balancer target is already defined. | **CONDITION** | Target state/request must change. |
| 422 | `ip_not_in_vswitch_subnet` | IP does not belong to the vSwitch subnet of the attached network. | **CONDITION** | IP/subnet topology must change. |
| 422 | `ip_not_assigned_to_server` | IP is neither the Server's Primary IPv4 nor within its IPv6 subnet. | **CONDITION** | IP assignment/state must change. |
| 422 | `load_balancer_public_interface_disabled` | Load Balancer's public interface is disabled. | **CONDITION** | Public-interface/target configuration must change. |
| 422 | `network_has_no_vswitch_subnet` | Private IP supplied but attached network has no vSwitch subnet. | **CONDITION** | Network/subnet state must change. |
| 422 | `load_balancer_already_attached` | Load Balancer is already attached to a network. | **CONDITION** | Attachment state/request must change. |
| 422 | `ip_not_available` | Requested Network IP is unavailable. | **CONDITION** | It may work if availability changes; no retry interval/guarantee is stated. |
| 422 | `no_subnet_available` | No suitable subnet or IP is available in the network. | **CONDITION** | Capacity/configuration must change; no retry guarantee. |
| 422 | `invalid_load_balancer_type` | Requested LB type does not fit that Load Balancer. | **INVALID** | Type/request has to change. |
| 422 | `targets_without_use_private_ip` | LB has targets using public rather than private IPs. | **CONDITION** | Target configuration must change. |
| 422 | `server_not_stopped` | Server is running while operation requires it powered off. | **CONDITION** | **Yes after stopping the Server.** |
| 422 | `server_has_ipv4` | Server already has an IPv4 address. | **CONDITION** | IPv4 assignment state must change. |
| 422 | `server_has_ipv6` | Server already has an IPv6 address. | **CONDITION** | IPv6 assignment state must change. |
| 422 | `primary_ip_already_assigned` | Primary IP is assigned to a different Server. | **CONDITION** | Assignment must change. |
| 422 | `server_is_load_balancer_target` | Server IPv4 is currently a Load Balancer target. | **CONDITION** | Target state must change. |
| 412 | `primary_ip_version_mismatch` | Selected Primary IP has the wrong IP version. | **INVALID** | Primary IP/request must change. |
| 422 | `placement_error` | An error occurred during Server placement. | **UNKNOWN** | Hetzner provides neither a cause nor retry instructions. |
| 422 | `primary_ip_assigned` | Primary IP specified when creating a Server is already assigned. | **CONDITION** | Assignment state must change. |
| 422 | `primary_ip_datacenter_mismatch` | Specified Primary IP is in a different location. | **INVALID** | Selected IP/location combination must change. |
| 422 | `already_in_placement_group` | Server is already in a Placement Group. | **CONDITION** | Placement-group state/request must change. |
| 422 | `server_already_attached` | Server is already attached to the Network. | **CONDITION** | Attachment state/request must change. |
| 422 | `networks_overlap` | Network's IP range overlaps one of the Server's networks. | **CONDITION** | Network topology/configuration must change. |
| 422 | `invalid_server_type` | Server type does not fit the Server or is deprecated. | **INVALID** | Requested type must change. |
| 422 | `no_space_left_in_location` | No Volume space remains in that location. | **CONDITION** | It could work after capacity changes, but Hetzner supplies no retry promise/timing. |
| 422 | `incorrect_zone_mode` | Operation is unsupported for that Zone's mode. | **INVALID** | Not for that existing Zone/mode. Hetzner specifically says Zone mode **cannot be changed**; the Zone must be deleted and recreated. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json)) |

The Load Balancer target errors in particular are documented together as 422s; this includes `ip_not_in_vswitch_subnet`, `ip_not_owned`, `ip_not_assigned_to_server`, `load_balancer_public_interface_disabled`, `load_balancer_not_attached_to_network`, `network_has_no_vswitch_subnet`, both `resolve_cloud_*` errors, and `target_already_defined`. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json))

### Certificate retry codes: Hetzner supplies **no HTTP status**

This is an important specification edge case. For `POST /certificates/{id}/actions/retry`, Hetzner has an “Operation specific errors” table, but the **Status cell is blank for all eight entries**. The endpoint normally returns a 201 Action and tells clients to wait for that Action; the spec does not tell us whether these codes are HTTP-response errors, Action errors, or simply missing status annotations. Therefore assigning them 4xx/422 would be an inference. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json))

| HTTP | Code | Hetzner's meaning | Class / unchanged retry |
|---:|---|---|---|
| **Not specified** | `caa_record_does_not_allow_ca` | CAA record does not allow the certificate authority. | **CONDITION** — CAA/DNS condition must change; Hetzner gives no retry timing or guarantee. |
| **Not specified** | `ca_dns_validation_failed` | CA DNS validation failed. | **CONDITION** — validation/DNS condition must change; retry behavior otherwise unspecified. |
| **Not specified** | `ca_too_many_authorizations_failed_recently` | Too many CA authorizations have failed recently. | **CONDITION** — CA-side condition/window must change; Hetzner does not document the window. |
| **Not specified** | `ca_too_many_certificates_issued_for_registered_domain` | CA says too many certificates were issued for the registered domain. | **CONDITION** — CA-side issuance condition must change; timing unspecified. |
| **Not specified** | `ca_too_many_duplicate_certificates` | CA says too many duplicate certificates were issued. | **CONDITION** — CA-side condition must change; timing unspecified. |
| **Not specified** | `could_not_verify_domain_delegated_to_zone` | Domain delegation to the Zone could not be verified. | **CONDITION** — DNS delegation must change/become verifiable. |
| **Not specified** | `dns_zone_not_found` | DNS Zone not found. | **CONDITION** — DNS/Zone state must change; retry guarantee unspecified. |
| **Not specified** | `dns_zone_is_secondary_zone` | DNS Zone is a secondary Zone. | **CONDITION** — Zone configuration/resource must change. Hetzner documents elsewhere that Zone mode itself cannot be changed. |

### The two retry subtleties that matter most

First, **Hetzner does not document a general idempotency mechanism** in this API specification; the spec contains no idempotency-key discussion. Nor does it identify any HTTP error as formally meaning “the mutation may or may not have committed.” ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json))

Consequently, the strongest statement possible for `409 conflict`, `502 bad_gateway`, and `504 timeout` is: **Hetzner explicitly says to retry, but does not state whether the first mutating request had any effect before the error was returned.** For `500 server_error` and `422 service_error`, it does not even explicitly recommend a retry. An implementation should therefore not turn Hetzner's “please retry” into an undocumented guarantee of non-execution.

Second, Actions matter. Hetzner says mutations may return a `running` Action, clients should wait until it reaches `success` or `error`, and an Action is only marked successful after asynchronous work has completed and the targeted resources are in a **consistent state**. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json)) This is stronger than assuming that the initial 201 response means the requested state is already observable.

There is also one explicitly documented delayed-consistency case: Firewall resources matching or ceasing to match a **label selector can take up to a few seconds to be processed**, and a Firewall is considered applied only after the corresponding `apply_firewall` Action successfully completes. ([Hetzner Cloud](https://docs.hetzner.cloud/cloud.spec.json)) Hetzner does **not** attach a special “eventual consistency” error code to that delay, so I would not map a particular 404/422 to eventual consistency unless Hetzner documents that connection.

Finally, older code lists can be misleading. Hetzner explicitly says `firewall_already_removed` is **no longer in use**, and it is absent from the September 2026 OpenAPI. Likewise, `robot_unavailable`, `resource_locked`, and `unknown_error` do not occur in the current Cloud API specification, so I have not treated them as current documented Cloud API error codes. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))
