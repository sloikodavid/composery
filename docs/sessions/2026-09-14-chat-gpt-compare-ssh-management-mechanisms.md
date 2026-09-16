# Compare SSH Management Mechanisms

Source: https://chatgpt.com/share/6aa776b9-ff08-83eb-93b8-29573e97f192

---

## Turn 1: User

_2026-09-14T04:04:51.959Z_

We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Compare practical mechanisms for Composery to inspect and change the server's authorized-key configuration: backend-initiated SSH, a narrow server-side helper using outbound HTTPS, and any substantially simpler viable alternative. Evaluate the entire lifecycle under the same requirements, not just the file-write step.

Verify current Convex Node runtime support and constraints: outbound networking, execution duration, dependencies, connection setup, concurrency, scheduling, workpool behavior, retries, logging, and secrets. The repo currently uses Convex 1.45.0 and @convex-dev/workpool 0.4.11; distinguish package behavior from hosted platform constraints.

Cover initial bootstrap, network/firewall changes, per-server management authority, customer removal of the integration, replacement machines, and recovery. Establish whether any executable must remain on the VPS and what it can do. Compare least privilege with an explicitly administrative integration without assuming either is automatically appropriate.

Give a minimal deployment experiment proving a trusted remote read and one verified edit from the actual Convex environment. Mark anything requiring real credentials as an unexecuted deployment check. Do not assume local Node success proves hosted Convex success.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.

---

## Turn 2: ChatGPT

_2026-09-14T04:04:53.326Z_

I’ll ground this in current Convex docs/source, the exact package versions you named, OpenSSH/RFC sources, and Ubuntu 24.04 packaging. I’ll separate hosted-platform limits from library behavior, then compare the three mechanisms across bootstrap, steady-state reads/edits, removal, replacement, and recovery, ending with a reproducible hosted-Convex experiment and explicit pass/fail gates.

---

## Turn 3: ChatGPT

_2026-09-14T04:05:05.888Z_

One early constraint is already decisive for feasibility: hosted Convex Node actions currently support Node 20/22/24, permit outbound connections, and have a 10-minute execution cap; the platform also publishes regional egress IPs, but explicitly says those IPs are shared and must not be treated as authentication. That makes direct SSH technically plausible, but firewall allowlisting alone cannot establish per-Composery authority.

---

## Turn 4: ChatGPT

_2026-09-14T04:08:44.080Z_

A significant Ubuntu-specific finding changes the least-privilege option: Ubuntu published `1:9.6p1-3ubuntu13.19` for 24.04 in September 2026 to fix, among other issues, a bypass in the `authorized_keys` `restrict` handling for tunnel forwarding. So a forced-command management key is viable only with a patched package baseline; I would also disable forwarding at the `sshd_config` account level rather than treating `restrict` as the sole containment boundary.

---

## Turn 5: ChatGPT

_2026-09-14T04:21:12.217Z_

## Recommendation

Use **backend-initiated SSH for v1**, but do not ship the current transport unchanged. The architecture does **not** need a persistent VPS agent unless the real hosted-Convex test shows raw SSH is unavailable, customers commonly prohibit inbound management SSH, or you specifically want outbound per-server machine identity. The strongest simpler alternative to a full outbound agent is **SSH to a dedicated control account whose only allowed command is a small root-owned authorized-keys helper**. That gives substantially tighter authority without polling, agent enrollment, an updateable daemon, or another network protocol.

The immediate production blocker is **server authentication**. The connected `composery-web` code creates an `ssh2.Client`, authenticates with `SSH_PRIVATE_KEY`, and sets a 60-second ready timeout, but supplies no `hostVerifier`. `ssh2` 1.17.0 explicitly defaults to **auto-accepting the server host key** when `hostVerifier` is absent. Thus the existing code authenticates Composery *to something at the target address* but does not cryptographically establish that it is the intended VPS.  

My decision tree would be:

| Desired Composery authority | Mechanism |
|---|---|
| Composery is intentionally an administrative control plane and root-equivalent compromise is within its trust model | **Direct administrative SSH**, no Composery executable remains on the VPS |
| Composery should only inspect/change SSH public-key authorizations | **SSH + forced-command helper**, no daemon; one narrow root-owned helper remains |
| Inbound SSH from Convex is not acceptable/reliable, or future VMs are normally private/NATed | **Outbound HTTPS agent**, with per-server machine credential and preferably a separate privileged local helper |

