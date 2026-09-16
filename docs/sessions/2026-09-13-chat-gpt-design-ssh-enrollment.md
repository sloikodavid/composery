# Design SSH Enrollment

Source: https://chatgpt.com/share/6aa70d10-4a8c-83ed-843b-76fcb2ba7e2f

---

## Turn 1: User

_2026-09-13T20:36:46.163Z_

Design SSH enrollment and credential revocation for a user-controlled VPS product. Copying a prompt creates a short-lived, single-use bearer enrollment secret; no additional browser approval is required. The client generates its private key locally. Credentials belong to server memberships, multiple credentials may authorize the same Unix account, and all initially grant full server access. Users may replace the OS or remove managed configuration; degraded functionality must be reported honestly. Compare authorized_keys synchronization, AuthorizedKeysCommand, OpenSSH certificates with automatic renewal, and an external SSH gateway. Ground each in primary documentation and real implementations. Explain credential-level restrictions, membership ceilings, offline behavior, revocation latency, existing SSH transports and multiplexed sessions, host verification, and recovery after guest modification. Recommend the smallest complete approach; do not assume a gateway or guest agent is necessary.

---

## Turn 2: ChatGPT

_2026-09-13T20:36:47.444Z_

I’ll treat this as a control-plane/guest-boundary design, not just an SSH-key choice. I’m going to compare the four mechanisms against revocation semantics, transport/session behavior, and what remains true after the customer changes the guest OS or SSH configuration.

---

## Turn 3: ChatGPT

_2026-09-13T20:37:20.345Z_

A key distinction is emerging: all guest-side schemes revoke at **the next SSH authentication**, not necessarily the next shell. OpenSSH can multiplex multiple channels over one already-authenticated connection, and `ControlPersist` can keep that connection alive after the visible shell exits, so deleting a key or expiring a cert does not by itself terminate that transport.

---

## Turn 4: ChatGPT

_2026-09-13T20:37:44.854Z_

Another important constraint is **server binding** for certificates. A user certificate signed by a CA trusted on many VPSes is not inherently tied to one VPS; OpenSSH user-certificate principals are login identities, not destination hosts. For server-scoped memberships, use a per-server CA (or a server-specific authorized-principal check/file), otherwise a cert valid for `root` could be accepted by another server trusting the same CA. OpenSSH’s principal and CA rules make this an authorization-design issue, not just a signing detail.

---

## Turn 5: ChatGPT

_2026-09-13T20:39:32.906Z_

## Recommendation

Use **short-lived OpenSSH user certificates with client-side automatic renewal**, backed by the server membership model you already need. Configure each VPS once with the product’s user CA plus a **server-and-Unix-account-specific principal**, then let the client renew certificates against the control plane using proof of possession of its locally generated private key.

This is the smallest design that gives you bounded credential revocation **without requiring continuous key synchronization, a guest agent, an online `AuthorizedKeysCommand`, or an SSH gateway**. OpenSSH natively supports certificate principals, validity periods and restrictions; Vault, Smallstep and Teleport are real deployments of the same basic model. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-current/man1/ssh-keygen.1?utm_source=chatgpt.com))

I would make the contract explicit: **revocation prevents certificate renewal immediately and prevents new SSH authentication no later than the maximum remaining certificate lifetime. It does not terminate an already-authenticated SSH transport.** If you eventually need sub-minute hard revocation of live transports, that is the point at which an online authorization component or gateway becomes justified.

## Data and enrollment model

Make a `server_membership` the authorization object:

`membership = {user, server, unix_account, ceiling, state}`

and make credentials children of it:

`credential = {membership_id, public_key, fingerprint, restrictions, state, created_at, last_used_at}`.

Multiple credentials can belong to the same membership and therefore authorize the same Unix account. Revoking credential A has no effect on credential B. Disabling the membership disables renewal/authorization for all its credentials. The effective rights are always:

**membership ceiling ∩ credential restrictions ∩ server/sshd/Unix-account policy.**

Initially, set each credential's restrictions to “no additional restriction”, meaning it gets the membership's full access to the configured Unix account. Do not interpret “full access” as overriding `sshd_config` or Unix permissions.

