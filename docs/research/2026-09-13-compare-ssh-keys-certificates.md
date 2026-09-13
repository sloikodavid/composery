# Compare SSH Keys Certificates

Source: https://chatgpt.com/share/6aa7061f-f2b0-83eb-bc35-2c6e1fb65890

---

**User**

Compare synchronized OpenSSH authorized keys with short-lived SSH certificates for a VPS service. Each connection belongs to a user on a specific server; initially every member has administrator access. Future connections may have narrower Linux permissions. Evaluate desktop-client compatibility, renewal without repeated login prompts, offline behavior, revocation versus active-session termination, signing-key protection, host verification, ownership transfer, and root users modifying the guest. Separately address AI-provider credentials stored on a shared remote server. Prefer primary sources and explain which guarantees require a gateway or guest agent.

---

**ChatGPT**

I’ll separate what OpenSSH itself guarantees from what your control plane must enforce. I’ll also distinguish “can’t open a new SSH session” from “an already-running shell is actually terminated,” since those are materially different guarantees.

---

**ChatGPT**

A key architectural point is already emerging: short-lived certificates substantially improve *new-connection* authorization, but they do not by themselves create centralized session control. If a user has root inside the VPS, guest-local SSH policy is ultimately mutable by that user unless enforcement sits outside the guest.

---

**ChatGPT**

The comparison is not simply “keys = old, certs = secure.” Synchronized keys win on universality and disconnected operation; certificates win on bounded stale authorization, auditable issuance, and expressing connection-time policy without copying each user’s key to every VPS. The hard boundary is root: once a member is root, neither guest-local scheme can remain authoritative against that member.

---

**ChatGPT**

For a VPS service where “who may SSH to which server” is a control-plane concept, I would make **short-lived OpenSSH user certificates the primary design**, while keeping synchronized `authorized_keys` as a compatibility/fallback path. Certificates give you a much cleaner long-term model for membership changes, per-server authorization, future roles, and auditability. But they do **not** solve active-session termination or protect the guest from someone who already has root; those guarantees require enforcement outside the guest.

## Comparison

| Property | Synchronized `authorized_keys` | Short-lived OpenSSH user certificates |
|---|---|---|
| Basic model | Push every authorized member's public key into the guest | Guest trusts a CA; control plane signs a user's existing public key for a limited validity and set of principals |
| Desktop compatibility | Best possible; essentially every SSH client supports public keys | Good but not universal. Native OpenSSH supports `CertificateFile`; PuTTY supports `-cert`; WinSCP has a separate “Certificate to use with the private key” setting. Clients implementing only plain-key auth may not work. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-current/man5/ssh_config?utm_source=chatgpt.com)) |
| Per-user private key | Remains on user's device | Same; the CA signs the public key, not the private key |
| Guest per-member state | One key entry per member/server/account | Normally only CA + authorization principals; no per-user key copying |
| Expiration | Keys normally remain valid until removed. Modern OpenSSH does support an `expiry-time=` option on an authorized-key entry, but that still leaves per-key guest state. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd?utm_source=chatgpt.com)) | Native certificate `valid-after` / `valid-before` window; expired cert is rejected during authentication. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com)) |
| Revoking a departed member | Remove key everywhere; effectiveness depends on sync reaching each VPS | Stop issuing certificates; maximum stale access for **new connections** is approximately the certificate TTL. KRLs can revoke particular serials/key IDs earlier, but the KRL itself must reach the VPS. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com)) |
| Offline VPS | Keeps accepting whatever keys were last synchronized, potentially indefinitely | Keeps accepting already-issued certs until they expire; after expiry it fails closed for new logins unless another cert can be obtained |
| Control plane down | Existing synchronized keys continue working | Existing certs continue working until TTL; renewal stops |
| User identity in logs | SSH key fingerprint can be correlated back to a user | Certificate can contain a signed key ID and serial; OpenSSH explicitly exposes certificate key ID `%i` and serial `%s`, and `ssh-keygen` describes the key ID as logged by the server. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com)) |
| Per-server scope | Natural, because you decide which server receives a key | Must be designed deliberately: a cert trusted by the same CA can otherwise be useful anywhere its principal is accepted |
| Future Linux roles | Requires different key lines/accounts/options and continual synchronization | Principals fit roles well, but certificates still cannot create Linux users/groups or sudo policy |
| Blast radius of central compromise | A compromised synchronization service can insert attacker keys into every reachable VPS | A compromised CA can mint certificates for every VPS trusting it, without modifying those VPSs |
| Instant logout | No | No |
| Survives malicious guest root | No | No |

