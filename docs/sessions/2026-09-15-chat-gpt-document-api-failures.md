# Document API Failures

Source: https://chatgpt.com/share/6aa9cd97-9378-83eb-a58c-dc6301390f40

---

## Turn 1: User

_2026-09-15T22:51:51.729Z_

Document Hetzner Cloud API failure behaviour: the error codes a server create, delete,
power and action-status call can return; rate limit headers and what happens at the limit;
how long an action may stay running; and what a client is told when a request is accepted
but the response is lost. Cite the official documentation.

---

## Turn 2: ChatGPT

_2026-09-15T22:52:14.489Z_

I’ll pull this from Hetzner’s official Cloud API documentation and separate endpoint-specific errors from cross-cutting behavior like rate limits, long-running actions, and retry/idempotency semantics.

---

## Turn 3: ChatGPT

_2026-09-15T22:52:25.683Z_

One important point from the current reference: Hetzner documents a global error-code vocabulary and marks these endpoints generically as “4xx user error / 5xx server error”; it does not appear to publish a per-endpoint exhaustive error-code matrix. I’m checking the action lifecycle and retry semantics separately so I don’t overstate what is guaranteed.

---

## Turn 4: ChatGPT

_2026-09-15T22:53:19.992Z_

The current API shape is also worth noting: for action status, Hetzner now prefers `GET /servers/actions/{action_id}`; the older `GET /servers/{id}/actions/{action_id}` route is deprecated (without a planned removal date).

---

## Turn 5: ChatGPT

_2026-09-15T22:53:49.575Z_

## Hetzner Cloud API failure behaviour

As of **15 September 2026**, Hetzner’s Cloud API uses asynchronous **Actions** for server mutations. The important distinction is between an **HTTP/API request failure** and an **Action that was successfully created but later fails**. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

### 1. Server create, delete, power, and action-status calls

The relevant calls are:

| Operation | Endpoint | Success |
|---|---|---:|
| Create server | `POST /servers` | `201` |
| Delete server | `DELETE /servers/{id}` | `200` |
| Power on/off | `POST /servers/{id}/actions/poweron` or `/poweroff` | `201` |
| Read action status | `GET /servers/actions/{action_id}` | `200` |

Create, delete, and power operations return an `action`; that action can initially have `status: "running"`. The status endpoint returns an Action whose status is one of `running`, `success`, or `error`. An Action with `status: "error"` is still a **successful HTTP `200` response** from the action-status call; the failure is represented inside `action.error`. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

For action status, use `GET /servers/actions/{action_id}` (or the global action lookup). Since **1 May 2026**, `GET /servers/{server_id}/actions/{action_id}` is deprecated, although Hetzner currently says there is no planned removal date. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

#### HTTP/API error codes

A subtle limitation of the official specification is that it **does not publish an exhaustive error-code subset for each individual endpoint**. These operations are specified as returning a successful response or generic `4xx`/`5xx` error responses, while the API-wide Errors section defines the machine-readable codes. Therefore a client should not assume, for example, that an error absent from an endpoint-specific example cannot occur. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

The documented API-wide set is:

| HTTP | `error.code` | Meaning |
|---:|---|---|
| 400 | `json_error` | Malformed JSON |
| 401 | `unauthorized` | Invalid/unknown token |
| 401 | `token_readonly` | Write attempted with read-only token |
| 403 | `forbidden` | Insufficient permission |
| 403 | `maintenance` | Operation unavailable because of maintenance |
| 403 | `resource_limit_exceeded` | Project/account resource limit exceeded |
| 404 | `not_found` | Entity not found |
| 405 | `method_not_allowed` | Wrong HTTP method |
| 409 | `uniqueness_error` | A required-unique field conflicts |
| 409 | `conflict` | Resource changed concurrently; Hetzner says to retry |
| 410 | `deprecated_api_endpoint` | Endpoint functionality was removed |
| 412 | `resource_unavailable` | Requested resource currently unavailable |
| 422 | `invalid_input` | Validation/processing error |
| 422 | `service_error` | Error in an underlying service |
| 422 | `unsupported_error` | Resource does not support the requested Action |
| 423 | `locked` | Resource is locked because another Action is running |
| 423 | `protected` | Requested Action is protected on the resource |
| 429 | `rate_limit_exceeded` | Too many requests |
| 500 | `server_error` | API-backend error |
| 502 | `bad_gateway` | Backend could not answer; retry |
| 503 | `unavailable` | Service/product unavailable |
| 504 | `timeout` | Request could not be answered in time; retry |

