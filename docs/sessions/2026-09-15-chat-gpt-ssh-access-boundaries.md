# SSH Access Boundaries

Source: https://chatgpt.com/share/6aa8b215-b9b0-83eb-a357-9721f2a89a9c

---

## Turn 1: User

_2026-09-15T02:39:45.829Z_

Context: A company sells Linux VPS instances. Each customer has root on their instance and may change or replace anything, including the SSH server and the operating system. A web control panel reaches each instance over SSH with its own key, installed at creation through the provider's first-boot mechanism. The company wants the panel to manage SSH access, and it wants the instance to stay the authority: no copy of access state in the panel's database.

Question: What are the possible resources a control panel could manage for SSH access, where exactly does each boundary lie, and which boundaries can be stated to a customer without overstating what the panel controls?

Compare at least: an entry in an authorized_keys file; a whole authorized_keys file; every authorized key source that applies to one account, including AuthorizedKeysCommand and certificate authorities; the SSH server configuration; an account on the machine; and an external access service that authenticates at login instead. For each: what a panel can enumerate, what it can change, what it can promise, what it cannot see, what happens when the customer changes the same thing by hand, and how it fails when the machine is unreachable or no longer runs OpenSSH.

Also examine whether managing more than one of these together creates claims that are false in combination, for example presenting a per-key restriction as a limit on what the account can do.

Evidence rules: cite OpenSSH source and man pages at exact versions, and product documentation with dates. Separate what is verified from what is inferred. Give counterexamples that would invalidate each boundary. Do not assume that a larger surface is better, or that a smaller one is safer.

---

## Turn 2: ChatGPT

_2026-09-15T02:39:45.145Z_

I’ll anchor this to a specific OpenSSH release, then separate protocol/config facts from product-behavior inferences. I’ll also test each proposed boundary with a concrete counterexample, because several attractive UI abstractions become false as soon as root changes a second path.

---

## Turn 3: ChatGPT

_2026-09-15T02:40:19.348Z_

The first important result is that “SSH keys for an account” is not a single OpenSSH object. In OpenSSH 10.5p1, public-key authorization is an ordered union: configured `AuthorizedKeysFile` paths first, then `TrustedUserCAKeys`/principal checks, then `AuthorizedKeysCommand`; a panel that edits one file cannot truthfully describe that as the account’s complete key access.

---

## Turn 4: ChatGPT

_2026-09-15T02:42:35.658Z_

A second boundary issue is now clear: even “all public-key sources” is not generally enumerable as a finite key list. An `AuthorizedKeysCommand` is arbitrary executable logic that returns answers at authentication time, and a trusted CA represents authority to mint future acceptable certificates; the stable resource is the **policy/source configuration**, not necessarily “all keys that can authenticate.”

---

## Turn 5: ChatGPT

_2026-09-15T02:43:27.546Z_

The cleanest model is: **the panel does not manage “SSH access” as one resource. It manages one or more concrete resources that participate in an access decision.** Those resources are not concentric. A Unix account is not a superset of an `authorized_keys` file; `sshd_config` is not a superset of an account; an external access service can bypass OpenSSH entirely.

I’ll use **OpenSSH Portable 10.5p1**, released **August 11, 2026**, as the reference version. The tagged `sshd_config(5)` is dated August 8, 2026 and `sshd(8)` July 11, 2026. ([OpenSSH](https://www.openssh.com/releasenotes.html)) Version pinning matters here: 10.5 itself fixed a bug in which the `authorized_keys` `restrict` option did not correctly restrict tunnel forwarding. ([OpenSSH](https://www.openssh.com/releasenotes.html))

## 1. What OpenSSH actually gives you — verified

An `AuthorizedKeysFile` is already broader than “the authorized_keys file”: the directive may name multiple paths and wildcards. The man-page default is `.ssh/authorized_keys .ssh/authorized_keys2`, although the **shipped portable 10.5p1 sample configuration overrides that to only `.ssh/authorized_keys`**. That discrepancy alone is a good reason not to build a control-panel boundary around an assumed pathname. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5))

For a public-key attempt, the 10.5p1 source checks the configured `AuthorizedKeysFile` paths/globs first; if none matches, it checks a certificate against `TrustedUserCAKeys`; if that fails, it tries `AuthorizedKeysCommand`. It stops at the first successful source. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c)) An `AuthorizedKeysCommand` is explicitly an executable that emits `authorized_keys`-format lines, and OpenSSH can pass it the candidate key or fingerprint (`%k`, `%f`) and connection information. Its output is fed through the normal authorized-keys parser. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5))