OpenSSH's certificate model signs a public key together with identity information, principals, validity, and restrictions; the server can trust a CA using `TrustedUserCAKeys` and limit acceptable principals through `AuthorizedPrincipalsFile` or `AuthorizedPrincipalsCommand`. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

### A good certificate naming model

I would avoid issuing a generic certificate whose principal is simply `root` or `admin`. If the same CA is trusted by many VPSs, that creates unnecessary lateral scope.

Instead, make the cert server-specific, for example:

`vps:9f21...:admin`

and put that principal in the `AuthorizedPrincipalsFile` for the administrative Linux account on only that VPS. OpenSSH permits certificates to contain specified principals and requires a match against `AuthorizedPrincipalsFile` when configured. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

The certificate's key ID can separately carry immutable audit identity such as:

`user=12345;connection=abc123`

The principal answers **“what may this certificate log into?”**; the key ID answers **“who/which issuance was this?”**. Do not rely on key ID alone for authorization unless an `AuthorizedPrincipalsCommand` or other policy component actually validates it.

For future roles you can evolve to principals such as:

`vps:<id>:admin`  
`vps:<id>:operator`  
`vps:<id>:readonly`

and map them to distinct Linux accounts or policies.

That last part matters: an SSH certificate determines whether authentication succeeds; it does not replace Unix DAC, groups, sudoers, namespaces, SELinux, etc. If everyone continues logging in as the same UID—especially `root`—there is no meaningful Linux permission separation after authentication.

OpenSSH certificates can additionally prohibit forwarding, agent forwarding, X11, PTYs, user RC files, or force a command. The defaults are relatively permissive, so for a service-issued certificate I would normally start with `clear` and explicitly enable only what the connection type requires. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

## Renewal without repeatedly making the user log in

Vanilla OpenSSH knows how to **use** a certificate; it is not an OAuth/OIDC certificate-renewal client. `CertificateFile` simply points at a certificate corresponding to a private key, and OpenSSH can use the matching private key from a file, `ssh-agent`, PKCS#11 device, or security key. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-current/man5/ssh_config?utm_source=chatgpt.com))

So transparent renewal requires a small client-side component or SSH-agent integration. A practical flow is:

1. User signs into your VPS desktop/CLI once.
2. The application retains an appropriately protected service session/refresh credential.
3. Before SSH, or shortly before expiry, it submits the user's public key plus server/role request to your certificate service.
4. The service authorizes the user/server relationship and returns a new certificate.
5. The user's SSH private key never leaves their device.

PuTTY and WinSCP both understand a certificate supplied separately from its private key, which helps this design on Windows. ([PuTTY](https://puttyssh.org/0.78/htmldoc/Chapter3.html?utm_source=chatgpt.com)) Windows' OpenSSH implementation has also supported OpenSSH certificate authentication. ([GitHub](https://github.com/PowerShell/Win32-OpenSSH/wiki/Certificate-Authentication?utm_source=chatgpt.com))

The tradeoff is unavoidable: **silent certificate renewal requires some credential capable of requesting renewal**. If you require MFA/user presence every time, renewal cannot be invisible. If you store a long-lived refresh credential locally, protect it using the OS credential store and scope it so it can obtain only narrowly defined SSH certificates.

A workday-sized certificate—say several hours rather than several minutes—often gives the best UX/security balance. Very short five-minute certificates sound attractive but create a hard dependency on your issuance service and make third-party GUI-client integration substantially more cumbersome.

## Offline behavior

This is one area where synchronized keys have a legitimate advantage.

A completely disconnected VPS with previously synchronized keys can continue accepting them indefinitely. That is excellent availability but poor revocation behavior. Adding `expiry-time=` to entries can put a local upper bound on that, but someone must refresh the entries before their deadline. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd?utm_source=chatgpt.com))

Certificates give a more useful failure mode: an offline VPS can authenticate an already-issued certificate without contacting your control plane, because it only needs the trusted CA public key and its local clock. After the certificate expires, no new session can be established without another valid certificate. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

So certificate TTL is effectively your **maximum disconnected stale-authorization interval** for new sessions.

Neither approach necessarily requires an online per-login control-plane query. If instead you use `AuthorizedKeysCommand` or `AuthorizedPrincipalsCommand` to call your service on each login, you can make revocation almost immediate—but now login depends on that service being reachable. OpenSSH supports both command hooks. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

## Revocation is not session termination

This distinction is critical.

`RevokedKeys`, a removed `authorized_keys` entry, an expired certificate, or a changed principal affects a subsequent **authentication attempt**. OpenSSH's KRL mechanism can revoke keys or certificates by key, certificate serial, or key ID. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

