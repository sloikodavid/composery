# Investigate SSH Certificate Renewal

Source: https://chatgpt.com/share/6aa74934-53b0-83eb-b3b1-891288fe274e

---

**User**

Investigate whether short-lived OpenSSH user certificates can renew transparently after one-time bearer enrollment, without repeated browser login. Target ordinary ssh, scp, sftp, rsync, Git, and editor remote workflows across Windows, macOS, and Linux. Examine maintained implementations such as Smallstep. Identify exactly what must be installed, how renewal is invoked, what credential authorizes renewal, behavior with parallel clients and SSH multiplexing, outages, and uninstall. Distinguish documented functionality from proposals. Compare this complete client burden against installed public keys with guest-side revocation. Recommend certificates only if the user experience and operational cost justify them.

---

**ChatGPT**

I’ll trace this from the client workflow outward: maintained SSH-certificate implementations (starting with Smallstep), the exact renewal mechanism and authorization credential, then how that interacts with OpenSSH-based tools, multiplexing, outages, and uninstall on Windows/macOS/Linux. I’ll separate what is documented today from design proposals, then compare the full endpoint burden against ordinary authorized_keys plus guest-side revocation.

---

**ChatGPT**

The first decisive finding is that Smallstep’s documented “renew” command does **not** renew SSH user certificates at all; it is host-certificate-only. Their supported end-user flow instead obtains a fresh user certificate, and the hosted SSH product explicitly says the browser SSO happens again after expiry. 

I’m now checking the stronger variant of your question: whether a one-time bearer can bootstrap a durable machine credential that silently authorizes *fresh issuance* of user certificates (not protocol-level renewal), and whether any maintained client actually wires that into unmodified OpenSSH workflows.

---

**ChatGPT**

The source confirms an important outage characteristic that the high-level docs don’t spell out: Smallstep’s generated client path is not “use the cached cert offline until it expires.” `Match exec "step ssh check-host %h"` calls the CA/host registry, and `step ssh proxycommand` also contacts the CA to fetch SSH roots before deciding the agent already has a usable cert. A fresh transport can therefore fail during a CA/control-plane outage even while a still-valid user cert sits in `ssh-agent`. 

That is materially worse availability than plain installed public keys unless you deliberately replace the generated config with a local-only certificate selection/renewal shim.

---

**ChatGPT**

## Conclusion

For **human users**, I would **not choose short-lived OpenSSH user certificates if the requirement is “enrol once with a bearer token, then ordinary SSH tools keep working indefinitely without another browser login.”** None of the maintained implementations I examined provides that complete experience as a supported human-user workflow.

Smallstep comes closest to transparent use of ordinary OpenSSH, but its documented model is explicitly **periodic SSO**: after the user certificate expires, the next SSH connection invokes the browser again. More importantly, Smallstep does **not** renew SSH user certificates. Its transparent path obtains a **new keypair and a newly signed user certificate**. `step ssh renew` is host-certificate-only, and Smallstep's provisioner documentation states that SSH user certificates are deliberately non-renewable. ([Smallstep](https://smallstep.com/docs/ssh/how-it-works/?utm_source=chatgpt.com))

It is possible to build what you describe by exchanging the one-time bearer for a durable device credential—e.g. an X.509 certificate/private key—and using that credential indefinitely to request fresh SSH certificates. Smallstep exposes enough primitives to do this. But that is a **custom device-identity/renewal system**, not the documented SSH-user product. Once you account for the daemon, durable secret, locking, outage handling, multiple SSH implementations on Windows, config cleanup, and revocation of that durable credential, its client burden is comparable to or worse than simply installing an SSH public key and doing guest-side revocation.

### What maintained products actually provide