The Copy action should mint an opaque high-entropy enrollment capability bound to exactly one membership. I would use about 256 bits of randomness, a roughly five-minute TTL, and store only an HMAC/hash of it. Never put it in URLs, analytics, application logs, or crash reports. Because you have deliberately chosen **bearer enrollment with no second browser approval**, possession of an unredeemed token is sufficient to enroll an attacker's key. No protocol trick removes that property; short lifetime, single use, narrow scope and auditing are the right mitigations.

The client generates an Ed25519 key locally and sends the enrollment token, public key, a label, and a signature over a server nonce. The signature proves that the redeemer actually possesses the corresponding private key; it does **not** make a stolen bearer token safe, because a thief can generate their own key and redeem the token first.

Consumption should be atomic. A race between two different public keys has exactly one winner. A retry of the winning request after a lost HTTP response can safely return the already-created credential, so network retries are idempotent without permitting a second enrollment.

For the certificate design, successful enrollment can immediately issue the first short-lived certificate. Subsequent renewal does **not** use the enrollment token. The client signs a fresh control-plane challenge with the credential's private key; the signer checks that both membership and credential are active, computes their current authorization intersection, and returns a fresh certificate.

## Comparing the four approaches

| Approach | Guest requirement | New-SSH revocation | Offline behavior | Already-open SSH transport | Guest replacement |
|---|---|---|---|---|---|
| synchronized `authorized_keys` | Writable managed file + some reconciliation mechanism | After next successful sync | Excellent: last keys keep working indefinitely | Unaffected | Management lost/stale |
| `AuthorizedKeysCommand` | `sshd_config` + helper | Essentially control-plane propagation latency | Must choose fail-closed or cached/stale authorization | Unaffected | Management lost; usually managed login fails |
| short-lived certificates | Static CA/principal config | Bounded by remaining cert TTL; optional KRL can shorten it | Server needs no control plane; client can use unexpired cert | Unaffected | Managed cert login lost if config disappears |
| external SSH gateway | Network path forced through gateway | Near-real-time | Gateway outage generally means no managed access | Gateway can actively terminate it | Can remain authoritative only if guest cannot bypass gateway path |

### `authorized_keys` synchronization

This is the simplest conceptual mechanism. OpenSSH accepts key-specific options in `authorized_keys`, including `restrict`, forced commands, source-address constraints, forwarding limits and key expiry. That makes credential-level restrictions straightforward. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd?utm_source=chatgpt.com))

A sensible implementation would keep product keys in a dedicated root-owned file rather than rewriting the customer's own `~/.ssh/authorized_keys`, for example through an `AuthorizedKeysFile` configuration containing both the customer's file and `/etc/your-product/authorized_keys/%u`. Generate the entire managed file from desired state and atomically replace it. OpenSSH explicitly supports multiple authorized-key files. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

GitLab is a useful real implementation: its non-fast-lookup architecture keeps an `authorized_keys` file current using an `AuthorizedKeysWorker` whenever a user's SSH key changes. GitLab also documents why it eventually added database lookup: very large files are linearly searched and frequently changing keys cause synchronization/I/O costs. ([GitHub](https://github.com/gitlabhq/gitlabhq/blob/master/doc/development/architecture.md?utm_source=chatgpt.com))

Its major benefit is availability. Once synchronized, login requires neither your control plane nor your CA. Its major weakness is revocation semantics: “revoked in the database” and “removed from the VPS” are separate events. If the guest is unreachable or the customer removed your reconciliation mechanism, the credential remains effective. The UI must therefore distinguish **Revoked in control plane** from **Removal confirmed by server**.

It also doesn't actually eliminate a guest-management mechanism. Cloud-init can initially add authorized keys, but its SSH module is a once-per-instance facility; ongoing revocation needs something else to update the file. ([Cloud-Init](https://cloudinit.readthedocs.io/en/stable/reference/yaml_examples/ssh.html?utm_source=chatgpt.com))

### `AuthorizedKeysCommand`

