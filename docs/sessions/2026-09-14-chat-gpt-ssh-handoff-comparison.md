# SSH Handoff Comparison

Source: https://chatgpt.com/share/6aa7740e-943c-83eb-9093-e1f6883e0a57

---

## Turn 1: User

_2026-09-14T04:05:46.898Z_

We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Investigate the browser-to-agent handoff for SSH setup. A person is authenticated on our website. Their local agent can normally execute commands and access the network, but may not control an authenticated browser, possess an API token, or have a preinstalled helper. Private keys and bearer enrollment authority should not be inserted into model-visible prompts or output. Minimal user interaction is a preference; expose any conflict with those requirements instead of silently dropping one.

Compare feasible handoffs on equal terms: explicit browser approval of a request, existing authenticated clients when available, separate delivery of authority, and any simpler mechanism you can justify. Distinguish an identifier from a bearer capability. Do not assume a public URL can authorize retrieval just because its response is not printed.

Cover request substitution, binding to the exact public key/account/options/server, replay, phishing, expiration, cancellation, retries, duplicate execution, cleanup, and failure after authorization but before installation. Distinguish avoiding accidental model disclosure from isolating secrets from an agent with filesystem access.

Return minimum user steps and prerequisites for each viable flow, then recommend one baseline with its tradeoffs. Reuse the ordinary authorization API; do not create a second SSH credential mechanism.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.

---

## Turn 2: ChatGPT

_2026-09-14T04:05:47.577Z_

I’ll compare the handoffs as security protocols, not just UX patterns, and keep the SSH authorization API itself unchanged. I’ll ground the recommendation in OAuth/device-flow security properties plus OpenSSH/Ubuntu source and package behavior, then turn that into concrete pass/fail checks.

---

## Turn 3: ChatGPT

_2026-09-14T04:06:25.775Z_

One security point is already decisive: a URL or short code can safely be an **identifier** only if it cannot itself cause the SSH authorization. The authority should stay in the authenticated browser approval; any agent-held polling secret should be unable to change the approved server/account/key/options tuple.

---

## Turn 4: ChatGPT

_2026-09-14T04:09:23.598Z_

The evidence also exposes the main UX/security conflict: device-style approval is explicitly vulnerable to remote phishing unless the user verifies they are approving the device/request they actually initiated. RFC 8628 recommends showing a code/device context and having the user confirm it; a “click this complete link and approve” shortcut is weaker.

---

## Turn 5: ChatGPT

_2026-09-14T04:09:50.961Z_

## Recommendation

Use a **device-flow-inspired pending operation with authenticated browser approval, but do not issue an enrollment bearer token to the agent at all**.

The agent should submit the exact proposed ordinary SSH-authorization operation—server ID, Linux account, structured OpenSSH options, and public key—to Composery. Composery stores that proposal immutably and returns only a **request identifier** plus an approval URL/display code. The authenticated browser reviews and approves that immutable request, and the approval handler invokes the **same ordinary SSH authorization application operation** that the normal UI and authenticated programmatic clients use. The unauthenticated agent only observes status and then tests SSH with its locally held private key.

That gives you the broad compatibility of OAuth device flow without turning the handoff into a second credential system. It works when the browser and agent cannot communicate directly, requires no existing CLI token or helper, and never requires private-key material or enrollment authority to appear in a model-visible prompt.

