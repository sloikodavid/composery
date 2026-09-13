# SSH Access Architecture Comparison

Source: https://chatgpt.com/share/6aa6f4d3-3060-83eb-a663-3f3c2ebedbea

---

**User**

Research future SSH access for multi-user VPSs. The app uses Clerk authentication and Convex membership with owner/write/read roles. A user can belong to many servers. Servers may grant full Linux root access. Slugs are mutable DNS-label handles with permanent old aliases. Compare individual authorized keys, short-lived OpenSSH certificates, and a gateway. Include browser SSH only as a later client, not the architecture's starting assumption.

Use official OpenSSH documentation and relevant primary sources. Explain onboarding, issuance, private-key custody, host-key verification, certificate principals, revocation, already-open sessions, expiry, offline guests, recovery, ownership transfer, and rename behavior. Explicitly distinguish revoking a managed credential from undoing actions by someone who previously had root. Explain why a read role cannot safely expose credentials that authorize writes. Compare shared credentials without assuming their apparent simplicity extends to revocation.

Return a minimal recommended access contract, a permission matrix, and the architecture decisions the current server schema must preserve. Identify what can wait. Do not promise complete revocation on a guest controlled by root. Cite primary sources.

---

**ChatGPT**

I’ll treat this as an access-control and lifecycle design problem, not a UI/client choice. I’m grounding the comparison in OpenSSH’s own manuals/protocol docs, then I’ll turn that into a concrete contract and schema constraints for Clerk + Convex.

---

**ChatGPT**

The core design is already taking shape: **identity and membership should decide whether a short-lived credential may be issued; mutable slugs should not be authorization identifiers**. For direct SSH, a server-specific certificate principal (derived from an immutable server ID) prevents a certificate issued for one VPS from being accepted on another VPS that trusts the same CA.

---

**ChatGPT**

A second important boundary: **certificate expiry and revocation govern future authentication, not rollback of root authority**. OpenSSH validates a certificate when authentication occurs; after successful authentication the connection enters session mode, so expiry does not automatically kill an already-open shell. OpenSSH’s revocation mechanism is a local revoked-keys/KRL file, which also means an offline guest cannot learn an urgent revocation unless you can update that guest.

---

**ChatGPT**

## Recommendation

Use **short-lived OpenSSH user certificates as the primary SSH authorization mechanism**, with direct native SSH as the first client. Keep a gateway as an optional later layer for network enforcement, browser access, session visibility/termination, and recording—not as the primitive that defines who is allowed onto a server.

The trust chain should be:

**Clerk identity → Convex server membership/role → certificate issuance decision → OpenSSH certificate → immutable server principal → Linux account/access profile.**

Clerk proves who the requester is; the issuer must still perform a current server-side Convex membership check. Clerk documents backend verification of short-lived signed session tokens, while Convex validates the Clerk token and exposes authenticated identity to backend functions. ([Clerk](https://clerk.com/docs/guides/sessions/manual-jwt-verification?utm_source=chatgpt.com))

For an `owner` or `write` member, the client supplies a public SSH key and receives a certificate valid for a short period—I'd start around **10 minutes**, with the exact TTL configurable later. The user's private key stays on their device; the platform stores the public key and the CA signs that public key. OpenSSH explicitly supports signing public keys into user certificates, certificate principals, key IDs for logging, and bounded validity intervals. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

The certificate should be for **one server and one OS access profile only**, not for every server the person belongs to. This keeps compromise and role changes server-local.

---

## The key design detail: certificate principals

Do **not** use the mutable slug as the authorization principal.

Each server should have an immutable SSH authorization identity, e.g. conceptually:

```text
server <immutable-server-id> / root
```

The exact string format is unimportant; stability is important. Provision the guest so its `root` account accepts that server-specific principal through `AuthorizedPrincipalsFile` while trusting your user CA through `TrustedUserCAKeys`. OpenSSH permits a certificate signed by a trusted CA only when an allowed certificate principal matches; using an explicit principals file removes the default requirement that the principal merely be the Unix username. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config))

That solves an otherwise serious issue. If every certificate merely had principal `root` and every VPS trusted the same CA, a certificate issued for server A could potentially authenticate as root on server B. A stable server-specific principal scopes it.

I would put **the person and membership in the certificate key ID/audit data, not use the person's identity as the server authorization principal**. A useful conceptual split is:

```text
principal  = which machine/access profile this cert authorizes
key ID     = who/which membership/which issuance caused it
serial     = unique revocation/audit identifier
```

