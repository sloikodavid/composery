# Compare Enrollment Protocols

Source: https://chatgpt.com/share/6aa7060b-31d0-83ed-8899-c3434fc757dc

---

## Turn 1: User

_2026-09-13T20:19:47.257Z_

Design and compare enrollment protocols for a VPS product where a signed-in server member copies a prompt into a local coding agent. The local machine should generate and retain its private key. Compare single-use bearer enrollment with authenticated browser approval, including OAuth device authorization where appropriate. Analyze copied-chat leakage, redemption races, device/public-key binding, replay, expiration, retries, cancellation, membership removal during enrollment, and server ownership transfer. Recommend the smallest robust design. Do not assume the pasted prompt can safely contain an access-granting secret.

---

## Turn 2: ChatGPT

_2026-09-13T20:19:48.796Z_

I’ll treat the pasted prompt as potentially observable by the chat/model/clipboard path and design authorization so that **copying it never conveys authority**. The key comparison is therefore “capability in the paste” versus “paste only bootstraps an independently approved, key-bound request.”

---

## Turn 3: ChatGPT

_2026-09-13T20:20:03.792Z_

The strongest simplification is to make the local public key itself the continuity mechanism. The agent can create a pending request with its public key, and every later machine-side operation can prove possession of the corresponding private key; that removes the need for any redeemable bearer secret in the pasted text—or even in the polling protocol.

---

## Turn 4: ChatGPT

_2026-09-13T20:20:03.792Z_

The core security property should be: **the pasted prompt may identify what the user wants to enroll, but possession of anything in that prompt must never be sufficient to enroll a machine.** Authorization should happen later in an authenticated browser, after the local agent has generated its keypair.

### Comparison

| Property | Single-use bearer copied in prompt | Browser approval after local keygen | OAuth Device Authorization |
|---|---|---|---|
| Safe if pasted text leaks to chat logs, clipboard history, telemetry | **No.** The leak is an enrollment capability | **Yes**, if pasted values are only locators/instructions | Yes, provided the `device_code` is generated after the paste and remains on the local machine |
| Private key generated locally | Yes | Yes | Yes |
| Prevents attacker racing the real machine | No: thief redeems bearer first with their key | Yes: request is already bound to local public key | Not automatically; bind the device authorization to the initiating public key |
| Requires browser login | No | Yes | Yes |
| User can see exactly what is being authorized | Usually weak | Strong | Strong |
| Good for headless/SSH machines | Yes | Yes, via polling | Excellent |
| Implementation size | Smallest superficially | **Small and robust** | Larger if you do not already run OAuth |
| Recommendation | Reject for this use case | **Default** | Use when device-flow interoperability or cross-device UX is useful |

A one-time bearer does not become safe merely because it expires quickly or is single-use. If `T` is pasted and `redeem(T, attacker_pubkey)` enrolls the attacker, copied-chat leakage becomes a credential-theft problem. An attacker who sees the paste can simply win the redemption race. Binding `T` to a public key would solve that, but the browser does not know the public key until after the local agent has run; requiring another round trip to establish that binding effectively turns the protocol into the browser-approval design anyway.

## Smallest robust protocol

I would use a first-party, device-flow-like protocol, but **without an access-granting device secret at all**.

The pasted prompt can contain something like:

> Enroll this machine with VPS server `srv_7F…` using `https://control.example.com`.

The server identifier can instead be an opaque, short-lived enrollment *locator* if revealing the real server ID is undesirable. It must not authorize anything.

Then:

1. **The local agent generates a keypair.** The private key is written locally with appropriate OS permissions/key-store protection and never transmitted. The agent derives a stable public-key thumbprint.

2. **The agent creates a pending enrollment.** It sends `{server_locator, public_key, client_nonce, device_label}` to the service. Include a signature by the new private key over the canonical request so the service knows the submitter actually possesses that key. The request becomes immutable once created.

3. **The service returns an enrollment request ID and approval URL**, for example `https://control.example.com/enroll/ABCD…`. The request ID is a locator, not authority. Knowing it cannot approve the request, replace its key, or obtain a usable credential.

4. **The agent opens that URL in the user's browser**, or prints it for the user. The browser uses the user's existing authenticated web session. If they are not signed in, they sign in there.

5. **The approval page shows the security-relevant facts:** VPS/server identity, requested device name, requesting member/account, and a short confirmation value derived from the enrollment request plus public-key thumbprint. The local agent displays the same value. This inexpensive comparison is useful protection against approval-link substitution and remote-phishing scenarios.