Certificates widen the boundary again. `TrustedUserCAKeys` delegates authorization to a CA; `AuthorizedPrincipalsFile` or `AuthorizedPrincipalsCommand` can further determine which certificate principals are acceptable. CAs placed directly in `authorized_keys` using `cert-authority` follow a slightly different principal mechanism. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5)) Revocation is another input: before accepting a public key or its signing CA, 10.5p1 checks configured revoked-key files. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c))

And public-key authorization is not equivalent to login. `AuthenticationMethods` can require `publickey,password`, `publickey,keyboard-interactive`, or even two distinct public keys. Other available methods include hostbased, GSSAPI, keyboard-interactive, password and `none`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5)) The target account is separately resolved with `getpwnam()` and subjected to account, shell, Allow/Deny user/group and platform checks. Notably, the explicit locked-account test is skipped when `UsePAM` is active, because PAM participates in account policy instead. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth.c))

Finally, the configuration itself is contextual. Command-line options override the config file; `-f` selects another config; `Include` may introduce globbed files even inside `Match`; and `sshd -G`/`-T` with `-C` can calculate configuration for a particular connection context. Those commands calculate the configuration for the invocation you give them—they do not magically query an unrelated running daemon. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8))

Those are verified OpenSSH properties. The control-boundary conclusions below are architectural inferences from them and from your “root owns the guest / guest is authoritative / panel has only SSH” model.

## 2. The six useful boundaries

| Resource the panel manages | What the panel can enumerate/change | Customer-safe promise | What is outside the boundary / counterexample | Manual edits | Unreachable / no OpenSSH |
|---|---|---|---|---|---|
| **One entry in one `authorized_keys`-format file** | Read a specific pathname, parse its lines, and add/remove/replace one line. A line contains options, key type, key blob and comment; the comment has no authentication meaning. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) | **“Manage this authorized-key entry in `/path`.”** Stronger but still conditional: “When OpenSSH authenticates through this particular entry, these entry options apply.” | It says nothing about the same key elsewhere, another key, CAs, `AuthorizedKeysCommand`, passwords, another sshd, or account validity. **Counterexample:** the same key exists unrestricted in an earlier configured file and restricted in the panel-managed file. Because OpenSSH stops after the first matching source, the panel’s restriction never governs that authentication. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c)) | Customer edits are immediately authoritative. The panel must rediscover them next read. A read/modify/write should use optimistic concurrency or it can overwrite intervening customer edits. | If the management SSH path is gone, state is **unknown**, not “enabled” or “disabled.” If OpenSSH has been replaced, the line remains a file object but its OpenSSH semantics are no longer a valid claim. |
| **One whole `authorized_keys` file** | Enumerate every line and optionally file ownership/mode; rewrite the file atomically. Ownership/mode should be in the resource definition if the UI implies the file is usable—OpenSSH can refuse a non-regular or unsafe path under `StrictModes`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c)) | **“Manage the contents of `/path`.”** If metadata is also controlled, say so explicitly. | Not “all keys for this user.” `AuthorizedKeysFile` may contain several paths or globs, followed by CA and command sources. **Counterexample:** `AuthorizedKeysFile .ssh/authorized_keys /etc/ssh/admin_keys`; the managed file is empty while `/etc/ssh/admin_keys` grants access. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5)) | Whole-file ownership creates a larger collision domain: a panel write can erase hand edits unless it detects concurrent modification. Conversely, if the instance is authoritative, a hand replacement of the file must become the panel’s new truth. | Same as above. With another SSH implementation, the file might be ignored, partly compatible, or interpreted differently. |
| **The effective OpenSSH public-key authorization sources for one account** | Can discover the active `AuthorizedKeysFile` paths, trusted CA file, principals files, revocation files and configured commands for a defined OpenSSH invocation/context. It can enumerate static key files and trusted CA keys. | Prefer **“Inspect/manage OpenSSH public-key authorization policy for user `u`”**, qualified by server/version and connection context. Do **not** call the result “all authorized keys.” | There may be no finite key set to enumerate. An `AuthorizedKeysCommand` can answer dynamically for the particular `%f`/`%k`; a trusted CA can mint a new acceptable certificate after the panel scan; an `AuthorizedPrincipalsCommand` may also be dynamic. **Counterexample:** a command queries LDAP or an API using the offered fingerprint and current time. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c)) | Root can introduce a new file, command, CA or `Match` rule immediately. If the panel “repairs” these back to some desired configuration, that desired state must live somewhere other than the current guest state, which changes your authority model. | On loss of management access the effective policy is unknowable. With no OpenSSH daemon, this boundary describes dormant OpenSSH configuration, not active SSH access. |
| **The OpenSSH server configuration** | Read its config graph and, if the actual executable and invocation are known, use `sshd -G/-T -C`; edit configuration, validate with `-t`/`-T`, and reload/restart. | **“Manage the OpenSSH configuration for this instance/daemon.”** If relevant: “Effective for user/address context C.” | Does not include the identity database, PAM backend, arbitrary external command data, network filtering, or another SSH implementation/process. **Counterexample:** root stops `/usr/sbin/sshd` and binds Dropbear or a second sshd with `-f /opt/ssh/other.conf` to the service port. The panel can perfectly manage `/etc/ssh/sshd_config` while controlling nothing that receives the connection. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) | Disk configuration and active-process configuration can diverge until a reload. Root can change both configuration and daemon invocation. A panel should distinguish **file state**, **validated effective config**, and **verified running listener**. | If unreachable, it cannot inspect which daemon is running. If OpenSSH is gone, OpenSSH-config controls should be reported as inapplicable rather than pretending they still manage SSH. |
| **A machine account** | Enumerate the identity OpenSSH resolves—name, UID/GID, home, shell, groups, etc.—through the host's identity subsystem. Local accounts can usually be modified/deleted/locked; directory-backed accounts may require a completely different authority. OpenSSH itself resolves the target through `getpwnam()`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth.c)) | **“Manage Linux/Unix account `u`”**, and only attributes actually controlled. | An account is an OS principal, not an SSH authorization policy. Lock semantics can depend on PAM; another login service can map an external identity to the same account. **Counterexample:** public-key files contain nothing, but an external SSH access service authenticates a user and starts a session as existing Unix user `alice`. | Root can unlock, delete, recreate, rename or replace the identity source. The “same username” may later resolve to a different UID. | The account remains a meaningful OS resource without OpenSSH. But because this panel’s only management transport is SSH, the panel still cannot change it while it cannot get into the guest. |
| **An external login/access service** | Enumerate and change that service's identities and access policy, potentially without reading guest `authorized_keys` at all. The exact boundary is the service's **own ingress path**. | **“Manage access through Service X”**. For Tailscale, for example: **“Manage Tailscale SSH access to this node.”** | It does not imply all SSH paths are controlled. Tailscale's documentation, last validated **January 5, 2026**, explicitly says Tailscale SSH takes over port 22 only for traffic arriving over the tailnet/Tailscale IP; it does not modify `sshd_config` or `authorized_keys`, and ordinary non-Tailscale SSH continues to work. Its revocation docs explicitly warn that another access route such as an SSH key must be revoked separately. ([Tailscale](https://tailscale.com/docs/features/tailscale-ssh)) | Root can disable/remove the guest-side service or open another SSH listener unless something outside the guest prevents bypass. External policy remains authoritative only for the external service's path. | This is the one boundary that can remain administratively reachable after the panel's own OpenSSH key stops working, because policy lives in another control plane. It can also work without OpenSSH: Tailscale SSH routes tailnet port 22 to its own SSH server. Remove/replace the Tailscale agent, however, and that path disappears. ([Tailscale](https://tailscale.com/docs/features/tailscale-ssh)) |