OpenSSH records the certificate key ID in authentication logs, and KRLs can revoke certificates by serial or key ID. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

App roles and OS profiles should remain conceptually distinct. Today both `owner` and `write` may map to `root`; later you might introduce a restricted profile without changing the membership model.

---

## Comparison

| Property | Individual `authorized_keys` | Short-lived OpenSSH certs | Gateway |
|---|---|---|---|
| **Onboarding** | User registers public key; it must then be installed on every server they can access. | User registers one or more public/device keys once. Servers are provisioned once with CA trust + server principal. | User is enrolled centrally; gateway decides access. Target setup depends on whether gateway jumps through or terminates SSH. |
| **Per-login issuance** | Usually none. The long-lived public key remains authorized. | Check Clerk + current Convex membership, then sign the user's public key for one server/profile and short lifetime. | Gateway checks identity/membership at connection time; it may still issue/use certs downstream. |
| **Private-key custody** | Individual model: user's private key remains with user. | User's private key remains with user; CA private key stays in isolated signer/HSM-like custody. OpenSSH can sign via PKCS#11/agent rather than exposing the CA key to every process. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com)) | If terminating SSH, gateway often becomes custodian of powerful downstream credentials, making it a high-value security boundary. A simple jump host need not. |
| **Multi-server users** | Distribution and removal are O(number of affected guests). | Very good fit: issue independent certificates per server on demand. | Very good if all routing is central, at cost of gateway dependency. |
| **Normal revocation** | Remove their public key from every server. Until each guest is updated, access remains. | Stop issuing immediately; already-issued certs naturally become unusable at expiry. | Refuse new gateway connections centrally, provided gateway is actually mandatory. |
| **Urgent pre-expiry revocation** | Remove key or add it to `RevokedKeys` on each reachable guest. | Add cert serial/key/key-ID to a KRL and distribute it to guests configured with `RevokedKeys`. OpenSSH's revocation lookup is a local file/KRL, not an online OCSP-style call. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config)) | Central if the gateway is the sole externally enforced path. Otherwise users can bypass it. |
| **Already-open SSH session** | Removing the key doesn't invalidate an already-authenticated session. | Certificate expiry/KRL update doesn't retroactively invalidate an established session. | A proxy/terminating gateway can potentially tear down a tracked transport, but that still does not undo processes or persistence created by root. |
| **Offline from control plane** | Existing keys work indefinitely. Revocation cannot arrive. | Excellent: guest verifies CA signature/principal/expiry locally. It need not contact your app. Urgent KRL changes cannot arrive, so expiry is the bound. | Guest need not reach Clerk/Convex if the gateway does, but gateway must remain able to reach the guest. |
| **Compromised user key** | Rotate/remove it everywhere. | Disable that enrolled public key for future issuance; wait for current certs to expire or push KRL. Enroll replacement key. | Disable user at gateway; rotate downstream credential if that credential itself was exposed. |
| **Ownership transfer** | Remove previous owner's key from every host. | Stop issuance based on changed membership; existing certs age out quickly. | Immediate refusal of new connections if gateway-only ingress is externally enforced. |
| **Rename** | Authentication key unaffected, but ordinary `known_hosts` treatment of the new hostname needs attention. | User certificate is completely unaffected because its principal is based on immutable server ID. | Routing record changes; authorization should still use immutable ID. |
| **Browser SSH** | Requires browser to solve private-key handling and host verification itself. | Browser can later become another certificate client. | Particularly natural later: browser can connect to gateway without redefining membership or server authorization. |
| **Operational concentration** | Low central dependency, high distributed-state burden. | Small CA/signer is sensitive, but guests remain independently usable. | Highest concentration: outage/compromise can affect the entire fleet. |

OpenSSH's standard `ProxyJump` illustrates why “gateway” needs qualification: it establishes an SSH connection to the jump host and then TCP-forwards to the ultimate destination. That by itself does **not** replace destination authentication or automatically become your authorization system. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-current/man5/ssh_config?utm_source=chatgpt.com))

So there are really two gateway designs:

**Jump/bastion:** transport chokepoint; end-to-end SSH authentication remains on the VPS. This combines nicely with certificates.

**Terminating/brokering gateway:** the gateway authenticates the person and creates a separate downstream SSH connection. This enables stronger central session controls but makes the gateway a custodian of extremely powerful credentials and changes your end-to-end trust model.