This moves the authorization decision from synchronization time to authentication time. `sshd` invokes a root-owned helper, which emits zero or more lines in `authorized_keys` format, so the returned result can contain the same credential-level restrictions. OpenSSH specifies that the command is run for valid users and is consulted after the normal `AuthorizedKeysFile`; if a normal file already contains a matching key, the command is not consulted. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

That last detail matters: never leave a managed key simultaneously in the ordinary authorized-keys file and assume your command can revoke it.

Google Compute Engine's OS Login is a strong real implementation. Its `google_authorized_keys` helper is configured as `AuthorizedKeysCommand`, queries Google's metadata service, asks whether the user is authorized, and returns the user's keys to `sshd`. ([GitHub](https://github.com/GoogleCloudPlatform/guest-oslogin?utm_source=chatgpt.com)) GitLab similarly supports `AuthorizedKeysCommand` to do an indexed database lookup rather than maintain a giant file. ([GitLab Docs](https://docs.gitlab.com/administration/operations/fast_ssh_key_lookup/?utm_source=chatgpt.com))

This can deliver very fast revocation of **new authentication** with no long-running guest agent. In a VPS product, it becomes particularly attractive if you already expose a reliable link-local metadata service: the helper can query that instead of depending on arbitrary Internet connectivity.

The cost is an online decision in the SSH login path. If the backend is unavailable you must choose between denying login or accepting cached results. Fail-closed provides strong revocation but can lock customers out during your outage. Caching improves availability but turns cache TTL directly into revocation latency. There is no way to simultaneously obtain indefinite offline login and instantaneous centrally controlled revocation.

### Short-lived OpenSSH certificates

This provides the cleanest separation between a long-lived **credential identity**—the locally held private key—and short-lived **authorization** issued by your control plane.

OpenSSH certificates contain principals, validity intervals and signed restrictions. Standard certificate options support source-address constraints, forced commands, and disabling PTY, agent, X11 and port forwarding. Certificates presented outside their validity interval are rejected. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-current/man1/ssh-keygen.1?utm_source=chatgpt.com)) Vault demonstrates the exact local-key pattern: the workstation generates/holds its private key, submits the public key for signing, and the server trusts the CA through `TrustedUserCAKeys`. ([HashiCorp Developer](https://developer.hashicorp.com/vault/docs/secrets/ssh/signed-ssh-certificates?utm_source=chatgpt.com)) Smallstep demonstrates a client that transparently obtains certificates alongside ordinary OpenSSH workflows, while Teleport uses short-lived certificates as the core of its authentication architecture. ([Smallstep](https://smallstep.com/docs/ssh/how-it-works/?utm_source=chatgpt.com))

There is one subtle but important VPS-specific issue: **do not issue a fleet-wide certificate whose only principal is `root`, `ubuntu`, etc.** If many servers trust the same user CA, that certificate is potentially useful on every server where that Unix username is accepted.

For the smallest deployment, keep one protected signing CA but install a static principal mapping on each VPS. For example, `/etc/your-product/ssh-principals/root` contains only:

`vps:<server-id>:unix:root`

and `AuthorizedPrincipalsFile` points to `/etc/your-product/ssh-principals/%u`. Issue the user's certificate with that server-specific principal and **do not additionally put `root` in the certificate**. OpenSSH explicitly supports using `AuthorizedPrincipalsFile` with a trusted user CA; when it is present, an allowed principal from that file must appear in the certificate. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

That gives you server/account scoping without a per-server CA and without looking up membership state from the guest. The certificate `key_id` can contain an opaque credential ID for auditing.

I would use approximately a **10-minute certificate TTL**, backdated slightly for clock skew, with the client refreshing opportunistically before SSH—say when less than a few minutes remain. Smallstep's tooling is a precedent for checking certificate lifetime as part of the client SSH path. ([Smallstep](https://smallstep.com/docs/step-cli/reference/ssh/needs-renewal/?utm_source=chatgpt.com)) A revoked credential immediately becomes ineligible for renewal; its last certificate remains useful only until its signed expiry.

OpenSSH also supports KRLs capable of revoking certificates by serial or key ID, and `sshd` supports a `RevokedKeys` KRL. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com)) I would **not make KRL distribution part of the minimum architecture**, because doing so recreates the synchronization problem certificates are eliminating. It can be a later emergency fast-revocation feature when guest management is healthy.