None of those mechanisms continuously re-authenticates a shell that is already running.

Once authentication succeeds, SSH starts the user's command or shell and the established session continues until the connection/process ends. ([OpenBSD Manual Pages](https://man.openbsd.org/ssh?utm_source=chatgpt.com)) Thus:

**Remove membership at 10:00 → prevent new SSH connections quickly:** certificates handle this well, bounded by TTL or faster with KRL/online policy.

**Remove membership at 10:00 → terminate the shell they opened at 09:55:** neither keys nor certificates do this.

For reliable active termination you need one of two things:

| Mechanism | Can terminate existing SSH? | Trustworthiness against VPS root |
|---|---:|---:|
| Guest daemon/agent tracks sshd sessions and kills them | Yes | Weak: guest root can stop, patch, or bypass it |
| External SSH/TCP gateway through which all SSH flows | Yes, by closing the transport | Stronger: user root inside VPS cannot modify the gateway |
| Direct Internet SSH + guest-local cert/key checks | No centralized kill | None |

If session termination is an actual product guarantee, force port 22 through a **provider-controlled gateway or network layer** and prevent direct Internet access to guest SSH. Then disabling a connection can close the gateway-side TCP/SSH flow even if the user controls the guest.

A guest agent is still useful operationally—provisioning accounts, sudo rules, principals and terminating cooperative sessions—but it is not a security boundary against root.

## Root changes the answer

Initially giving every member administrator/root access means you should assume any authorized member can, while authorized:

- add another public key;
- add another trusted SSH CA;
- alter `sshd_config`;
- enable password authentication;
- replace `sshd` or PAM components;
- create a new privileged user;
- install a reverse shell or daemon;
- modify or disable your guest agent;
- erase or forge guest-side audit logs.

`sshd_config` itself is simply a root-owned configuration file; being root is precisely the authority required to change it. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

Therefore **neither synchronized keys nor SSH certificates can give you “the control plane remains authoritative even after this person has had root”**.

That requires an enforcement boundary root does not control: provider SDN/firewalling, hypervisor-side console/access control, an SSH gateway, or rebuilding from trusted state.

It also means externally retained gateway/control-plane logs are much more defensible than relying on `/var/log/auth.log` inside a VPS whose users are administrators.

## Ownership transfer

Treat VPS ownership transfer as a security-domain change, not merely “change the member list.”

With synchronized keys, remove the old users' keys, but an old root owner could already have installed a second key somewhere else or modified the OS.

With certificates, stop issuing the old owner certs, but an already-issued certificate remains useful until expiry unless revoked. Worse, the old root owner could have changed the guest's CA configuration entirely.

For certificate scoping, an **ownership epoch** is useful, for example:

`vps:<server-id>:owner-epoch:17:admin`

Increment it on transfer so old certificates are no longer valid against the new authorized principal. But updating that file inside a guest previously controlled by the old owner is not enough to establish trust.

If you need a strong guarantee that the prior owner no longer has access after a transfer, the safe operation is a provider-controlled rebuild/reprovision from trusted state, or otherwise a measured immutable guest model. Rotate the host key, application secrets, cloud/workload credentials, and any other credentials the previous administrator could have copied.

If you transfer the existing mutable root filesystem untouched, you cannot prove that a previous root user left no persistence behind.

## Protecting the SSH signing key

Certificates consolidate trust, so the CA becomes critical infrastructure.

OpenSSH supports signing with a CA key held in a PKCS#11 token, and also supports signing through an `ssh-agent` rather than exposing the private CA file directly to the signing process. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

For a VPS service I would keep the SSH user CA:

- completely off guest VPSs;
- inaccessible to the ordinary API/web application;
- behind a narrowly scoped signing service;
- ideally backed by an HSM or hardware-backed signing mechanism;
- separated from the **host** CA;
- partitioned enough that one key does not necessarily authorize your entire fleet.

An important operational difference is blast radius. With key synchronization, compromise of your provisioning service lets an attacker push an attacker key into servers it can reach. With a CA, compromise of the signing authority allows attacker certificates to be generated without any guest modification at all.

Keep issuance audit records including certificate serial, key fingerprint, user ID, VPS ID, requested role, validity interval and the authorization decision.

## Host verification is a separate PKI problem

User certificates authenticate **the user to the VPS**. They do nothing to prove that the VPS is the correct machine.