I would not introduce the latter until its extra properties are actually required.

---

## Why shared credentials are deceptively simple

One private key copied to every owner/write member looks simpler only during initial onboarding.

With individual keys, Alice can be revoked by deleting **Alice's** public key. With one shared private key, Alice's departure requires:

1. creating a replacement shared key;
2. replacing the authorized public key on every server;
3. securely redistributing the new private key to every remaining member;
4. confirming the old key is gone everywhere.

Until all four succeed, Alice can still possess the old credential. Authentication logs also cannot naturally distinguish Alice from Bob because both prove possession of the same key.

OpenSSH's authorization model is based on individually listed authorized public keys, and `RevokedKeys` likewise rejects particular keys/certificates. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config))

So **do not share member private keys**. A distinct sealed per-server break-glass credential is a separate recovery mechanism, not a normal team credential.

---

## `read` must not receive a credential with write authority

This must be a hard boundary.

If `read` can download a private key, certificate, gateway token, or other credential that SSH ultimately accepts for a root shell, then `read` actually has **write/root** access. The Convex role no longer matters once SSH authentication succeeds.

OpenSSH certificates can restrict things such as forwarding, PTYs, or force a specific command, but those are restrictions on the SSH session. A normal root shell is inherently not read-only. OpenSSH supports `force-command`, but that is appropriate for a deliberately constrained service, not for pretending that an unrestricted root login is read-only. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-6.4/ssh-keygen.1?utm_source=chatgpt.com))

If you later need genuine read-only machine access, create a **different OS access profile**: separate unprivileged Unix identity and tightly constrained commands/subsystems. Do not reuse the root credential.

### Proposed permission matrix

| Capability | Owner | Write | Read |
|---|:---:|:---:|:---:|
| View server metadata/status | ✓ | ✓ | ✓ |
| See public SSH host fingerprint/verification material | ✓ | ✓ | ✓ |
| Register/manage own SSH **public** device keys | ✓ | ✓ | ✓ |
| Request SSH certificate for root/write-capable profile | ✓ | ✓ | **No** |
| Rename server | ✓ | ✓ | No |
| Perform operational server mutations | ✓ | ✓ | No |
| Invite/remove members or change roles | ✓ | No | No |
| Transfer ownership | ✓ | No | No |
| Revoke another member's SSH eligibility | ✓ via membership/role | No | No |
| Obtain shared/root private key from application | **Never** | **Never** | **Never** |

A read member being allowed to register a public key is harmless by itself: a public key is not an authorization credential. The issuer simply refuses to produce a write-capable certificate for that membership.

---

## Revocation, expiry, and root need three separate meanings

This distinction should appear explicitly in your product/security contract.

**Credential revocation:** “This managed key/certificate will no longer authenticate for new connections.” Individual keys accomplish that after host configuration is changed; short-lived certificates achieve it after expiry or sooner if a reachable guest receives a KRL update. OpenSSH's `RevokedKeys` applies during public-key authentication. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config))

**Session termination:** “An already-authenticated SSH transport is closed.” Certificate expiry does not do this. OpenSSH validates authentication, then enters session mode; it does not continuously re-authenticate against certificate validity. Even OpenSSH's channel timeout documentation warns that terminating a session/channel does not necessarily remove related resources or even close every connection. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-6.1/sshd?utm_source=chatgpt.com))

**Undoing prior root access:** fundamentally different. Someone who had root could have, among other things, changed `authorized_keys`, altered `sshd_config`, added another CA, created users, scheduled jobs, installed services, copied host keys or secrets, modified binaries, or established another access channel.

Therefore:

> **Revoking a platform-managed SSH credential means the platform will no longer authorize that credential for managed future access. It does not prove that a person who previously possessed root can no longer access or influence that guest.**

You cannot honestly promise stronger revocation on a guest controlled by someone who had root. If strong post-transfer assurance is required, use an **out-of-band control plane you control** to isolate/reprovision the VPS from a known-good image and rotate relevant secrets. A gateway-only network path helps prevent new ordinary SSH ingress, but even that cannot erase persistent changes made while the person was root.

---

## Certificate expiry and offline guests

The short lifetime is particularly valuable because the guest does **not** have to call Clerk, Convex, or the signer every time somebody connects. `sshd` can validate the certificate using its locally configured CA public key, principal rules, and the certificate's validity interval. OpenSSH refuses a certificate presented outside its validity period. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

That gives you useful failure semantics:

- if Convex/Clerk/signer is temporarily unavailable, **new certificates cannot be obtained**;
- an already-issued 10-minute certificate may continue authenticating until its expiry;
- a guest disconnected from your management control plane can still authenticate an already-issued certificate;
- an emergency membership revocation cannot reach an offline guest before expiry unless you have another management path.

Short-lived certs therefore turn an unreachable guest from “revocation may never happen” into roughly “managed credential usefulness is bounded by the remaining certificate lifetime,” assuming the guest's clock remains trustworthy enough for validity checking.

---

## Host-key verification must be designed separately

Authenticating the human to the VPS is only half of SSH. The client must also know it reached the correct VPS.

Do not solve this with `StrictHostKeyChecking=no`.

At provisioning, capture the server host public key/fingerprint through a trusted provisioning/control-plane channel. The managed CLI can pin that identity. OpenSSH's standard known-host mechanism exists specifically to notice changed host keys; RFC 4255 likewise notes the MITM problem when users blindly accept first-seen fingerprints. ([RFC Editor](https://www.rfc-editor.org/info/rfc4255/?utm_source=chatgpt.com))

For your rename semantics, make the managed client's **host identity stable too**. OpenSSH has exactly the useful primitive: `HostKeyAlias` tells the client to use an alias instead of the connection hostname when storing/looking up host keys and validating host certificates. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-current/man5/ssh_config?utm_source=chatgpt.com))

So a generated client configuration can conceptually be:

```text
Host pretty-current-slug
    HostName pretty-current-slug.example
    HostKeyAlias <immutable-server-ssh-identity>
```

A rename changes `HostName`; the host-key identity doesn't change.

Later, host certificates are even cleaner. OpenSSH has distinct **user certificates** and **host certificates**, and clients may trust a host CA instead of pinning every individual host key. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

If users bypass your managed config and type arbitrary slugs directly into stock `ssh`, a host certificate may need the relevant DNS hostname(s) as principals. Because old slugs are permanent aliases, that principal set potentially grows. Using a managed stable `HostKeyAlias` avoids making rename history part of the core cryptographic identity.

SSHFP is another option, but it should only provide automatic trust when the DNS answer is authenticated with DNSSEC; RFC 4255 explicitly warns not to trust unauthenticated SSHFP records. ([RFC Editor](https://www.rfc-editor.org/info/rfc4255/?utm_source=chatgpt.com))

---

## On ownership transfer

For a transfer from Alice to Bob:

1. Update the Convex membership/owner relationship first. From that instant, Alice cannot obtain new certificates unless she remains an `owner`/`write` member.
2. Optionally push a KRL revoking Alice's outstanding certificate serials if the guests are reachable and you need revocation faster than the TTL.
3. A gateway, if present later, should terminate Alice's tracked active sessions.
4. **Do not claim this undoes Alice's previous root access.**

If Bob requires assurance against an untrusted former root operator, the meaningful recovery procedure is closer to **reprovision + secret rotation** than “remove Alice's SSH key.” That may include regenerating host keys if the previous root operator could have copied them.

The certificate CA itself normally does **not** need rotation on ownership transfer: Alice never receives its private key, and future issuance is controlled by current Convex membership.

---

## Rename behavior

Treat these as three different namespaces:

```text
serverId        immutable authorization identity
slug            mutable human/DNS locator
aliases[]       permanent historical locators
```

Renaming:

- does **not** change `serverId`;
- does **not** change the user-certificate server principal;
- does **not** change membership;
- does **not** invalidate outstanding certificates;
- adds the former slug to permanent aliases;
- updates current DNS routing;
- should not change host identity/host key;
- updates generated SSH client configuration only as a locator change.

That prevents cosmetic naming operations from becoming security events.

---

# Minimal recommended access contract

I would put roughly this contract behind the feature:

1. **Authentication:** SSH credential requests require a currently authenticated Clerk identity.
2. **Authorization:** the issuer re-checks the current Convex membership for the immutable `serverId`; only `owner` and `write` may receive credentials for the write/root SSH profile.
3. **Custody:** users generate/possess their own private keys. The service accepts public keys only and never returns a normal shared server private key.
4. **Issuance:** one short-lived user certificate is issued for one server and one access profile. Start with ~10 minutes.
5. **Scope:** certificate principal is based on immutable server identity, never current or historical slug.
6. **Auditability:** every cert gets a unique serial plus key ID referring to user, membership/device and issuance event.
7. **Guest trust:** provision `TrustedUserCAKeys`, explicit server-specific allowed principal(s), and a `RevokedKeys`/KRL location even if KRL distribution comes later. OpenSSH supplies each of these mechanisms. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config))
8. **Host authentication:** provision and record the host's public identity; managed clients verify it strictly using a stable host identity independent of slug.
9. **Revocation semantics:** membership removal stops issuance immediately; issued certificates remain potentially useful until expiry unless a KRL reaches the guest.
10. **Root disclaimer/recovery:** credential revocation does not undo earlier root actions. High-assurance recovery/ownership transfer may require externally controlled isolation and reprovisioning.