The particularly important distinction in the third row is **enumerating sources versus enumerating credentials**. “Here are all files, CAs and commands OpenSSH currently consults” may be achievable. “Here are all keys that could successfully authenticate” generally is not.

## 3. Per-key restrictions are not account restrictions

This is probably the easiest combined UI to get dangerously wrong.

In an `authorized_keys` entry, `command="..."` means that command is selected **when that key is used for authentication**. OpenSSH's own manual even gives “a key that permits remote backups” as an example. But the manual immediately warns that TCP/X11 forwarding remains possible unless explicitly prohibited; `restrict` disables port, agent and X11 forwarding, PTY allocation and user `~/.ssh/rc`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8))

So these two statements are materially different:

> **Safe:** “When this key authenticates through this entry, OpenSSH forces `/usr/local/bin/backup` and applies `restrict`.”

versus

> **False in general:** “The `backup` account can only run backups.”

The second becomes false as soon as the same account has an unrestricted second key, a certificate, password/keyboard-interactive access, another matching copy of the same key, Tailscale SSH, or another SSH daemon.

Even moving the forced command into `sshd_config` does not automatically mean “the connection can only do this.” OpenSSH 10.5p1 explicitly says `ForceCommand` by itself does **not** prohibit TCP, agent, socket or X11 forwarding; those need separate restrictions such as `DisableForwarding`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5))

This illustrates why managing several surfaces together can create a **stronger-looking but less truthful abstraction**. A UI that has an Account page, Keys page and Server Configuration page may tempt designers to synthesize “Effective access: backup only.” Unless it has proved every relevant authentication path and channel restriction, that synthesis is not justified.

## 4. The boundaries do not compose monotonically

Managing one entry + its whole file does not turn the file into the account's complete authorization set.

Managing every statically discoverable public-key source + `sshd_config` still does not turn public-key authorization into “who can log in,” because `AuthenticationMethods`, passwords, keyboard-interactive, GSSAPI, hostbased authentication and account validity remain separate inputs. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5))

