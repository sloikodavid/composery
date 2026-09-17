# Compare Retry Policies

Source: https://chatgpt.com/share/6aac0b36-900c-83ed-91d6-9bc76534670f

---

## Turn 1: User

_2026-09-17T13:56:54.141Z_

As of September 2026, for hcloud-go, hcloud-python, the Hetzner Terraform provider, CAPH and hcloud-cloud-controller-manager, report from their source code exactly how each one treats these Hetzner Cloud API error codes: `conflict`, `locked`, `protected`, `rate_limit_exceeded`, `resource_limit_exceeded`, `forbidden`, `maintenance`, `unavailable`, `resource_unavailable`, `server_error`, `service_error`, `placement_error`, `timeout`, `bad_gateway`, `not_found`, `uniqueness_error`, `invalid_input`, and a transport failure after the request was sent. For each code and each client: whether it retries, with what schedule and cap, whether it treats the outcome of a create as unknown, and whether the answer differs between a read, a create, a delete and a server action. Quote the relevant code with file paths and commit or tag. Where clients disagree with each other or with Hetzner's own documentation, say so, and include any issue where a classification was changed and why.

---

## Turn 2: ChatGPT

_2026-09-17T13:56:55.742Z_

I’ll trace each client from its retry/error-classification code outward to operation-specific call sites (read/create/delete/actions), pin the result to current September 2026 tags or commits, then cross-check Hetzner’s API docs and any classification-change issues. I’ll distinguish API responses from ambiguous post-send transport failures, because that is where “create outcome unknown” usually diverges most.

---

## Turn 3: ChatGPT

_2026-09-17T13:57:43.535Z_

I’ve pinned the comparison to the latest stable releases available by 17 September 2026: hcloud-go v2.48.0, hcloud-python v2.25.1, Terraform provider v1.69.0, CAPH v1.1.8, and hcloud-cloud-controller-manager v1.37.0. I’m now separating “library-level automatic retry” from higher-level controller/provider reconciliation retries, since counting both as the same thing would be misleading.

---

## Turn 4: ChatGPT

_2026-09-17T14:03:50.263Z_

One important divergence is already clear: CAPH v1.1.8 is pinned to **hcloud-go v2.32.0**, whose request retry classifier predates `bad_gateway`/`timeout` application-code retries. So a JSON API error `bad_gateway` or `timeout` is treated differently by CAPH than by the current Go/Python SDKs, Terraform v1.69.0, and CCM v1.37.0—even though a bare HTTP 502/504 is retried.

---

## Turn 5: ChatGPT

_2026-09-17T14:12:20.603Z_

As of **17 September 2026**, the important distinction is between **retrying the HTTP request itself** and **retrying/reconciling the higher-level operation**. The five projects do not use one common notion of “retryable Hetzner error.”

I pinned this to **hcloud-go v2.48.0**, **hcloud-python v2.25.1**, **terraform-provider-hcloud v1.69.0**, **CAPH v1.1.8**, and **hcloud-cloud-controller-manager v1.37.0**. Terraform v1.69.0 embeds hcloud-go v2.48.0; CAPH v1.1.8 embeds the much older hcloud-go v2.32.0; CCM v1.37.0 embeds v2.47.0.   

### The common retry schedule

For current hcloud-go, and therefore Terraform and CCM, a request classified retryable gets **up to five retries after the original request: six attempts total**. The default backoff is base 1 s, multiplier 2, cap 60 s, with jitter. The implementation computes `min(60s, 1s*2^n)` and, with jitter, chooses uniformly between 1 s and that value. With the default five retries the actual waits are therefore **1 s; 1–2 s; 1–4 s; 1–8 s; 1–16 s**; the 60-second cap is not reached unless the retry count is increased.  

hcloud-python independently implements the same defaults: five retries, `base=1`, multiplier 2, cap 60, jitter, and the same practical schedule.  

CAPH's bundled hcloud-go v2.32.0 has the same backoff and five-retry limit, but a **different classification set**. 

I use **R5** below for that six-attempt/default-jitter behavior and **—** for no automatic request-level retry.

### Exact API-code classification