Do not weaken `StrictHostKeyChecking` simply because user auth is certificate-based. OpenSSH normally keeps known host keys and warns on host-identity changes specifically to protect against impersonation/MITM. ([OpenBSD Manual Pages](https://man.openbsd.org/ssh?utm_source=chatgpt.com))

At VPS-service scale, an SSH **host CA** is cleaner than asking every customer to confirm fingerprints. OpenSSH host certificates contain hostname principals and can be trusted through a CA entry in known-host configuration; OpenSSH explicitly supports host certificates separately from user certificates. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com)) PuTTY and WinSCP also support trusted host certification authorities. ([WinSCP - Free SFTP and FTP client](https://winscp.net/eng/docs/ui_pref_security?utm_source=chatgpt.com))

Use different keys for:

`User SSH CA` → signs customer login certificates.

`Host SSH CA` → signs VPS host keys.

Guest root will normally be able to read/copy the guest's host private key, so on an ownership transfer or reprovision I would generate a fresh host key and obtain a fresh host certificate. The **host CA private key must never live in the guest**.

## Future narrower permissions

Certificates are the better substrate, but the permission mechanism is Linux, not the cert itself.

If the eventual product is “David is admin, Alice is read-only, Bob can deploy but not read secrets,” you need actual distinct execution identities or policy enforcement. That may mean per-user Unix accounts, groups, sudoers, container namespaces, forced commands, or similar.

A guest provisioning agent can translate control-plane state into:

`user → local UID/groups/sudo policy → accepted certificate principals`

OpenSSH's `AuthorizedPrincipalsCommand` can also make dynamic decisions and receives useful inputs including target username, cert key ID, serial and fingerprint. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

But again, if an administrator retains unrestricted root, that administrator can rewrite those controls. A guest agent gives you management convenience, not isolation from root.

## AI-provider credentials on a shared VPS

Treat this separately from SSH credentials.

If several users have root on the same VPS, **a bearer AI API key stored anywhere on that VPS must be considered available to all of them**. Putting it in `/root/.env`, an environment variable, Docker secret, root-only file, or a local secret-manager agent does not protect it from another root administrator. Root can normally inspect files, processes, service configuration and runtime state.

OpenAI's current guidance says API keys are secrets, should be loaded from an environment variable or key-management service, and should not be shared; it also supports project-scoped service accounts/keys and restricted key permissions. ([OpenAI Platform](https://platform.openai.com/docs/api-reference/backward-compatibility?lang=ruby&utm_source=chatgpt.com)) OpenAI also now recommends expiry/rotation for project keys and supports expirations on project keys. ([OpenAI Help Center](https://help.openai.com/en/articles/5112595-best-practices-fo?utm_source=chatgpt.com)) These are valuable controls, but none turn a secret present on a root-controlled machine into a secret *from that root user*.

For a shared-root VPS service, the strongest design is therefore:

**VPS → your external AI gateway → AI provider**

The VPS authenticates to your gateway with a per-user/per-instance short-lived credential; your gateway holds the actual upstream AI-provider credential. The gateway can enforce user identity, VPS ID, allowed model/API, quotas, spend limits, revocation and audit without exposing the provider bearer key inside the guest.

Where a provider offers true temporary workload credentials, prefer those. AWS, for example, explicitly recommends dynamically generated temporary credentials for Bedrock and IAM workloads rather than long-lived access keys. ([AWS Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_service-with-iam.html?utm_source=chatgpt.com))

Even short-lived workload credentials exposed to arbitrary guest root can be stolen and used during their remaining validity, so if **“root must not be able to impersonate the service outside this VPS”** is a hard requirement, the sensitive operation has to move outside the guest or use hardware-backed workload identity plus an external policy boundary.

## Recommended architecture

I would build toward this:

1. **Short-lived OpenSSH user certs as the default**, signed only after checking current membership and requested server/role. Use server-specific principals and a signed user/connection identifier.
2. **A desktop helper/agent** handles renewal and keeps the user's existing private key local. Keep synchronized public-key access only as a compatibility mode for clients lacking OpenSSH-certificate support.
3. **Separate host CA** for trustworthy VPS host verification and painless host-key rotation.
4. **Provider-controlled SSH gateway/network path** if you promise immediate access revocation, active-session kill, or tamper-resistant connection auditing.
5. **Guest provisioning agent** for Unix users/groups/sudo/principals as permissions become narrower—but do not describe that agent as protection against root.
6. **Rebuild or otherwise re-establish trusted state on ownership transfer**; simply changing control-plane membership is not enough after the previous owner had root.
7. **Never put a valuable shared AI-provider master credential on a multi-admin/root VPS.** Keep it in an external service and issue scoped/short-lived access to that service.

The key dividing line is: **SSH certificates improve authentication lifecycle; a gateway creates an externally enforceable access boundary.** If you need the provider to remain authoritative after giving customers root, the latter is the important architectural component.