I would **not build the outbound agent before running the hosted SSH experiment below**.

### What I verified in the repository

The connected GitHub `main` I can inspect is commit `87cf051219deff2877b80010f5ebaaab2c1a4aff`. It currently differs from the versions in your prompt: that commit has `convex` 1.39.1, `ssh2` 1.17.0, and no direct `@convex-dev/workpool` dependency; `convex.json` externalizes `ssh2` and `cpu-features` but does not set `node.nodeVersion`. I therefore treated your stated **Convex 1.45.0 / Workpool 0.4.11 / Node 24** as the intended/current working state and verified those exact versions upstream rather than overriding your statement with the older connected branch.  

The linked code is already an explicitly administrative integration in practice: the runbook specifies `SSH_USER=root`, one deployment-level `SSH_PRIVATE_KEY` used across boxes, and says it is used throughout bootstrap/password/slug lifecycle, while `ssh.ts` executes general shell commands including installing Docker and changing `/opt` state. So switching only the authorized-key feature to a narrow API would **not by itself make the existing platform least-privileged**; that requires deciding whether the broader root channel remains.  

The exact requested upstream releases are Convex **1.45.0**, commit `8e20ab9e02baab41969f998122d9b926ec80effd`, released 21 August 2026, and Workpool **0.4.11**, commit `9a64c831b2a4bf3ce565f1a364e59007df4354bb`, released 1 September 2026. Workpool 0.4.11 specifically changed its Batch Worker dependency/cooldown behavior; it does not redefine hosted Convex execution limits.     

## Convex: hosted constraints versus package behavior