6. **Approval is one atomic authorization transaction.** Under a database transaction, re-check that the request is pending and unexpired; the browser user currently has the required permission on this server; the server has not changed ownership/security epoch; the stored public key still matches; and the request has not been cancelled. Then create the server-owned device identity bound to that public key and change `pending → approved`. There should be no separate bearer-token “redemption” security boundary afterward.

7. **The agent polls using proof of possession of its private key.** Once approved, it receives a device identifier plus either a non-secret certificate/public authorization object or a sender-constrained access credential. Subsequent authentication should also require that key. If you use OAuth access tokens, DPoP is a standard way to sender-constrain them to a key. RFC 9449 specifically defines proof-of-possession binding intended to make stolen tokens unusable without the private key. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc9449.html?utm_source=chatgpt.com))

That is only marginally more complicated than a one-time token, while removing the dangerous assumption that the pasted channel is confidential.

### Why the enrollment ID does not need to be secret

A useful design test is to imagine posting the entire pasted prompt and approval URL publicly.

An unauthenticated attacker may be able to see or guess that a pending request exists, but they cannot approve it because approval requires an authenticated, currently authorized browser session. They cannot swap in their public key because the request is immutable. They cannot collect a usable machine credential because the resulting device identity is bound to the original public key.

You can still make request IDs 128+ bits and avoid exposing metadata to unauthenticated callers. That is good hygiene, but security should not depend on their confidentiality.

## OAuth choices