| Implementation | Human, one browser login forever? | What authorizes the next SSH cert? | Transparent ordinary OpenSSH? |
|---|---|---|---|
| **Smallstep SSH / OIDC** | **No.** Browser authentication happens again after expiry. | A newly obtained OIDC bearer token. | Yes, via `ssh-agent` plus injected `ProxyCommand`, subject to caveats below. ([Smallstep](https://smallstep.com/docs/ssh/how-it-works/?utm_source=chatgpt.com)) |
| **Smallstep one-time `--token`** | **No.** | The token is explicitly a **one-time** token for certificate creation. It leaves no documented renewable human session behind. ([Smallstep](https://smallstep.com/docs/step-cli/reference/ssh/login/?utm_source=chatgpt.com)) | Only for that issued certificate's lifetime. |
| **Smallstep X5C composition** | **Possible with custom automation**, not a supported transparent human-renewal workflow. | Persistent X.509 certificate + its private key. | You must build the refresh/agent integration yourself. ([Smallstep](https://smallstep.com/docs/step-cli/reference/ca/token/?utm_source=chatgpt.com)) |
| **Teleport normal user** | **No.** Regular users normally obtain a new auto-expiring certificate, typically daily. | Interactive Teleport authentication. | Teleport supports OpenSSH export, but the regular-user model still requires reauthentication. ([Teleport](https://goteleport.com/docs/connect-your-client/teleport-clients/tsh/?utm_source=chatgpt.com)) |
| **Teleport `tbot` / Machine & Workload Identity** | **Yes, cryptographically**, but for bots/service accounts, not human identities. | Previous renewable bot certificate + generation counter; newer bound-keypair mode can recover using a durable local keypair. ([Teleport](https://goteleport.com/docs/reference/architecture/machine-id-architecture/?utm_source=chatgpt.com)) | Can generate OpenSSH credentials/config, but requires `tbot` running. ([Teleport](https://goteleport.com/docs/machine-workload-identity/machine-id/access-guides/ssh/?utm_source=chatgpt.com)) |
| **Vault SSH secrets engine** | Not as an integrated SSH-user experience. | A Vault token authorizes another `/ssh/sign` request. The SSH certificate response itself is `renewable: false`. ([HashiCorp Developer](https://developer.hashicorp.com/vault/api-docs/secret/ssh?utm_source=chatgpt.com)) | `vault ssh` wraps `ssh`; transparent scp/sftp/Git/editor usage needs additional automation. ([HashiCorp Developer](https://developer.hashicorp.com/vault/docs/commands/ssh?utm_source=chatgpt.com)) |

Vault Agent can renew the **Vault token** automatically, but that still leaves you responsible for periodically invoking the SSH signing endpoint and replacing/loading the resulting SSH certificate. ([HashiCorp Developer](https://developer.hashicorp.com/vault/docs/agent-and-proxy/autoauth?utm_source=chatgpt.com))

## Smallstep: exactly what happens

The client-side documented setup is OpenSSH plus `step`. `step ssh config` installs Smallstep SSH configuration; the normal template uses a `Match exec "step ssh check-host %h"` condition and a `ProxyCommand step ssh proxycommand ...`. Smallstep says the certificate lives in `ssh-agent`, not on disk, and defaults to 16 hours in its hosted SSH workflow. ([Smallstep](https://smallstep.com/docs/ssh/how-it-works/?utm_source=chatgpt.com))

The source is clearer than the marketing term “renew.” On every selected fresh connection, `step ssh proxycommand` calls `doLoginIfNeeded`. That function contacts the CA for its SSH roots, examines the agent and removes expired certificates. If no usable Smallstep-signed certificate exists, it runs a certificate flow, generates an authorization token, generates a **new SSH keypair**, calls `/ssh/sign`, and adds the resulting certificate/private key to `ssh-agent`. That is fresh issuance, not SSH-user certificate renewal. ([GitHub](https://github.com/smallstep/cli/blob/master/command/ssh/proxycommand.go))

A one-time bearer can be passed to `step ssh login --token`; the documentation calls it the one-time token used to authenticate creation of the certificate. Nothing in that flow turns it into a refresh credential. Separately, `step oauth` has generic OAuth refresh-token capabilities, but Smallstep's SSH documentation explicitly says that after the SSH certificate expires the user authenticates through the browser again. There is no documented wiring from a stored OAuth refresh token into `step ssh proxycommand`. ([Smallstep](https://smallstep.com/docs/step-cli/reference/ssh/login/?utm_source=chatgpt.com))

### What is installed on endpoints

| Platform | Smallstep client burden |
|---|---|
| **macOS** | OpenSSH/agent, plus `step` (`brew install step` is the documented installation). Run `step ssh config ...`. ([Smallstep](https://smallstep.com/docs/step-cli/installation/?utm_source=chatgpt.com)) |
| **Linux** | OpenSSH client and a working `ssh-agent`/`SSH_AUTH_SOCK`, plus `step-cli`. Desktop environments often already provide an agent; minimal/headless environments may require starting one. ([Smallstep](https://smallstep.com/docs/step-cli/installation/?utm_source=chatgpt.com)) |
| **Windows** | Windows OpenSSH Client, the Windows `ssh-agent` service, and `step` (`winget install Smallstep.step`). Microsoft's agent service is disabled by default and normally needs enabling/startup configuration. ([Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement?utm_source=chatgpt.com)) |

Windows has an extra wrinkle. Smallstep's Windows code uses the Windows OpenSSH agent and deliberately does **not** assign agent lifetimes because the Windows agent fails with lifetime-constrained additions; expired Smallstep certificates are cleaned up the next time Smallstep scans the agent. ([GitHub](https://github.com/smallstep/cli/blob/master/internal/sshutil/agent.go)) An old but still-open Smallstep issue also documents that native `step.exe` cannot directly use a Cygwin `ssh-agent`, because it connects to the Windows OpenSSH named pipe rather than Cygwin's `SSH_AUTH_SOCK`. ([GitHub](https://github.com/smallstep/cli/issues/333?utm_source=chatgpt.com))

That matters for Windows users mixing PowerShell/OpenSSH, Git Bash, Cygwin, WSL, rsync and GUI software: **all tools need to converge on an SSH implementation and an agent that sees the same credentials**. Otherwise the “transparent” property disappears.

## Does it cover ssh, scp, sftp, rsync, Git and editors?

For tools that actually invoke the configured OpenSSH executable, the integration is elegant. OpenSSH's client configuration is common to `ssh`, `scp`, and `sftp`, so the same `Match`/`ProxyCommand` and agent apply. ([OpenBSD Manual Pages](https://man.openbsd.org/ssh_config))

`rsync` normally uses SSH as its remote shell and explicitly supports either SSH configuration or `-e`/`RSYNC_RSH`, so it follows the same path when it invokes the same OpenSSH. ([Samba Download](https://download.samba.org/pub/rsync/rsync.1?utm_source=chatgpt.com)) Git likewise normally invokes `ssh`; Git documents `GIT_SSH_COMMAND` and `core.sshCommand` for overriding this and specifically recommends putting options in `.ssh/config`. ([Git](https://git-scm.com/docs/git?utm_source=chatgpt.com))

VS Code Remote-SSH explicitly requires an OpenSSH-compatible client, so it fits this model. ([Visual Studio Code](https://code.visualstudio.com/docs/remote/ssh?utm_source=chatgpt.com)) Other editors are conditional: if they shell out to the configured OpenSSH and share its agent, fine; an embedded SSH library, PuTTY/Pageant path, WSL instance, or alternative agent may bypass Smallstep entirely.

That means the certificates themselves are highly portable—OpenSSH understands them natively—but **transparent acquisition is not portable**. It depends on every tool reaching the Smallstep-configured OpenSSH/agent environment.

## Parallel clients and multiplexing

Parallel expiry is a weak spot. The current Smallstep code follows a straightforward check-then-issue sequence: each `proxycommand` process independently lists the agent, decides whether a valid certificate exists, then runs the issuance flow if not. I found no documented process-level coalescing guarantee around that sequence. Therefore, based on the source, two or more processes launched together immediately after expiry have a race window in which each can conclude that no valid certificate exists and start an authentication/issuance flow. Once one has added a valid certificate, later processes will normally see it and avoid login. This is a **source-derived behavior/inference**, not a documented Smallstep guarantee. ([GitHub](https://github.com/smallstep/cli/blob/master/command/ssh/proxycommand.go))

That race is realistic with an editor opening several helper connections, a Git operation alongside a terminal, or simultaneous scp/rsync activity. With browser-backed OIDC, the unpleasant failure mode is multiple browser/authentication flows rather than just duplicate cheap renewals.

OpenSSH multiplexing changes the picture substantially. `ControlMaster` allows multiple SSH sessions to reuse one already authenticated network connection, and `ControlPersist` can keep that connection alive in the background. ([OpenBSD Manual Pages](https://man.openbsd.org/ssh_config)) Consequently:

> certificate lifetime is an **authentication lifetime**, not a connection/session lifetime.

If a master authenticated at 09:00 with a certificate expiring at 10:00, it does not get reauthenticated merely because 10:00 arrives. New shells, scp/sftp channels and commands that successfully reuse that master can continue on the authenticated transport. Certificate expiration or guest-side revocation affects the next authentication, not an already authenticated connection. OpenSSH explicitly treats shell, command, scp and sftp traffic as channels within a connection. ([OpenBSD Manual Pages](https://man.openbsd.org/ssh_config))

So if “15-minute certificates mean access necessarily disappears 15 minutes later” is part of the security case, SSH multiplexing invalidates that assumption unless you separately bound master/session lifetime.

## Outage behaviour

A **plain OpenSSH certificate deployment** has attractive outage semantics. The guest stores the CA's public key in `TrustedUserCAKeys` and validates a presented certificate locally. There is no need for the signing CA to be reachable while a still-valid certificate is being authenticated. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config))

Smallstep's generated transparent client path adds more online dependencies. `step ssh check-host` constructs a CA client, calls the CA's version endpoint and then the SSH host-check endpoint. ([GitHub](https://github.com/smallstep/cli/blob/master/command/ssh/checkHost.go)) If the Smallstep proxy path is entered, `doLoginIfNeeded` fetches SSH CA roots; after that, `getBastion` makes another CA request before opening the transport. ([GitHub](https://github.com/smallstep/cli/blob/master/command/ssh/proxycommand.go))

Thus the practical outage matrix is:

| State | Public key | Native OpenSSH certificate | Smallstep generated transparent path |
|---|---|---|---|
| Existing SSH connection/master | Continues | Continues | Continues |
| New transport; credential still valid | Works without auth control plane | Works without signing CA | Smallstep host-selection/proxy machinery performs CA calls; fallback behavior must be tested/configured |
| Credential expired | Key still works unless revoked | Cannot get a fresh cert if issuer unavailable | Cannot complete fresh issuance; OIDC/CA outage blocks it |
| IdP outage | Irrelevant | Irrelevant if valid cert cached | Valid agent cert may remain usable, but post-expiry issuance fails |

There is an open Smallstep enhancement asking for `step ssh proxycommand` to fall through cleanly to standard SSH authentication, including the CA-outage/break-glass case. It remains a **proposal**, not documented current functionality. ([GitHub](https://github.com/smallstep/cli/issues/750?utm_source=chatgpt.com))

Likewise, a long-standing request for `step ssh renew --daemon` is still open—but that request concerns **host** certificates. It does not create daemonized human user-certificate renewal. ([GitHub](https://github.com/smallstep/cli/issues/341?utm_source=chatgpt.com))

## Could Smallstep be made one-time-enrol-and-silent?

Yes, but this is where the architecture stops being compelling for ordinary users.

Smallstep's X5C provisioner allows an existing trusted X.509 certificate/private key to authorize requests for SSH certificates. `step ssh certificate` exposes `--x5c-cert` and `--x5c-key`; `step ca token --ssh` can likewise generate an SSH one-time token signed using an X5C credential. ([Smallstep](https://smallstep.com/docs/step-cli/reference/ssh/certificate/?utm_source=chatgpt.com))

The X.509 identity itself *can* be transparently renewed. `step ca renew --daemon identity.crt identity.key` periodically renews it, by default using mTLS with that certificate/private key. Smallstep warns explicitly that possession of the private key permits an attacker to keep renewing until the credential is revoked. ([Smallstep](https://smallstep.com/docs/step-cli/reference/ca/renew/?utm_source=chatgpt.com))

So a bespoke implementation could look conceptually like:

**one-use bearer → local X.509 keypair/certificate → daemon renews X.509 identity → local hook uses X5C identity to request fresh SSH user cert → load/replace certificate in agent → ordinary OpenSSH clients consume it.**

That satisfies your browser requirement. But notice what became the real credential: **the durable X.509 private key**. The short SSH certificate is now just a derived session credential. You need secure local key storage, X.509 renewal supervision, boot/startup handling on three OSes, SSH issuance scheduling, locking between simultaneous callers, agent/file atomicity, outage/recovery behavior, endpoint revocation for the durable X.509 identity, logging, upgrade packaging and uninstall.

In other words, you have reinvented a small endpoint identity agent. Smallstep provides the cryptographic primitives, but I found no documented maintained Smallstep human-client implementation that assembles them into this workflow.

Teleport proves that this model can be engineered robustly—but it does so for **Machine & Workload Identity**. With an ephemeral one-use token, `tbot` gets a renewable certificate and subsequently authenticates renewal using the previous certificate plus a server-side generation counter. It defaults to one-hour credentials and a 20-minute renewal interval. Sharing the same bot state between two `tbot` instances can deliberately trigger a generation mismatch and lock the bot. ([Teleport](https://goteleport.com/docs/reference/architecture/machine-id-architecture/?utm_source=chatgpt.com)) Bound Keypair Joining goes further and can recover after an outage longer than the certificate TTL using a persistent enrolled keypair. ([Teleport](https://goteleport.com/docs/reference/machine-workload-identity/bound-keypair/getting-started/?utm_source=chatgpt.com))

That is the mature version of the architecture—but it is a daemon and a durable device key, and Teleport deliberately describes it as identity for machines/service accounts rather than as a replacement for regular user login. ([Teleport](https://goteleport.com/docs/reference/cli/tbot/?utm_source=chatgpt.com))

## Uninstall is part of the cost

For Smallstep, cleanup of current agent credentials is straightforward: `step ssh logout` removes Smallstep-signed certificate keys from `ssh-agent`. ([Smallstep](https://smallstep.com/docs/step-cli/reference/ssh/logout/?utm_source=chatgpt.com)) The package docs then say to remove `step` and `$HOME/.step`; e.g. `brew uninstall step`, `dpkg -r step-cli`, or `winget uninstall Smallstep.step`. ([Smallstep](https://smallstep.com/docs/step-cli/installation/?utm_source=chatgpt.com))

There is an additional configuration concern: `step ssh config` modifies the user's SSH configuration and creates Smallstep SSH files. Current templates include a Smallstep-generated SSH config from the user's SSH configuration. ([GitHub](https://github.com/smallstep/certificates/issues/2101?utm_source=chatgpt.com)) I found no documented client equivalent of `step-ssh deactivate` that fully reverses this. So a complete endpoint removal procedure should also remove the Smallstep snippet/Include from `~/.ssh/config`, stop any custom X.509/SSH renewal daemon you created, remove its durable credentials and then remove `$HOME/.step`. That extra cleanup is especially important if you implement the X5C design rather than the standard browser workflow.

The Smallstep **host** product does have explicit deactivation/uninstall machinery, but that concerns enrolled SSH servers, not the ordinary user's laptop. ([Smallstep](https://smallstep.com/docs/ssh/hosts/?utm_source=chatgpt.com))

## Against installed public keys with guest-side revocation

This is where the certificate case becomes much less obvious.

| Property | Installed public key | Short-lived SSH user cert |
|---|---|---|
| Laptop software | OpenSSH; optionally its normal agent | OpenSSH + CA-specific enrolment/renewal client, usually agent, possibly daemon/device credential |
| Browser/auth flow | None | Periodic SSO in Smallstep's supported human model |
| Works with every standard SSH-derived tool | Yes | Certificate does; **acquisition wrapper** only if the tool uses the right OpenSSH/agent/config |
| Guest state | Individual authorized key(s), or dynamic key lookup | One/few CA public keys plus principal policy |
| Immediate revocation | Remove key / change `AuthorizedKeysCommand` result / publish `RevokedKeys` | Short lifetime waits for expiry unless you also distribute KRL/revocation state |
| Offline fresh auth | Yes | Yes with already-issued cert under plain OpenSSH; potentially weaker with a client proxy architecture |
| Fleet join/leave administration | Key distribution/removal | Excellent: new users normally need no per-host key installation |
| Dynamic IdP roles/principals | Requires your own policy/distribution mechanism | Strong fit for certificates |
| Existing sessions after revocation | Continue | Continue |
| Multiplexed master after credential expiry | Can continue | Can continue |

OpenSSH's `RevokedKeys` applies to ordinary public keys as well as certificates; it accepts either textual public keys or a KRL. KRLs can revoke plain keys by content/hash and certificates by serial or key ID. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com)) OpenSSH also supports `AuthorizedKeysCommand` if you want guest-side dynamic lookup rather than pushing `authorized_keys` files. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

That matters because “certificates solve revocation” is overstated. Short-lived certificates provide **passive eventual revocation for future authentications**. If a user must be cut off immediately, you either distribute a KRL/principal-policy change to the guests or terminate sessions centrally. If you already have a reliable guest-side mechanism for withdrawing public keys, you have already solved much of the hard revocation problem.

## Recommendation

For the requirements you gave, I would use **installed OpenSSH public keys plus reliable guest-side revocation** as the default.

The client UX is materially better: no additional CA CLI, no browser expiry event, no local certificate-renewal logic, no CA dependency in the connection path, no Windows agent-integration surprises, and uninstall is simply removal of the key/agent entry. The operational work stays where you already intend to put it—guest-side authorization and revocation.

I would change that recommendation to SSH certificates when **per-user key distribution across a large/dynamic host fleet is itself the dominant operational problem**: hundreds or thousands of hosts, frequently changing group membership, just-in-time roles, principal restrictions, central IdP enforcement, or a strong desire to install one CA key rather than N user keys on every guest. In that environment, certificates can be worth the endpoint client because they eliminate a much larger server-side authorization-distribution problem.

I would **not** introduce a custom Smallstep X5C “one-time bearer → renewable device certificate → automatically reissued SSH certs” scheme merely to avoid the daily browser login. It works cryptographically, but the resulting durable private key and endpoint daemon become the real trust system. At that point you have more moving parts than the public-key design you were trying to replace, without gaining immediate revocation or stronger guarantees for already-established/multiplexed SSH sessions.

So the decision boundary is fairly sharp: **Smallstep's supported human UX is good if one SSO ceremony per ~workday is acceptable. If “enrol once and never prompt again” is a hard human-user requirement, certificates do not currently justify their full client burden unless you are prepared to deploy and operate a genuine managed device-identity agent.**