There is one unavoidable UX/security tradeoff: **a single-click approval link is remotely phishable**. RFC 8628 specifically identifies this problem and recommends showing device/request context and, for complete verification links, having the user verify a code displayed by both sides. ([rfc-editor.org](https://www.rfc-editor.org/rfc/rfc8628.html)) For an SSH-administration operation I would keep the additional visual code comparison rather than silently sacrifice that protection.

### Evidence boundary

The deployment-relevant SSH implementation is not OpenBSD-current or OpenSSH Portable master. As of September 14, 2026, Ubuntu 24.04 Noble Updates publishes `openssh-server 1:9.6p1-3ubuntu13.19`; Ubuntu's package is a patched build and should be the final compatibility target. ([Ubuntu Packages](https://packages.ubuntu.com/noble-updates/openssh-server))

| Source | Exact version/date consulted | Role |
|---|---|---|
| Ubuntu 24.04 LTS Noble | `openssh-server 1:9.6p1-3ubuntu13.19`, package page checked Sept. 14, 2026 | **Deployment authority** for your initial image. ([Ubuntu Packages](https://packages.ubuntu.com/noble-updates/openssh-server)) |
| OpenSSH Portable | tag `V_9_6_P1`, annotated Dec. 18, 2023; commit `8241b9c0529228b4b86d88b1a6076fb9f97e4a99`  | Ubuntu upstream base, before Ubuntu patches. [tag](https://github.com/openssh/openssh-portable/tree/V_9_6_P1?utm_source=chatgpt.com) |
| OpenSSH Portable master | `7fe3b24c922b7af2d743737f7cf37df61ea06426`, Sept. 3, 2026  | Current upstream contrast only; **not** evidence of Noble behavior. |
| OpenBSD-current | `sshd.8,v 1.332`, Sept. 2, 2026  | Upstream OpenBSD-current semantics/documentation; **not** the Ubuntu package. |
| SSH protocol | RFC 4252 / RFC 4253, January 2006 | Protocol-level public-key authentication. RFC 4252 signs the session identifier, username, service, algorithm and public key, so ordinary SSH later proves possession of the private key independently of Composery. ([RFC Editor](https://www.rfc-editor.org/info/rfc4252/?utm_source=chatgpt.com)) |

The Portable 9.6 source documents `authorized_keys` entries as optional options followed by key type, encoded public key and comment.  That is consistent with your structured-controls direction, but I would validate all rendering/parsing rules against the exact Noble binary rather than treating Portable master or OpenBSD-current as normative.

## Handoffs on equal terms

| Flow | Minimum user interaction | Prerequisites | Assessment |
|---|---|---|---|
| **Pending request → browser approval → server executes ordinary operation** | Open approval page; compare request/code; click Approve. Authentication only if Clerk session has expired. | Agent needs outbound HTTPS and the public key. Browser can even be on another device. | **Recommended baseline.** No enrollment bearer has to reach the agent. |
| **Already-authenticated Composery client** | Normally none beyond invoking setup. | Agent/client already holds usable Composery authentication with the ordinary `SSH administration` permission. | Best fast path when available; cannot be assumed. |
| **Browser → loopback callback with PKCE** | Agent opens browser; user clicks Approve. | Same machine, ability to bind `127.0.0.1`/`::1`, open external browser and run a native/helper component. | Sound, but more platform machinery than necessary for your baseline. RFC 8252 explicitly supports desktop loopback redirects and requires PKCE for public native clients. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8252.html)) |
| **Browser issues a one-time operation bearer; authority delivered separately to agent** | Approve plus delivery/import of the capability. | A secret delivery channel not exposed in the model transcript: helper, credential broker, downloaded protected file, etc. | Feasible but strictly worse here unless another product need requires it. |
| **Manual public-key transfer into existing UI** | User copies/uploads public key, selects/reviews server/account/options and submits. | Only the normal browser UI. | **Strongest simpler alternative.** Lowest protocol complexity, more user work. |

RFC 8628 is especially close to your topology: an unauthenticated/device-side client gets a device code plus a user-facing identifier, the user authenticates separately, and the client polls. It also defines expiration, denial, pending status, polling limits and retry/backoff behavior. ([RFC Editor](https://www.rfc-editor.org/info/rfc8628/?utm_source=chatgpt.com)) I would borrow those state-machine ideas, not copy its token issuance: after browser approval, Composery can simply execute your existing SSH-authorization operation.

### Identifier versus bearer capability

This distinction should be explicit in the protocol.

A `request_id` is an **identifier** if knowing it lets a caller do no more than locate a pending operation or observe non-sensitive state. It must not be accepted as proof that the caller may install a key. An approval URL containing only this identifier remains an identifier: opening it must require an authenticated Clerk session, current platform authorization, and an explicit state-changing approval action.

A token that lets its holder approve, redeem, install, or otherwise exercise the SSH authorization is a **bearer capability**. Whether its value is hidden by the frontend or omitted from console output changes nothing. RFC 6750 defines a bearer by possession and specifically warns against putting bearer tokens into page URLs because URLs leak through history, logs and other infrastructure. ([RFC Editor](https://www.rfc-editor.org/info/rfc6750/?utm_source=chatgpt.com))

So a public-looking `https://…/ssh-setup/<request-id>` URL is fine **only because it carries no authority**. “Nobody prints the response” is not an authorization mechanism.

## Recommended baseline semantics

The agent should create or select the SSH key locally and transmit only the public material. The backend creates an immutable proposal whose security-relevant payload is something equivalent to:

`AddSshAuthorization(serverId, linuxAccount, structuredOptions, publicKeyAlgorithm, publicKeyBlob)`

Bind to the immutable platform server ID, not just an IP or hostname. Bind the exact Linux account and the complete structured options set. Bind the exact public-key blob, not merely a human-readable fingerprint; the fingerprint is for review. Canonicalize the structured options before calculating any operation digest.

The browser loads that stored proposal from Composery rather than trusting server/account/key/options copied from query parameters. It checks the signed-in user's current platform permission and visibly presents server, Linux account, key type/fingerprint and effective options. Approval invokes the same ordinary authorization operation used elsewhere.

The request state can stay small: `pending → approved/applying → installed`, with terminal `denied`, `cancelled`, `expired`, or `failed`. Approval and installation should be separately recorded so “approved but remote edit failed” is observable.

This addresses the requested failure cases as follows:

| Issue | Baseline behavior |
|---|---|
| **Request substitution** | Proposal is immutable after creation. Browser fetches it server-side. Changing URL parameters cannot change the operation. A different tuple requires a new request/approval. |
| **Exact binding** | Approval is bound to the canonical server ID + Linux account + option structure + full public-key blob + operation type. |
| **Replay** | Approval is idempotent and request-scoped. A completed/expired/cancelled request cannot create another operation. |
| **Phishing** | Browser shows exact operation and a short code also visible to the initiating agent. RFC 8628 identifies unsolicited device-flow approvals as a remote-phishing risk. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8628.html)) |
| **Expiration** | Pending requests expire quickly. An approved-but-not-applied request also gets a bounded execution deadline; after it, fresh approval is required. |
| **Cancellation** | Authenticated browser can cancel before successful application. Stopping the agent merely stops polling; it does not silently revoke an already-installed key. Removing an installed key remains the ordinary remove-authorization operation. |
| **Retries** | Retry only the same durable operation ID and immutable tuple. Network retry must never reopen the authorization decision. |
| **Duplicate execution** | Ordinary authorization operation needs idempotency. If the remote write may have happened before the response was lost, perform a live read and recognize that the exact authorization is already present instead of appending a duplicate. |
| **Failure after approval, before installation** | Preserve `approved/failed` state and allow bounded retry of exactly that operation while approval remains valid. Recheck platform authorization before applying. |
| **Cleanup** | Expire the handoff record and transient codes. Do not turn it into the persistent per-member key inventory your working direction explicitly does not require. |

That last permission recheck matters: if platform membership or SSH-administration permission disappears after browser approval but before installation, installation should fail. That does **not** imply automatic removal of an already-existing native SSH authorization; it only prevents a still-pending platform operation from executing.

### Phishing and the minimum-interaction conflict

You cannot simultaneously get the strongest possession confirmation and a pure “click one link, approve once” experience.

RFC 8628 permits a complete verification URI for convenience, but still says the authorization server should display the user code and ask the user to verify that it matches the code shown on the initiating device; it explicitly gives remote phishing as the reason. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8628.html))

For Composery I would make the minimum normal path: **agent opens/copies approval URL → browser shows matching short code and exact SSH authorization → user clicks Approve**. No code typing is necessary when the link identified the request; visual comparison is enough. If you omit the comparison, document remote approval-link phishing as an accepted residual risk.

A loopback+PKCE variant does not eliminate this phishing class. PKCE protects an intercepted authorization code from being redeemed by a different client; it does not stop a user from deliberately approving an attacker's request. RFC 8252 is explicit that PKCE addresses code interception. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8252.html))

## Why I would not deliver enrollment authority to the agent

A one-time, narrowly scoped capability can be made technically respectable: bind it to the exact operation digest and audience, give it a very short lifetime, make it one-use, consume it atomically only after creating a durable operation record, and never put it in a URL. Those measures follow standard bearer-token threat mitigations around scoping, expiry and replay. ([RFC Editor](https://www.rfc-editor.org/info/rfc6750/?utm_source=chatgpt.com))

But it buys nothing necessary in the baseline. The browser can exercise its authenticated authority directly. Delivering a bearer to the agent creates another theft/replay/cleanup problem purely to hand authority back across the boundary you already crossed.

There is also an important distinction in your secret requirement: **preventing accidental model disclosure is achievable; isolating a secret from an agent with arbitrary filesystem/process access is not.** A secret stored in a `0600` file, environment variable, keychain export or hidden pipe can avoid appearing in prompts, shell history and tool output. But if the agent itself may arbitrarily read the same filesystem/process context, that is not a security boundary against that agent. Actual isolation requires another principal or mechanism—a credential broker/helper, OS-protected service, hardware key, sandbox boundary, etc. The recommended baseline avoids needing such a boundary because the agent never needs enrollment authority.

## Existing authenticated clients

When a real Composery CLI/native client already possesses authentication, use it directly. It should invoke exactly the same `AddSshAuthorization` operation and the same platform permission check as the browser. There is no reason to force device approval on top of a valid client credential unless you separately decide SSH administration requires step-up confirmation.

This is the lowest-interaction path, but it is an optimization, not a prerequisite, because your premise explicitly says such authentication cannot be assumed.

## Strongest simpler alternative

The strongest simpler alternative is **no handoff protocol at all**: have the agent expose only the public key or `.pub` file, and have the authenticated user add it through the ordinary Composery SSH-authorization UI.

It wins on implementation surface, eliminates anonymous pending-request creation, introduces no new bearer/callback protocol, and inherently uses the existing operation/authz path. Cancellation and retry are just normal UI semantics.

Prefer it if a few extra user actions are acceptable for the first release, especially if SSH setup is infrequent. The browser-approval protocol becomes preferable when reducing copy/paste and exact-server/account/options transcription errors is materially valuable.

## Explicit pass/fail checks

| Check | Pass criterion |
|---|---|
| **Altered approval URL** | Changing server/account/options/key in URL/query does not change the stored operation. |
| **Attacker's request** | Victim sees attacker-provided key fingerprint/code and must explicitly approve; URL possession alone cannot install it. |
| **Anonymous POST** | Creating a pending request conveys zero SSH-management authority. |
| **Request-ID disclosure** | Knowing only `request_id` cannot approve, mutate, redeem or install anything. |
| **Replay** | Second approval/redemption/execution produces no additional authorization. |
| **Expiry** | Approval and installation fail after the applicable deadline. |
| **Cancel-before-apply** | Installation is impossible after authenticated cancellation. |
| **Permission revoked mid-flow** | Apply fails even though the request had previously been approved. |
| **Lost response after server write** | Retry live-reads state and returns success without creating a duplicate authorization. |
| **Concurrent retries** | Exactly one effective authorization results. |
| **Wrong server/account/options** | No component can substitute any member of the approved tuple without a new approval. |
| **Model transcript/log inspection** | No private key, operation bearer, PKCE verifier or equivalent enrollment authority appears in prompts, command output, URLs, analytics or application logs. |
| **Agent-compromise claim** | Documentation does **not** claim a local secret is isolated from an agent that can read the file/process containing it. |
| **Ubuntu validation** | Test image reports the expected Noble OpenSSH package and all rendered authorization forms are accepted by that exact installed `sshd`, not merely by Portable master. |

I did **not** run Windows, macOS, Linux-client, or Ubuntu VM experiments for this answer. Repository/source access was available, including the exact Portable 9.6 tag and current upstream metadata. A reproducible deployment check on the Ubuntu image is `dpkg-query -W -f='${Version}\n' openssh-server`, followed by tests against the actual installed `sshd`; for any loopback alternative, separately test IPv4 and IPv6 loopback binding/browser return on each supported desktop OS because RFC 8252 recommends not assuming one IP version. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8252.html))

The only material dependency left outside this scope is that the **ordinary SSH-authorization operation itself must have durable idempotency and live-state verification around the remote edit**. That is required to make authorization retries safe; it does not require a second SSH credential mechanism or continuous enforcement.