| Hetzner error | hcloud-go 2.48 | hcloud-python 2.25.1 | Terraform 1.69 | CAPH 1.1.8 | CCM 1.37 |
|---|---:|---:|---:|---:|---:|
| `conflict` | **R5** | **R5** | **R5** | **R5** | **R5** |
| `locked` | — | — | —¹ | —² | —³ |
| `protected` | — | — | — | — | — |
| `rate_limit_exceeded` | **R5** | **R5** | **R5** | **R5** | **R5** |
| `resource_limit_exceeded` | — | — | — | — | — |
| `forbidden` | — | — | — | — | — |
| `maintenance` | — | — | — | — | — |
| `unavailable` | — | — | — | — | — |
| `resource_unavailable` | — | — | — | **—; create is terminal** | — |
| `server_error` | — | — | — | — | — |
| `service_error` | — | — | —¹ | — | — |
| `placement_error` | — | — | — | — | — |
| `timeout` | **R5** | **R5** | **R5** | **— for JSON API code**⁴ | **R5** |
| `bad_gateway` | **R5** | **R5** | **R5** | **— for JSON API code**⁴ | **R5** |
| `not_found` | — | — | — | — | — |
| `uniqueness_error` | — | — | — | **—; special create recovery** | — |
| `invalid_input` | — | — | — | **—; create is terminal** | — |
| post-send **timeout** transport error | **R5** | **R5** | **R5** | **R5** | **R5** |
| post-send **non-timeout** transport error, e.g. EOF/reset | — | — | — | — | — |

¹ Terraform adds its own higher-level retries around a subset of operations, notably server network attachment/detachment: `conflict`, `locked`, and `service_error` are retried there.

² CAPH may requeue/reconcile particular server workflows, but this is not an hcloud request retry. Its create-specific rules are described below.

³ CCM can convert particular errors to Kubernetes reconciliation errors; again, it does not cause the hcloud SDK to replay that request.

⁴ CAPH's hcloud-go v2.32.0 predates application-code retries for `timeout` and `bad_gateway`. **A bare/unparseable HTTP 504 or 502 is nevertheless retried.** The distinction is whether hcloud-go parsed a Hetzner JSON error code.

The exhaustive current Go classifier is quite small:

`hcloud/client_handler_retry.go`, hcloud-go **v2.48.0**:
```go
case errors.As(err, &apiErr):
    switch apiErr.Code {
    case ErrorCodeConflict:
        return true
    case ErrorCodeRateLimitExceeded:
        return true
    case ErrorCodeBadGateway:
        return true
    case ErrorCodeTimeout:
        return true
    }
case errors.Is(err, ErrStatusCode):
    switch resp.Response.StatusCode {
    case http.StatusBadGateway, http.StatusGatewayTimeout:
        return true
    }
case errors.As(err, &netErr):
    if netErr.Timeout() {
        return true
    }
```


Python is deliberately parallel:

`hcloud/_client.py`, hcloud-python **v2.25.1**:
```python
if isinstance(exception.code, str):
    return exception.code in (
        "rate_limit_exceeded",
        "conflict",
        "bad_gateway",
        "timeout",
    )

if isinstance(exception.code, int):
    return exception.code in (
        HTTPStatus.BAD_GATEWAY,
        HTTPStatus.GATEWAY_TIMEOUT,
    )
```

Only `requests.exceptions.Timeout` receives the network-error retry treatment; ordinary `ConnectionError`, EOF, reset, etc. are not caught by that retry branch. 

By contrast, CAPH's bundled **v2.32.0** classifier contains only `conflict` and `rate_limit_exceeded` among parsed application errors:

```go
case errors.As(err, &apiErr):
    switch apiErr.Code {
    case ErrorCodeConflict:
        return true
    case ErrorCodeRateLimitExceeded:
        return true
    }
...
case errors.Is(err, ErrStatusCode):
    switch resp.Response.StatusCode {
    case http.StatusBadGateway, http.StatusGatewayTimeout:
        return true
    }
```


That seemingly small version pin has a real semantic consequence: a response like HTTP 504 with JSON `{"error":{"code":"timeout",...}}` is parsed as an API `Error`, so CAPH **does not retry it**, whereas a 504 without a parseable Hetzner error body is retried as an HTTP status failure.

## Reads, creates, deletes and server actions

The SDK classifiers themselves are **method-blind**. Neither Go nor Python asks whether the request is GET, POST, DELETE, a create, or an action before replaying a retryable failure. hcloud-go literally clones the original request and sends it again; hcloud-python calls `Session.request()` again with the same method and arguments.  

That yields these operation-level differences:

| Client | Read | Create | Delete | Server action |
|---|---|---|---|---|
| **hcloud-go 2.48** | R5 classifier. `Server.GetByID` specially converts `not_found` to `nil, nil-error`. | Same R5 classifier; retryable POST can be replayed. No “unknown outcome” object/state. | Same R5 classifier; server delete itself does **not** make 404 success. | Submission POST uses R5; if submission succeeds and the asynchronous **Action later fails**, `WaitFor` reports the action error but does not resubmit the action. |
| **hcloud-python 2.25.1** | Same classifier, but `servers.get_by_id()` does **not** suppress `not_found`; it raises `APIException`. | Same classifier; POST can be replayed; no unknown-result state. | Same classifier; 404 raises. | Same classifier on POST; no automatic resubmission after an asynchronous action failure. |
| **Terraform 1.69** | hcloud-go R5 underneath. `hcloud_server` read treats missing server as gone and removes it from TF state. | Direct `Server.Create`; on request error returns diagnostics **before setting the Terraform ID**. No adoption or unknown marker. | Direct delete; delete itself does not swallow `not_found`. | Ordinary power/change actions get SDK R5 only; selected ancillary actions have provider-specific retry loops. |
| **CAPH 1.1.8** | Old hcloud-go R5 subset; reads feed controller reconciliation. | Significant special handling: uniqueness adoption; unresolved uniqueness requeue 10m; `invalid_input`/`resource_unavailable` stop reconciliation. | Direct SDK deletion; failures return into reconciliation rather than a special global classifier. | Old SDK request classifier on submission; controller state machine may retry/requeue particular workflows. |
| **CCM 1.37** | hcloud-go 2.47 R5. LB reads turn missing/nil into internal `ErrNotFound`. | Direct create; no unknown marker, but subsequent reconciles search by Service UID then name before trying create again. | LB delete explicitly makes `not_found` success. | Submission uses SDK R5, then `WaitFor`; no generic resubmission of a failed asynchronous action. |

For the two SDKs, the server methods show the method-blindness especially clearly. Python's `create()` is just a POST through `_client.request`, while `delete()` is DELETE and `power_on`, `power_off`, `reboot`, etc. are POSTs through the exact same function.  

One notable Go/Python discrepancy is `not_found` on a direct server read. Go's server client says, effectively, “404 means no server”; Python's `get_by_id()` simply executes the GET and constructs a result, so an API 404 propagates as an exception. Python's implementation is visible here. 

## What “post-send transport failure” means here

None of these clients actually determines whether the request bytes reached Hetzner or whether the server committed the operation. They classify the **error returned by the HTTP stack**, not the send phase.

For hcloud-go and its consumers, a `net.Error` whose `Timeout()` is true is retried. A context cancellation/deadline is explicitly checked first and is **not** retried. A post-write EOF, connection reset, broken pipe, or other non-timeout error is not retryable under this classifier. 

For Python, only `requests.exceptions.Timeout` is caught for transport retry. Other Requests transport exceptions fall through. 

So for a create where Hetzner accepted the request but the response was lost:

**hcloud-go / Python / Terraform / CAPH / CCM do not expose an explicit “create outcome unknown” result.** If the failure looks retryable, the SDK may simply replay the POST. If it is not classified retryable, the caller receives an ordinary error. The higher-level CAPH and CCM reconciliation logic is what makes this safer in practice.

## Terraform's extra retry layer

Terraform v1.69.0 uses hcloud-go 2.48.0 without overriding its request retry settings. It does configure a separate **action-polling** backoff, but that changes how often it asks for action state, not which failed HTTP requests get replayed.   

It then adds operation-specific retries. Server attach-to-network is illustrative:

`internal/server/common.go`, terraform-provider-hcloud **v1.69.0**:
```go
err := control.Retry(control.DefaultRetries, func() error {
    action, _, err = c.Server.AttachToNetwork(ctx, srv, opts)
    if hcloud.IsError(err, hcloud.ErrorCodeConflict) ||
        hcloud.IsError(err, hcloud.ErrorCodeLocked) ||
        hcloud.IsError(err, hcloud.ErrorCodeServiceError) ||
        hcloud.IsError(err, hcloud.ErrorCodeNoSubnetAvailable) {
        return err
    }
    if err != nil {
        return control.AbortRetry(err)
    }
    return nil
})
```
Detach has essentially the same `conflict`/`locked`/`service_error` special case. 

Its helper uses **five total function calls**, deterministic exponential backoff 1, 2, 4, 8, 16 seconds:

```go
const DefaultRetries = 5
backoff := hcloud.ExponentialBackoff(2, 1*time.Second)

for try := range maxTries {
    err = f()
    ...
    if err != nil {
        sleep := backoff(try)
        time.Sleep(sleep)
        continue
    }
}
```