The availability tradeoff is predictable: the VPS can be entirely offline from your control plane and still validate certificates locally. The client can also connect while disconnected from your control plane as long as it has an unexpired certificate. Once that certificate expires, it needs the signer again. That is much cleaner than an indefinite stale authorization cache.

### External SSH gateway

A gateway gives the strongest centralized control only if it is actually on the mandatory path. Teleport's agentless OpenSSH mode, for example, has its Proxy Service terminate the user's SSH connection, perform RBAC, establish a separate connection to the OpenSSH server, and proxy between them. Teleport explicitly configures the OpenSSH server to trust the proxy rather than direct users. ([Teleport](https://goteleport.com/docs/enroll-resources/server-access/openssh/openssh-manual-install/?utm_source=chatgpt.com))

This architectural position lets a gateway revoke a user and actively destroy existing connections. Teleport's locking mechanism rejects new connections and terminates already-established affected sessions; its documentation explicitly contrasts this with relying only on short-lived certificate expiration. ([Teleport](https://goteleport.com/docs/reference/architecture/authentication/?utm_source=chatgpt.com))

But those benefits disappear if `server-ip:22` remains an uncontrolled bypass path. To claim gateway-enforced revocation, networking must ensure the guest's SSH endpoint accepts only the gateway, or otherwise force customer traffic through it. That is a material VPS networking feature, not an SSH credential implementation detail.

A gateway also changes failure domains and offline behavior: if the gateway/control plane is unavailable, managed access usually goes down. Cloudflare's current infrastructure SSH product illustrates the additional pieces such an architecture brings—network connectors, policy, a proxy path and short-lived credentials. ([Cloudflare Docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/ssh/ssh-infrastructure-access/?utm_source=chatgpt.com))

For this product, that is unjustified complexity unless centralized session termination, auditing, network hiding or command/session policy becomes a requirement.

## What “revoked” means for an existing connection

This deserves explicit product language.

SSH authenticates a **transport**, then multiplexes channels over it. RFC 4254 specifies that terminal sessions and forwarded connections are channels and that multiple channels are multiplexed over one connection. ([RFC Editor](https://www.rfc-editor.org/info/rfc4254/?utm_source=chatgpt.com)) OpenSSH's `ControlMaster`/`ControlPersist` can leave such a master connection alive in the background for subsequent `ssh` invocations, and `sshd` normally permits multiple session channels per connection. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-5.8/ssh_config.5?utm_source=chatgpt.com))

Consequently, after Alice's credential is revoked:

**A new TCP/SSH authentication** should fail according to the chosen revocation mechanism. But an existing authenticated SSH transport remains authenticated. Alice may be able to open another shell or forwarding channel through a pre-existing multiplexed master connection without presenting her now-revoked credential again.

Certificate expiration behaves the same way. It is checked when the certificate is used to authenticate; ordinary OpenSSH does not transform certificate expiry into a mid-session kill timer.

So the direct-SSH product promise should be along the lines of: **“Revocation blocks future SSH authentication after the stated propagation/expiry window. Existing SSH connections are not terminated.”**

If hard termination becomes necessary, you need something that owns or can locate that live transport: a gateway such as Teleport, or guest-side session tracking and process termination. Setting `MaxSessions=1` reduces shell multiplexing but does not turn key revocation into transport revocation and is not a substitute.

## Restrictions and membership ceilings

For synchronized keys and `AuthorizedKeysCommand`, prepend OpenSSH key options to the particular credential's returned line. `restrict` is a useful deny-by-default primitive and can selectively re-enable PTY or forwarding; `command=`, `from=`, `permitopen=` and `permitlisten=` provide narrower capabilities. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd?utm_source=chatgpt.com))

For certificates, derive signed options from the same authorization object. A client may request a narrower certificate, but must never be able to request something broader than its credential or membership. Certificate critical options and extensions are integrity protected by the CA; OpenSSH rejects unknown critical options whereas unknown extensions may be ignored, so security-critical custom semantics should not be invented as optional extensions. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.4/ssh-keygen.1?utm_source=chatgpt.com))

There is also a fundamental ceiling to what any SSH-auth restriction can promise. Once a credential obtains an unrestricted shell as `root`, or as a user with unrestricted `sudo`, that user can alter `sshd`, add another key, disable your managed configuration or replace the OS. Credential revocation still revokes **your managed credential**, but it does not retroactively prevent the VPS owner from having created a second unmanaged access path. Do not describe this as “the user can no longer access the server.”

## Host verification is separate

User certificates solve client authentication. They do not authenticate the VPS to the client.

For direct SSH, leave normal host-key verification intact. `StrictHostKeyChecking=accept-new` at least accepts first use but refuses subsequent changed host keys; strict pinning is stronger. Do not solve provisioning friction with `StrictHostKeyChecking=no`. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.7/ssh_config.5?utm_source=chatgpt.com))