Adding the Unix account still does not give complete SSH authority. Another SSH daemon or an external service can authenticate an external identity and launch the resulting session as that same Unix account.

Adding Tailscale-like policy also does not make the set complete unless **all SSH ingress is forced through it**. Tailscale is unusually explicit about this: its January 5, 2026 documentation says the traditional `sshd_config` and `authorized_keys` path remains available outside Tailscale, and revoking one path does not revoke the other. ([Tailscale](https://tailscale.com/docs/features/tailscale-ssh))

The only architecture that can support a durable statement like **“only identities shown here can establish SSH to this VPS”** despite customer root is one whose enforcement boundary is somewhere the customer cannot rewrite: for example a provider-controlled network/hypervisor gateway that prevents direct SSH ingress and forces all SSH through an external identity proxy. At that point, however, the guest is **no longer the sole authority for access state**. That is a different product contract, not merely a larger version of guest-side key management.

## 5. What “instance is authoritative” forces the panel to do

Under your stated architecture, the panel is best understood as a **live editor/viewer of guest state**, not a source of truth.

If root removes a key, edits a file, changes an `Include`, replaces OpenSSH, changes the management account, blocks the provider key, or installs another daemon, that change is authoritative immediately. The panel should rediscover it rather than silently “reconcile” it to a database value. If there truly is no durable copy of desired access state outside the guest, there is nothing with which to perform such reconciliation anyway.

Likewise, the state presented while the machine cannot be contacted should be **“unavailable / cannot determine”**, not a stale green “SSH key enabled” indicator. The same applies to the provider's own management key: because it lives inside the same root-controlled guest boundary, the customer can remove or bypass it. Once that happens, an SSH-only control panel has no special administrative power. Recovery through a console, rescue environment, metadata reinjection or hypervisor would constitute a separate control boundary.

There is also a useful concurrency consequence: for mixed customer/panel-managed files, the panel should do compare-and-swap-style writes—read, retain a version/hash, prepare an atomic replacement, and refuse/retry if the file changed meanwhile. Otherwise “the instance is authoritative” is undermined by the panel accidentally overwriting a customer's simultaneous edit.

## 6. Customer-facing names that do not overstate control

I would use names at approximately this precision:

| Actual resource | Defensible customer wording | Wording to avoid |
|---|---|---|
| One line | **Authorized-key entry in `/root/.ssh/authorized_keys`** | “SSH key on this server” |
| One file | **Authorized keys file: `/root/.ssh/authorized_keys`** | “All SSH keys” |
| OpenSSH pubkey policy | **OpenSSH public-key authorization sources for `root` — live inspection** | “Everyone who can SSH” / “All authorized keys” |
| Server config | **OpenSSH server configuration** | “SSH security settings” if other servers can exist |
| OS account | **Linux account `alice`** | “SSH user” if other auth paths are not included |
| External service | **Tailscale SSH access policy** | “SSH access to this VPS” unless bypass paths are externally impossible |

For an entry with restrictions, make the grammatical subject the **authentication path**, not the Unix account: “This key is restricted when used through this entry,” not “This user is restricted.”

That naming approach is not merely theoretical. Current VPS products sometimes deliberately keep the control-plane “SSH key” concept narrow. DigitalOcean documentation, **last verified July 13, 2026**, states that team keys can be injected at Droplet creation but the control panel cannot add or modify keys on an existing Droplet; existing guest state is changed from the command line. ([DigitalOcean](https://docs.digitalocean.com/products/droplets/how-to/add-ssh-keys/?utm_source=chatgpt.com)) Hetzner documentation, **last changed June 2, 2026**, likewise says console SSH keys can only be stored when a cloud server is created and directs existing-server changes to guest/rescue editing of `authorized_keys`. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/how-to-rescue/change-ssh-key/?utm_source=chatgpt.com)) These are product choices rather than protocol requirements, but they show a useful discipline: creation-time injection and live guest authorization are treated as different resources rather than pretending the cloud account's key list remains authoritative afterward.

### Bottom line

With customer root and an SSH-only management channel, the strongest generally truthful promise is **about a specifically named object or evaluator that the panel most recently observed or changed**, not about the VPS's total SSH-access capability.

A single entry is narrow but precise. A whole file is broader but still just one configured source. “All OpenSSH public-key sources” is a decision policy rather than an enumerable list of keys. `sshd_config` controls one OpenSSH invocation, not the OS or every SSH listener. An account is an OS identity, not an SSH policy. An external access service can give much stronger centralized control over **its own ingress path**, but only a provider-controlled, non-bypassable enforcement plane can justify a machine-wide access claim—and introducing one gives up the premise that access authority resides solely inside the instance.