A subtle implementation detail: it sleeps after the fifth failure too, so in the all-fail case there is a final 16-second sleep even though no sixth higher-level attempt follows. 

That does **not** apply to the main server creation:

```go
res, _, err := c.Server.Create(ctx, opts)
if err != nil {
    diags = append(diags, hcloudutil.ErrorToDiag(err)...)
    return
}
d.SetId(util.FormatID(res.Server.ID))
```


That ordering is important for ambiguity. If every SDK retry of the initial POST fails and no success response is received, Terraform returns an error **without ever calling `SetId`**. It does not record “possibly created.” If it *does* receive the create response, it sets the ID **before** waiting for the asynchronous creation action, so a later `Action.WaitFor` failure is different: Terraform at least knows the server ID. 

For reads, a missing server removes it from state; for deletion, `DeleteWithResult` errors are returned as diagnostics and are not specially converted from 404 to success in `resourceServerDelete`.  

## CAPH has the strongest create-specific classifications

CAPH v1.1.8 deliberately overrides generic “just retry reconciliation” behavior for three of your codes.

Its create-error path says:

`pkg/services/hcloud/server/server.go`, CAPH **v1.1.8**:
```go
if hcloud.IsError(err, hcloud.ErrorCodeUniquenessError) {
    return reconcile.Result{RequeueAfter: 10 * time.Minute}, nil
}

if hcloud.IsError(err, hcloud.ErrorCodeInvalidInput) ||
   hcloud.IsError(err, hcloud.ErrorCodeResourceUnavailable) {
    ...
    return reconcile.Result{}, nil
}
```


So, specifically for **server create**:

| Error | CAPH behavior after SDK-level handling |
|---|---|
| `uniqueness_error` | First attempts to find the already-existing server by exact deterministic name and **adopt it**. If it cannot, requeue in **10 minutes**. |
| `invalid_input` | Marks creation irrecoverably failed; returns success/no requeue from this reconcile path. |
| `resource_unavailable` | Same: classified irrecoverable and reconciliation stops until outside/manual change. |
| `rate_limit_exceeded` | Records HCloud rate-limit condition/event, then returns the error; controller reconciliation can retry later. |
| most other errors | Returned as reconcile errors; no CAPH-specific fixed delay/cap is encoded in this branch. |

The uniqueness recovery is explicitly an ambiguity fix. In `createServer`, after a `uniqueness_error`, CAPH searches for an existing exact-name server and, if found, marks creation successful and uses it rather than continuing to fail. 

PR **#2167**, merged as `cc76cff89a57a27499bd670f27fe073007b7e525`, explains the reason precisely: a previous reconcile could have successfully created the HCloud server but failed before persisting `ProviderID`/boot state; the next reconcile would issue another create and receive `uniqueness_error` forever. The change adopted the existing server instead, and uses a 10-minute retry only when adoption cannot resolve it. 

That is not formally named “unknown create outcome,” but among these five projects it is the clearest explicit recovery mechanism for exactly that class of ambiguity.

The `invalid_input` / `resource_unavailable` classification was also an intentional 2026 change. CAPH issue **#1885**, “Stop reconciling HCloudMachines with certain errors on creation,” said those errors made success “impossible / very unlikely,” that frequent retries caused “many useless API calls,” and explicitly accepted that `resource_unavailable` could occasionally clear later but would require manual interaction for now.  PR **#1887** implemented it, stating that repeated reconcile “won't change the result” and otherwise leaves the machine stuck in a loop. 

That is a meaningful disagreement with the literal API name **“resource_unavailable”** and Hetzner's description “currently unavailable”: CAPH treats it as terminal for this particular creation workflow, even though the condition may in principle be temporary.

## CCM's create ambiguity recovery is reconciliation-by-discovery

CCM v1.37.0 uses hcloud-go v2.47.0, whose request classifier is already equivalent to v2.48.0 for these codes: `conflict`, `rate_limit_exceeded`, `bad_gateway`, `timeout`, HTTP 502/504, and network timeout.   It doesn't override those defaults when constructing its client. 

Load-balancer creation itself is straightforward: call Create, wait for its Action, then fetch the LB by ID. There is no special “unknown create” type. 

But the next `EnsureLoadBalancer` reconciliation does:

```go
lb, err = l.lbOps.GetByK8SServiceUID(ctx, svc)
...
if errors.Is(err, hcops.ErrNotFound) {
    lb, err = l.lbOps.GetByName(ctx, lbName)
}
...
if errors.Is(err, hcops.ErrNotFound) {
    lb, err = l.lbOps.Create(ctx, lbName, svc)
}
```


Thus an ambiguous create that actually committed can normally be recovered on the next reconcile **before another create is attempted**, by the Service UID label or by name. That is analogous in purpose to CAPH's uniqueness adoption, although CCM does it proactively as its normal ensure algorithm.

CCM also makes load-balancer deletion idempotent at its wrapper level:

```go
_, err := l.LBClient.Delete(ctx, lb)
if hcloud.IsError(err, hcloud.ErrorCodeNotFound) {
    return nil
}
```


## Where Hetzner's documentation and the clients disagree

Hetzner's current Cloud API table is unusually helpful because only three relevant descriptions explicitly tell the caller to retry: `conflict` (“resource has changed … please retry”), `bad_gateway` (“could not be answered … please retry”), and `timeout` (“could not be answered in time, please retry”). It describes `unavailable` merely as a service/product being unavailable, `server_error` as an API-backend error, `locked` as another Action already running, and `resource_unavailable` as a resource “currently unavailable.” ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

Current hcloud-go, hcloud-python, Terraform and CCM agree with the explicit “please retry” classifications for `conflict`, `bad_gateway`, and `timeout`. **CAPH does not for the latter two solely because its v1.1.8 dependency is hcloud-go v2.32.0.**

All five also retry `rate_limit_exceeded`, although Hetzner's documentation does not say “retry immediately”; instead it exposes `RateLimit-Reset`, and notes that quota replenishes gradually. The SDK backoff implementations do **not** use `RateLimit-Reset`; they use their generic 1-second exponential/jitter schedule. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

The history here is interesting. hcloud-go PR **#210** in 2022 was literally titled **“Stop automatic retrying on RateLimitExceeded”** and explained: “It does not make sense to retry when the rate limit is already exceeded,” preferring caller-side handling, while retaining conflict retries for compatibility.  Later PR **#470** introduced the modern retry handler and **reintroduced rate-limit retry**, alongside gateway and network-timeout retry, with a five-retry exponential policy. 

The two 2026 application-code changes followed the docs verbatim. hcloud-go PR **#797**, merged as `3def8ef9c29eed053975cf7eb185d99d7f3a9667`, added `timeout` because “This error code explicitly document[s] that the request should be retried.”  hcloud-python PR **#617**, merge `101b2d11fd33f5e0e2452427392a727c79033662`, gives the same reason. 

Then hcloud-go PR **#874**, merge `7cdd31b5c7215e93ce498093f4675991b4440ddb`, and hcloud-python PR **#658**, merge `36f530260feb7f4e724731c65c956cb12a3a02d9`, added the application `bad_gateway` code in June 2026. Notably, Go's PR test suite explicitly distinguishes a JSON API `unavailable` error as **not retryable**, even though it is HTTP 503.  

`placement_error` is another documentation mismatch of a different kind: hcloud-go defines it as a server-specific code — “An error during the placement occurred” — but it is absent from Hetzner's current global error-code table. It is not retryable by any of the request classifiers examined here.  ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

Finally, Hetzner documents Actions as asynchronous: callers should wait until success/error, and an action that fails carries its underlying error. That is important because an error such as `placement_error`, `locked`, or `service_error` that appears **inside a completed Action** is not equivalent to that code being returned by the action-submission HTTP request. The SDK request retry handler only sees the latter; `Action.WaitFor` does not automatically re-submit a failed action. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

### Bottom line

The most material cross-client differences are: **CAPH's stale SDK pin**, which means no request replay for JSON `timeout`/`bad_gateway`; **CAPH's application-level decision that `invalid_input` and `resource_unavailable` are terminal creates**; **CAPH's uniqueness adoption and CCM's discovery-first reconciliation**, which recover ambiguous successful creates without formally representing an “unknown” outcome; and **Terraform's selective second retry layer for `locked`/`service_error` on certain operations**, while its normal server create has no such recovery.

None of the five has a first-class “this create may have committed” result. At the SDK layer, a timeout classified retryable can result in a **blind replay of a non-idempotent POST**; the safety, where present, comes from higher-level naming/label-based reconciliation rather than from transport-level idempotency or an explicit unknown-state API.

---

If you want, I can:

- Continue detailed error handling comparison
- Explain create outcome unknown handling
- Summarize retry schedules and strategies