If your provisioning system has a trustworthy way to obtain each newly generated guest host public key, a **host CA** is better. OpenSSH supports host certificates, and Vault's SSH documentation demonstrates signing a host public key and placing the host CA in the client's `known_hosts` as `@cert-authority`. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-6.8/ssh-keygen.1?utm_source=chatgpt.com))

After a customer intentionally reinstalls the OS, a new host key is expected. The client should report that identity changed and require an explicit product-level host-identity reset or a newly product-signed host certificate. Never silently turn a host-key mismatch into success.

For a terminating gateway, the trust boundary changes: the SSH client authenticates the gateway-facing SSH endpoint and the gateway must independently authenticate the backend VPS. A pure TCP tunnel is different—the end user's SSH client still sees and verifies the VPS's host key.

## Guest modification and recovery

Every guest-side solution is ultimately advisory on a user-controlled VPS. The owner can remove your `TrustedUserCAKeys`, principal file, `AuthorizedKeysCommand`, managed authorized-key file, `sshd` itself, the network stack, or the entire OS.

Model that explicitly. Keep separate **desired credential state** and **observed integration state**. After revocation, a certificate credential can truthfully say something like “revoked; no further certificates will be issued; previously issued certificate may remain valid until 14:32 UTC.” A synchronized key should instead say “revoked in control plane; removal from server pending” until the guest acknowledges the new generation. If the last observation becomes stale or the integration disappears, call the server **degraded/management status unknown**, not healthy.

Recovery should exist outside normal SSH. A provider-controlled serial console, rescue environment, disk repair path or rebuild mechanism is the appropriate trust layer. AWS's serial-console architecture is a useful precedent: its console connection is independent of the instance VPC so it can be used even when guest networking is broken. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configure-access-to-serial-console.html?utm_source=chatgpt.com)) Your equivalent recovery mechanism can reapply the small SSH integration or let the customer fix it themselves without requiring possession of an already-working managed SSH credential.

## The smallest complete design

I would therefore ship **native OpenSSH + short-lived user certificates**:

The guest has only static OpenSSH configuration: your user CA and one server/account-specific allowed principal. There is no daemon, polling agent, gateway, continuously synchronized key list, or authentication-time call from `sshd` to your service. The existing enrollment client generates and retains the private key, registers its public half using the single-use enrollment bearer, and automatically gets/renews roughly ten-minute certificates. Credential revocation stops renewal; membership revocation stops renewal for all credentials belonging to that membership. The maximum new-connection revocation latency is the remaining certificate lifetime plus whatever clock-skew allowance you intentionally sign.

This is also the cleanest fit with the fact that multiple credentials may represent one membership: the membership controls **whether and for what server/account a certificate may be issued**, while each credential independently proves possession of its own private key.

I would choose `AuthorizedKeysCommand` instead if the business requirement becomes “new logins must stop within seconds” and you already have a highly available link-local metadata service—the Google OS Login architecture demonstrates that pattern well. I would choose synchronized `authorized_keys` instead if **control-plane outages must never prevent SSH**, accepting that revocation becomes an eventually-consistent guest operation. I would add a gateway only when you actually need **hard termination of established transports, mandatory central auditing, or network-level access enforcement**. Those are valuable properties, but they do not need to be prerequisites for a sound VPS SSH enrollment and credential-revocation system.