| Area | Verified hosted/platform fact | Consequence for Composery |
|---|---|---|
| Node runtime | Hosted Node actions currently support Node **20, 22 and 24**; default is 20. `node.nodeVersion: "24"` must be configured. After a version push, old Node may run for a few minutes. ([Convex Developer Hub](https://docs.convex.dev/functions/runtimes)) | Explicitly configure 24 and have the deployment test return `process.version`; package installation/local Node 24 is not proof. |
| Networking | Convex says all outbound requests, including “other external connections,” originate at published regional egress addresses. Ireland currently has six IPv4 addresses. They are **shared between deployments** and Convex says not to use them as authentication. ([Convex Developer Hub](https://docs.convex.dev/production/networking)) | Firewall-allowlisting them is useful defense-in-depth. It does not authenticate Composery. Documentation does not explicitly promise `ssh2`/raw `net.Socket` behavior, so hosted SSH remains a deployment check. |
| Time/memory | Node actions: **10-minute** maximum, **512 MiB** RAM, 5 MiB Node action arguments; 1,000 concurrent I/O operations/function. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits)) | SSH work should normally finish in seconds with its own connect/command deadlines. Never use the 10-minute platform timeout as the SSH timeout. |
| Dependencies | Node external packages are installed on the hosted server from npm, using the version present in local `node_modules`; external packages plus bundle have 45 MB zipped / 240 MB unpacked limits. ([Convex Developer Hub](https://docs.convex.dev/functions/bundling)) | Your `externalPackages: ["ssh2","cpu-features"]` is supported in principle. The hosted experiment must still prove this deployment. `cpu-features` is optional to ssh2.  |
| Connection lifetime | Node environments may be reused, but Convex warns that dangling asynchronous work may leak into later invocations; Node actions also have cold starts. ([Convex Developer Hub](https://docs.convex.dev/functions/actions)) | Open a connection for an operation and close/await it. Do not depend on a process-global persistent SSH socket. Your current `runSsh` already creates a new client per call. |
| Hosted concurrency | Current Node-action limits are 64 / 256 / 1024 / 2048 by deployment class; scheduled-job limits are 8 / 256 / 512 / 1024. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits)) | Workpool can deliberately set a much smaller SSH concurrency; it cannot increase these hosted limits. |
| Scheduling | Scheduled mutations execute exactly once; scheduled actions execute **at most once** and are not automatically retried. Authentication context is not propagated. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions)) | Persist an authorized operation first, then schedule by operation ID. Do not expect Clerk identity to magically appear inside the SSH action. |
| Workpool 0.4.11 | Source default parallelism is 10. Action retries default **off**; when enabled, default retry behavior is 5 attempts with 250 ms initial backoff and base 2.   | Reads may retry. Remote edits should not blindly retry unless the action reconciles state and is idempotent/CAS-safe. |
| Workpool observability | Workpool defaults to REPORT logging; INFO/DEBUG add detail. It retains job status for one day by default.   | Keep your durable operation/audit record in Composery; do not treat Workpool status or console logs as the durable audit log. |
| Logging | 4 KiB/log line, 256 lines/function; streaming buffer 4096 logs flushed every 5 seconds. ([Convex Developer Hub](https://docs.convex.dev/production/state/limits)) | Log server ID, operation ID, public-key fingerprint, revisions and status—not management private keys/tokens or whole `authorized_keys` files. |
| Secrets | The environment-variable guide says 512 vars / 512 KiB total / 256-char names; the limits page currently says 1,000 vars / 40-char names. Both say 8 KiB/value. CLI commands can list/get values. ([Convex Developer Hub](https://docs.convex.dev/production/environment-variables)) | This is a live documentation inconsistency. Design to the lower bound. Convex env is suitable for a small number of deployment secrets, not thousands of per-server SSH private keys, and is not an HSM. |

A local Convex deployment is specifically insufficient evidence: local Node actions execute directly on the developer machine with unrestricted filesystem access. ([Convex Developer Hub](https://docs.convex.dev/cli/local-deployments))

## Lifecycle comparison

| | Direct administrative SSH | Forced-command SSH helper | Outbound HTTPS helper/agent |
|---|---|---|---|
| **Custom executable remains?** | **No.** Only normal OpenSSH. | **Yes**, one small non-daemon helper. | **Yes**, a running agent; ideally also a separate privileged helper. |
| **Bootstrap** | Inject management public key; securely acquire/pin server host key. | Create dedicated control account, install root-owned helper and restrictive `sshd_config`, inject control key, pin host key. | Cloud-init installs/enrolls agent using a one-use token; exchange for per-server machine credential. |
| **Network** | Inbound SSH must be reachable from Convex. | Same. | Only outbound HTTPS/DNS need work; no Composery inbound rule. |
| **Authority if compromised** | Whatever the SSH account has. With current `root` configuration: full administration. | Management key reaches only helper protocol if SSH restrictions and helper are correct. | Root-running monolithic agent is effectively root; split unprivileged networking + privileged narrow helper gives tighter authority. |
| **Normal customer SSH after setup** | Independent of Composery. | Independent. | Independent once an edit has been applied locally. |
| **Customer removes integration** | Remove management public key/account and optional Convex firewall allowance. Nothing should reinstall it. | Remove control key/account/helper/config. | Revoke token; stop/disable/uninstall agent/helper. |
| **Replacement machine** | Treat as new identity: fresh host pin; preferably fresh management credential. | Reinstall/re-enroll helper and fresh pin/credential. | Fresh one-use enrollment and machine credential; never inherit a snapshot's live machine token. |
| **Failure/recovery** | Broken sshd/firewall/key requires provider console/rescue. | Same. | Broken agent/egress/helper requires ordinary customer SSH or provider console/rescue. |
| **Operational complexity** | Lowest. | Moderate. | Highest. |
| **Best reason to choose** | Administrative trust is deliberate. | You want SSH-key-only capability without agent architecture. | Inbound reachability or central SSH-secret model is unacceptable. |

Hetzner can inject public SSH keys and cloud-init at creation, but its documented SSH Key API is an **injection-at-creation** mechanism, not an API for changing a running guest's authorization file. Cloud-init input is limited to 32 KiB. In January 2026 Hetzner also added `user_data` to rebuild operations. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/))

Hetzner therefore is not a simpler ongoing management channel. If Composery loses guest access, Hetzner's supported recovery is Rescue/console; its June 2026 recovery documentation explicitly shows mounting/chrooting and editing `authorized_keys`. Rescue can use a separately selected SSH key and has a different host fingerprint from the installed OS. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/how-to-rescue/change-ssh-key/))

For a future self-operated VM backend, the corresponding dependency is an **out-of-band console/rescue mechanism**. Neither SSH nor an outbound agent should be considered the ultimate recovery channel.

## The least-privilege SSH variant

If you decide Composery should have only this capability, I prefer a forced-command SSH helper over the outbound daemon.

A dedicated `composery-control` account can be constrained with server-side `ForceCommand`, `DisableForwarding yes`, `PermitTunnel no`, `PermitTTY no`, `PermitUserRC no`, public-key-only authentication, and a root-owned helper invoked through an exact sudo rule. The helper should accept structured stdin, not interpolate `SSH_ORIGINAL_COMMAND` into a shell. `ForceCommand` restricts shell/command/subsystem execution, while `DisableForwarding` separately removes X11/agent/TCP/Unix-socket forwarding; tunnel forwarding needs its own `PermitTunnel no`. Those distinctions are present in OpenSSH Portable 9.6p1 source. 

Do not rely solely on the `authorized_keys` `restrict` option on an unpatched Noble machine. Ubuntu's **USN-8721-1**, published 3 September 2026, fixed CVE-2026-73283, where `sshd` incorrectly applied `restrict` to tunnel forwarding. Ubuntu 24.04's fixed package is `openssh-server 1:9.6p1-3ubuntu13.19`, which is now the current `noble-updates` version. ([Ubuntu](https://ubuntu.com/security/notices/USN-8721-1))

Version distinction matters here: Ubuntu 24.04 is a Debian/Ubuntu-patched build based on **OpenSSH Portable 9.6p1**. Upstream Portable's signed `V_9_6_P1` tag, dated 18 December 2023, points to commit `8241b9c0529228b4b86d88b1a6076fb9f97e4a99`. OpenBSD-current manuals are useful semantic references, but they are not evidence for what Ubuntu Noble actually ships.  ([Ubuntu Manpages](https://manpages.ubuntu.com/manpages/noble/man5/sshd_config.5.html))

The helper's root capability can be extremely small: **read effective OpenSSH public-key configuration; read a named supported authorization file; apply an edit only when its expected revision matches; atomically replace while preserving ownership/mode; reread and report the resulting revision**. No shell, Docker, process management, arbitrary path, package installation, or generic file-write operation is needed.

That is meaningfully least-privileged even though the helper itself must cross root's DAC boundary. Conversely, if Composery intentionally remains a root-level server manager for other product functions, keeping this one path constrained provides less compromise reduction than it appears; direct administrative SSH may then be the more honest, simpler architecture.

## What “server state is authoritative” should mean

This direction is technically sound, but the unit of state needs care. An OpenSSH server may have **multiple `AuthorizedKeysFile` paths**, an `AuthorizedKeysCommand`, SSH certificate CAs/principal files, and other authentication methods. `AuthorizedKeysCommand` is evaluated after normal files and skipped when a file already supplies a matching key. Ubuntu also includes `/etc/ssh/sshd_config.d/*.conf` before the main config, so hardcoding `~/.ssh/authorized_keys` does not reliably describe effective configuration.  ([Ubuntu Manpages](https://manpages.ubuntu.com/manpages/noble/man5/sshd_config.5.html))

Use the installed `/usr/sbin/sshd -T -C ...` to obtain effective configuration for the relevant user/connection context; Portable 9.6p1 documents that `-T` outputs effective configuration and `-C` causes applicable `Match` rules to be evaluated. 

I would therefore make an edit operate on:

`server + Linux user + effective authorization source/path + expected SHA-256 revision + exact requested change`

A read returns raw-preserving parsed entries plus a revision. An edit rejects a stale revision, writes atomically, rereads, and verifies its postcondition. That handles concurrent customer edits without making Convex a canonical key inventory. It also means removing a Composery member need not imply removing any Linux key: **platform authorization controls who may request the edit; it does not establish ownership of every key line**.

Customer private keys never need to enter this flow. SSH's authentication protocol defines public-key authentication in terms of the client proving possession by signing with its private key; the server verifies the configured public key and signature. ([RFC Editor](https://www.rfc-editor.org/rfc/pdfrfc/rfc4252.txt.pdf))

### One application operation for UI and programmatic clients

The transport should sit below one application operation:

`requestAuthorizedKeyRead/Edit(principal, serverId, ...) → authorize → persist operation → schedule internal execution`

The web adapter derives `principal` from Clerk. A non-browser client needs a separate programmatic/machine authentication credential, but it should enter the **same permission check and operation mutation**, not call the SSH action directly. Because Convex does not propagate authentication into scheduled functions, the queued action should receive an operation ID and re-read the trusted operation/actor/server context rather than accepting an arbitrary caller-supplied user ID. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions))

This gives you the same `ssh-admin` platform permission regardless of client while keeping Linux accounts/keys as separate server state.

## Hosted Convex deployment experiment — **not executed**

I had repository read access, but I do **not** have an execution path to your hosted Convex deployment or disposable VPS credentials. I did not run this experiment. A local Node or local Convex success should not be accepted as equivalent.

Run this against a disposable Ubuntu 24.04 VPS:

1. Bring Noble fully current and verify `openssh-server >= 1:9.6p1-3ubuntu13.19`; restart `sshd`. Create a disposable Linux user and an initially known `authorized_keys` file. Generate separate **test-only** management and probe Ed25519 keypairs. No customer private key is involved. ([Ubuntu](https://ubuntu.com/security/notices/USN-8721-1))
2. Establish the VPS's Ed25519 **host** fingerprint out of band—Hetzner console is adequate for this experiment. Production automation can instead use a one-time cloud-init enrollment nonce to POST the freshly generated host public key/fingerprint to a Convex HTTPS endpoint. Do not learn the production pin from the same unverified SSH connection it is supposed to authenticate.
3. Set hosted `convex.json` to Node 24 and deploy the Node action with `ssh2@1.17.0`. The action must report `process.version` and fail unless it is `v24...`. Configure `hostVerifier` to accept only the previously acquired fingerprint.
4. First SSH connection: read the effective `sshd -T -C` information and target file; compute/return a SHA-256 revision. Do not log the management key or entire file.
5. With that exact expected revision, perform one atomic addition of the disposable probe **public** key; reread and prove the post-edit revision and exact entry are present. A stale expected revision must produce no write.
6. Open a **new SSH connection** as the disposable target user using the probe private key and the same host-key verification, and execute only a harmless fixed command such as `true`. Then remove the probe key by CAS, reread, and verify a fresh probe-key login no longer succeeds.

The explicit acceptance gates are:

- **PASS** hosted action observes Node 24; otherwise fix deployment configuration.
- **PASS** hosted Convex successfully loads `ssh2`/external dependencies and establishes raw TCP to the VPS; **FAIL** here is the main evidence for preferring an outbound HTTPS agent.
- **PASS** a deliberately wrong host fingerprint fails before any remote command.
- **PASS** trusted live read returns the expected server revision.
- **PASS** correct-revision edit is atomic and verified by reread.
- **PASS** stale revision leaves the server unchanged.
- **PASS** independent SSH authentication succeeds after addition and fails after cleanup.
- **PASS** deployment logs contain no private keys, bearer credentials, or full authorization-file contents.
- **PASS** replacing/rebuilding the VPS causes the old host pin to fail closed until the replacement is explicitly enrolled.

Do not turn on Workpool retries for the edit merely to make this test pass. A lost connection after the remote rename is an **ambiguous outcome**: first reread/reconcile. Only when the action can recognize “this exact operation is already reflected in server state” is automatic retry safe. Convex itself deliberately does not automatically retry actions for this reason, and Workpool likewise defaults action retries off. ([Convex Developer Hub](https://docs.convex.dev/functions/actions)) 

## Remaining unknowns and decision gate

There are three meaningful unresolved facts. First, **raw `ssh2` from your actual hosted deployment** has not been proven; current Convex networking documentation strongly suggests it should work but does not explicitly document SSH as a supported protocol. Second, Convex's two current environment-variable pages disagree on count/name limits; that is not architecturally important if per-server private keys are not modeled as environment variables. Third, the connected GitHub `main` predates the package versions you specified, so I could not inspect the exact unpushed/current Workpool integration.

The only product decision research cannot make is **how much durable VPS authority Composery is meant to have**. If general server administration is deliberately part of the trust contract, I would keep direct administrative SSH, fix host verification, move toward scoped/per-server credentials as scale warrants, and avoid an agent. If the intended contract is specifically “Composery may modify SSH public-key authorization and little else,” use the forced-command SSH helper. The outbound HTTPS agent should become the winner only when the hosted-network experiment or your networking model gives it a concrete advantage.