If the local tool can open a browser on the same workstation, a standard native-app browser flow is another good implementation: external browser authentication, Authorization Code + PKCE, with a loopback redirect to `127.0.0.1`. RFC 8252 recommends native applications authenticate through an external user-agent and requires PKCE for public native clients; it explicitly supports loopback redirects for desktop software. ([RFC Editor](https://www.rfc-editor.org/info/rfc8252/?utm_source=chatgpt.com))

For a CLI, remote SSH session, container, or environment where a callback cannot reliably reach the agent, **OAuth Device Authorization (RFC 8628)** fits naturally. The client initiates the flow, receives a high-entropy `device_code`, a human `user_code`, an expiry, and a polling interval; the user authenticates separately in a browser and approves there. RFC 8628 requires expiration, defines polling/`slow_down` behavior, and explicitly discusses brute forcing, phishing, and session spying. ([RFC Editor](https://www.rfc-editor.org/info/rfc8628/))

There is one important adaptation for VPS enrollment: **pin the public key when the device authorization request is created.** Plain Device Authorization primarily correlates a browser grant with a polling device; by itself it should not be treated as proof that the same key that started enrollment receives the result. Your authorization record should therefore contain the public-key thumbprint, and finalization should only ever create a credential for that key.

The RFC's `device_code` is supposed to be high entropy and is not shown to the user. ([RFC Editor](https://www.rfc-editor.org/info/rfc8628/)) In your scenario it is acceptable because it is received directly by the local process *after* the copied-prompt step. But a custom first-party protocol can be even simpler: let key proof replace the bearer `device_code`.

### Copied-chat leakage and phishing

Assume the pasted prompt can end up in model-provider logs, browser history, shell history, clipboard managers, issue trackers, screenshots, and team chat. Therefore it should contain no refresh token, enrollment JWT, magic link that implicitly approves enrollment, API key, or one-use capability.

A browser URL containing only a pending-request locator is different: disclosure might let someone inspect or nuisance-cancel a request if your APIs are badly designed, but it does not confer access.

Device flow also has a distinct phishing issue: an attacker can initiate *their* enrollment and persuade a victim to authorize the displayed code. RFC 8628 recommends clearly telling users that they are authorizing a device, showing device information, and having them verify that the displayed code matches the device. ([RFC Editor](https://www.rfc-editor.org/info/rfc8628/)) Your public-key-derived confirmation string serves exactly this purpose.

## Race and lifecycle semantics

Make the enrollment state machine explicit:

`PENDING → APPROVED`  
`PENDING → CANCELLED`  
`PENDING → EXPIRED`

Those are terminal transitions. Approval and cancellation compete through one conditional database update, so exactly one wins.

**Redemption races.** With pasted bearer enrollment, this is the principal vulnerability: first redeemer wins. With key-first browser approval there is essentially nothing meaningful to race. Approval creates a credential only for the already-pinned public key. Two pollers may race to fetch the result, but an attacker cannot use it without that private key.

**Replay.** Browser approval should be a CSRF-protected authenticated POST, and the pending record can transition only once. Machine-side signed operations should cover the HTTP method, endpoint, enrollment ID, request body hash, timestamp and unique nonce/`jti`, with a short replay cache; using a standardized proof such as DPoP is preferable if you already have OAuth. RFC 9449 requires unique proof JWTs and binds proofs to the target request. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc9449.html?utm_source=chatgpt.com))

**Expiration.** I would give pending VPS enrollments roughly 5–10 minutes, rather than long-lived invitations. Expiration should be checked inside the approval transaction, not merely by a cleanup job. If using Device Authorization, honor the server-provided expiry and polling interval; RFC 8628 requires clients to respect the minimum polling interval and `slow_down`, and recommends backing off further after network timeouts. ([RFC Editor](https://www.rfc-editor.org/info/rfc8628/))

**Retries.** `create-enrollment` should accept a random client-generated idempotency nonce, so a lost HTTP response does not accidentally produce many requests. Polling is naturally idempotent. Approval of an already-approved request returns its existing terminal result rather than provisioning another device. After expiry, start a new enrollment; retaining the same locally generated key is fine unless you have another reason to rotate it.

**Cancellation.** Let both sides cancel: the local agent signs a cancellation with its pending key, while the authenticated web UI lets the user/admin cancel. If cancellation commits before approval, subsequent approval fails. Cancelling after approval is no longer “cancel enrollment”; it should be the normal **revoke device** operation.

### Membership removal during enrollment

Define the exact commit point so this does not have ambiguous race behavior.

The browser's permission must be checked against **current membership inside the approval transaction**, not merely against the fact that the member was logged in when the page was created. If the membership removal commits first, approval fails. If approval commits first, the enrollment has completed.

I would make the resulting machine credential **server-owned rather than member-owned**. Removing Alice from the team tomorrow should not unexpectedly disconnect production servers that Alice legitimately enrolled yesterday. Record `approved_by_user_id` for audit, but don't make the credential's continuing validity depend on Alice's membership unless that is specifically your product policy.

This is another reason to make approval itself the provisioning commit. Avoid a state such as “Alice approved; machine has not redeemed yet” where you then have to decide whether Alice's later removal invalidates an apparently completed authorization.

### Server ownership transfer

Treat ownership or tenant transfer as a stronger security boundary than normal membership churn.

Give each server an `ownership_epoch` or `security_epoch`. Every pending enrollment records the current epoch. A transfer increments it, immediately invalidating all pending enrollments. The approval transaction requires `pending.epoch == server.current_epoch`.

For already enrolled machines, the safest default is also to **revoke them on ownership transfer and require re-enrollment by the new owner**. Otherwise a private key retained by a previous operator, old image, snapshot, backup, or automation system can continue authenticating after the asset changes hands. If you later add an explicit “transfer server and preserve trusted devices” option, make that a conspicuous, separately authorized operation rather than the default.

Avoid relying solely on very long-lived self-contained JWTs for server devices if immediate revocation and ownership transfer matter. Keep a server/device revocation or epoch check in the authorization path.

## Recommendation

The smallest robust design is **key-first pending enrollment + authenticated browser approval + key-authenticated polling**. Do not put an enrollment bearer in the copied prompt. Do not even require a secret `device_code` unless you are implementing a conventional OAuth device flow.

Its minimum server-side record is roughly:

```text
enrollment_id
server_id
server_security_epoch
public_key / key_thumbprint
client_nonce
device_label
state = pending | approved | cancelled | expired
expires_at
approved_by_user_id
approved_at
```

The critical invariant is:

> **A browser can authorize only the immutable public key already registered by the machine, and the machine can complete enrollment only by proving possession of that key.**

Use ordinary authenticated browser approval when this is your own product. Use Authorization Code + PKCE when you already have a native-app OAuth architecture and a browser callback is practical. Use RFC 8628 Device Authorization when the agent is headless or the approving browser may be on another device. Current OAuth security guidance is consolidated in RFC 9700, published as Best Current Practice in January 2025. ([RFC Editor](https://www.rfc-editor.org/info/rfc9700/?utm_source=chatgpt.com))

Most importantly, **do not try to make a pasted bearer “safe enough” with short TTLs and one-use semantics**. Under the stated threat model, moving the actual grant into the authenticated browser is both smaller conceptually and materially safer.