([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

Some are naturally more relevant to particular operations—for example, create can encounter resource limits/unavailability and mutations can encounter `locked` or `protected`—but Hetzner does **not** document those as exhaustive endpoint-specific mappings.

There is also a second failure namespace: `action.error.code`. The Action schema describes this as a machine-readable string and shows `action_failed` as an example, but does **not provide a complete enum of possible Action failure codes**. Thus client code should preserve unknown action error strings rather than switch exhaustively over `action_failed`. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

### 2. Rate limiting

Every request, authenticated or not, is rate limited. Hetzner documents these response headers:

- `RateLimit-Limit` — total requests available per hour.
- `RateLimit-Remaining` — requests currently remaining.
- `RateLimit-Reset` — Unix timestamp at which the allowance will have fully recovered.

The default is **3,600 requests per hour per Project**. It is effectively replenished gradually: at the default rate, one request becomes available every second. Burst traffic is permitted. When the limit is reached, further calls receive **HTTP `429 Too Many Requests` with `error.code = "rate_limit_exceeded"`**. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

`RateLimit-Reset` is specifically the time at which the **full** allowance will be restored; it should not be interpreted as necessarily meaning that no request can succeed before that instant, because tokens recover gradually. The reference does not document a `Retry-After` header for this API. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

Action polling counts as API requests, so Hetzner explicitly advises against polling Action state too frequently because it can exhaust the rate limit. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

### 3. How long may an Action remain `running`?

**Hetzner does not document a maximum Action runtime or an SLA after which a `running` Action must automatically become `success` or `error`.**

The contractual behaviour in the reference is simply that the client should wait for an Action until it reaches either `success` or `error`; while unfinished, its `finished` timestamp is null. Consequently, a client-side timeout should be treated as **the client's policy**, not evidence that Hetzner has failed or cancelled the Action. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

There is a separate **retention** rule: Hetzner's action endpoints return Actions from the past **90 days**. That controls how long historical Actions are queryable; it is not a 90-day maximum execution time. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

### 4. Request accepted, but its response is lost

This is the most important ambiguity for a robust client.

If Hetzner has accepted/executed a mutation but the TCP connection dies or the response is otherwise lost before the client receives it, **the client receives no Cloud-API error object telling it that the operation was accepted**. From the raw client's point of view it has a transport failure and cannot infer merely from that failure whether the server processed the request.

The Cloud API reference documents `504 / timeout` as “the request could not be answered in time, please retry”, and `502 / bad_gateway` similarly as retryable. But those are cases where an HTTP error response actually reaches the client; a completely lost response is necessarily different. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud))

Critically, the public Cloud API reference does **not document an `Idempotency-Key` (or equivalent request-deduplication token)** for these operations. Therefore it provides no documented exactly-once guarantee that would let a raw client blindly repeat a lost `POST /servers` and know it cannot create a second server.

Hetzner's own Go client illustrates the expected handling of transient failures: its documented retry policy retries network timeouts, HTTP `502`/`504`, and API errors including `conflict`, `rate_limit_exceeded`, `bad_gateway`, and `timeout`, with exponential backoff and up to five retries by default. That is **SDK retry behaviour, not a documented API deduplication guarantee**. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/hcloud.go))

For a fault-tolerant implementation, the practical consequence is:

> **“No response” means “outcome unknown”, not “operation failed.”**

For server creation in particular, reconcile observable state (for example, query by the intended unique server name) before issuing another create. For an Action whose ID was successfully received, poll that Action rather than reissuing the originating mutation. If the response containing the Action ID itself was lost, the Cloud API does not document a request token by which the original Action can be recovered.

[Hetzner Cloud API reference](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)  
[Hetzner Cloud API changelog](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com)