---

# Schema decisions to preserve now

These are difficult or dangerous to retrofit, so the current schema should leave room for them.

### Server identity

Keep an immutable canonical `serverId` unrelated to slug or provider hostname. Never recycle it.

Keep `currentSlug` separate from a historical alias table:

```text
serverAliases:
  serverId
  slug
  createdAt
  becameAliasAt
```

Permanent aliases should refer to the canonical server record rather than be copied server objects.

### SSH authorization identity

Either persist or deterministically derive—and version—the immutable:

```text
sshPrincipal
sshAccessProfile     // initially perhaps "root"
```

Do not derive either from slug.

Leave room for:

```text
sshAccessMode:
  direct
  gatewayOnly
  disabled
```

even if today only `direct` exists.

### Membership

Membership should have its own stable ID:

```text
membershipId
serverId
userId
role                 // owner | write | read
status
createdAt
revokedAt?
updatedAt
```

Certificate audit records should refer to `membershipId`, not reconstruct historical authorization from the user's current role.

### User/device public keys

Model these independently of servers:

```text
sshPublicKeyId
userId
publicKey
fingerprint
label
createdAt
revokedAt?
```

A person belonging to 50 servers should not need 50 copies of their public key.

Do **not** add a Convex field containing a shared SSH private key.

### Issuance/audit identity

Preserve the ability to record:

```text
issuanceId
certificateSerial
certificateKeyId
serverId
membershipId
userId
sshPublicKeyId
accessProfile
issuedAt
validAfter
validBefore
signerKeyVersion
revokedAt?
revocationReason?
```

You don't necessarily need a rich audit UI now, but unique serials and historical issuance records are much harder to reconstruct later. OpenSSH KRLs can use certificate serials/key IDs, making this operationally useful rather than merely audit metadata. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.4/ssh-keygen.1?utm_source=chatgpt.com))

### Host identity

Preserve independently of DNS:

```text
sshHostIdentityId
serverId
publicHostKeys / fingerprints
status
createdAt
rotatedAt?
```

Later this can become host-certificate state without changing what a server *is*.

### Recovery identity

Keep the cloud/provider instance identifier and whatever **out-of-band control-plane identifier** lets your system rebuild or isolate a guest independently of SSH and independently of its slug. This becomes the actual security boundary when a former root operator is considered hostile.

---

# What can wait

**Browser SSH can wait entirely.** Build the contract so a future browser is simply another client: it authenticates with Clerk, presents/generates a public key, obtains the same scoped certificate, and performs host verification—or reaches a later gateway.

A **gateway can wait** unless you already require one of: externally enforced “all SSH must pass here”, immediate central disconnection of active transports, centralized recording, private-network-only guests, or browser connectivity. Certificates and a gateway compose well later.

**Host certificates** can wait if your native client initially has robust fingerprint pinning through a stable `HostKeyAlias`. The schema should preserve host identity now so host CA adoption is painless.

**KRL distribution infrastructure** can wait if a ~10-minute worst-case managed-credential revocation window is acceptable. Configure/design for it now and keep certificate serials.

**Fine-grained read-only SSH**, hardware-backed user keys, source-IP certificate restrictions, session recording, forced maximum session lifetime, and advanced CA hierarchy can all wait.

What should **not** wait is the separation of immutable server identity from slug, per-membership authorization from authentication, public/private-key custody boundaries, server-scoped principals, host identity, and an honest recovery model for machines on which users may obtain root.

The result is a comparatively small first architecture: **native OpenSSH + user-owned keys + short-lived per-server certificates + strict host verification**, with Clerk/Convex deciding issuance. It scales to many-to-many users/servers, works reasonably with guests that are temporarily offline from your control plane, and leaves a clean path to both a gateway and browser SSH without making either one your foundational security model.
