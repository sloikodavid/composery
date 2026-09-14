# Compare SSH Key Management

Source: https://chatgpt.com/share/6aa74924-3768-83eb-ac46-8f7be9be7081

---

**User**

Compare the smallest complete ways for a Convex-backed VPS product to install and revoke customer SSH keys: backend-initiated SSH, a narrowly scoped guest helper fetching desired state over HTTPS, and static OpenSSH trust configuration with client-renewed certificates. V1 uses Hetzner Cloud; future backends may be self-hosted VMs. Customers have root and may remove the integration. Enrollment uses a single-use bearer secret and locally generated customer keys. Analyze initial bootstrap, trustworthy host-key acquisition, management-credential isolation and rotation, network reachability from hosted Convex, concurrent updates, lost responses, recovery after SSH breaks, and snapshot rollback. Compare total operational machinery, not merely code size. Use primary sources and concrete implementations. Do not assume we already need a general guest agent.

---

**ChatGPT**

I’ll compare these as end-to-end control planes, including failure recovery and rollback—not just the “edit `authorized_keys`” path. I’ll ground the conclusions in Convex, Hetzner, OpenSSH, and systemd/cloud-init primitives, then give the smallest concrete V1 shape for each.

---

**ChatGPT**

Two constraints are already shaping the answer. Hosted Convex has documented shared regional egress addresses, so direct SSH is network-feasible only if port 22 is public/allowlisted to those shared ranges; and Convex actions are explicitly non-transactional side-effect workers that are not auto-retried, so an SSH write path needs its own idempotency/reconciliation protocol. 

Also, because the customer has root, no design can make an on-guest management credential secret from that customer or guarantee revocation after they deliberately remove/replace the integration. The useful security goal is therefore *blast-radius containment and clean opt-out*, not tamper resistance against root.

---

**ChatGPT**

The key distinction is now clear: the pull-helper and certificate designs make Convex an HTTPS control plane, while direct SSH makes Convex part of the server’s management network. Hetzner’s private Networks are explicitly non-Internet addresses; direct SSH therefore either needs a public/reachable port 22 (typically firewalled to Convex’s shared egress ranges) or, later, a bastion/VPN/relay for self-hosted/private VMs. 

Snapshots are another discriminator: Hetzner snapshots are disk copies. Anything stored on disk—management public keys, helper tokens, CA trust files, SSH host private keys—rolls back with the disk, so each design needs an explicit anti-staleness story rather than assuming rollback is transparent.

---

**ChatGPT**

For this product, the three designs are not equally “small” once you count networking, recovery, credential rotation, rollback, and reconciliation.

**My ordering for V1 is:**

1. **Static OpenSSH user-CA trust + short-lived client-renewed certificates** if a bounded revocation delay is acceptable.
2. **A deliberately tiny pull helper** if you require near-immediate raw-key install/removal or want automatic repair after an `authorized_keys` rollback.
3. **Backend-initiated SSH** only if you specifically want zero persistent guest process and are willing to make public/reachable SSH, host-key bootstrapping, reconciliation, and provider-specific rescue part of your control plane.

The certificate design has the least *routine* operational machinery; the helper has the cleanest *failure and rollback* behavior. Direct SSH looks smallest in code and is largest in surrounding infrastructure.

## Side-by-side

| Concern | Convex → SSH | Guest pulls HTTPS desired state | Static SSH CA + client renewal |
|---|---|---|---|
| Persistent guest component | No daemon; small forced-command handler is advisable | Yes, tiny timer/oneshot | None |
| Convex needs network path to VM | **Yes, TCP/22** | No | No |
| VM needs outbound HTTPS | Only one-time bootstrap if pinning host key by callback | **Yes** | Only one-time bootstrap, if using host-key callback |
| Per-VM guest credential | No | **Yes**, read-only pull credential | No |
| High-value backend credential | SSH management private key | None for host management | **SSH user-CA private key** |
| Raw customer keys stored on VM | Yes | Yes | No |
| Normal revoke latency | Seconds, subject to action/retry | Poll interval | Certificate TTL |
| Concurrent updates | Must solve stale SSH writers | Naturally reconcile generations | Almost entirely Convex-side |
| Lost response | Needs idempotent remote apply | Naturally retried | Client retries issuance |
| Can repair wrong managed key file after SSH auth breaks | No | **Yes** | Usually irrelevant; routine ops never modify it |
| Can repair broken `sshd` | No | No, unless helper scope grows | No |
| Snapshot rollback of customer access state | Weak unless reconciled | **Strong** | **Strong** for customer keys |
| Management credential rotation | Distributed host rollout | Easy-ish, but conflicts with old snapshots | User keys easy; **CA rotation hard** |
| Private/self-hosted future VM | Needs route/bastion/VPN/relay | **Natural fit** | **Natural fit** |
| Overall V1 machinery | High | Medium | Lowest if TTL revocation is acceptable |

A useful baseline for the two raw-key approaches is **not to edit `/root/.ssh/authorized_keys` as your data store**. Bootstrap sshd with a second managed file, e.g. `AuthorizedKeysFile .ssh/authorized_keys /etc/vps-access/%u.keys`. OpenSSH permits multiple authorized-key files. Your product then atomically replaces only `/etc/vps-access/root.keys`; customer-owned keys and the product integration do not have to merge lines. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

Because customers have root, none of these designs provides enforcement against an owner who deliberately opts out. Root can remove a CA, disable the helper, delete your management key, or simply add a raw key of their own. “Revoked” therefore means **revoked from the product-managed access path while the integration remains installed**, not an access-control boundary against the machine owner.

---

# 1. Backend-initiated SSH

### Smallest complete implementation

At provisioning, use Hetzner `user_data`/cloud-init to install:

```text
/etc/ssh/sshd_config.d/60-vps-access.conf
/etc/vps-access/root.keys
/usr/local/libexec/vps-keys-apply
```

and one management public key such as:

```text
restrict,command="/usr/local/libexec/vps-keys-apply" ssh-ed25519 AAAA... product-control
```

in root's ordinary `authorized_keys`.

`restrict` disables forwarding, PTYs, agent forwarding, X11 and user rc execution, and `command=` forces the designated command instead of arbitrary shell execution. That makes a stolen management key much less powerful than a normal root SSH key: it should be capable only of replacing the managed customer-key file. ([OpenBSD Manual](https://man.openbsd.com/sshd.8?utm_source=chatgpt.com))

On the Convex side, a `"use node"` action can use a normal Node SSH client such as `ssh2`. `ssh2` supports private-key authentication and a `hostVerifier`; critically, its documented default is to auto-accept a server host key when `hostVerifier` is absent, so pinning must be explicit. Convex supports Node actions for Node APIs and publishes egress addresses for external connections. ([Convex Developer Hub](https://docs.convex.dev/functions/runtimes?utm_source=chatgpt.com))

The actual protocol should be a **generation-based replace**, not “add this line” and “delete that line”:

```text
desired generation: 47
full desired /etc/vps-access/root.keys contents
```

The forced command takes an exclusive `flock`, reads an `applied-generation` file, rejects/no-ops generations `<=` the current one, writes a temporary file with correct owner/mode, renames it atomically, then updates the generation. This solves both concurrent Convex actions and replay.

### Initial bootstrap and host-key trust

This approach has a hidden bootstrap problem: before Convex can safely SSH to the new server, it needs a trustworthy SSH host key.

Hetzner can inject customer SSH public keys when a server is created and accepts cloud-init user data, but adding a Hetzner SSH key later does not modify an existing server. Cloud-init normally generates the server's host keys itself. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/?utm_source=chatgpt.com))

The cleanest option is a **one-shot cloud-init callback**, not TOFU:

```text
POST https://<deployment>.convex.site/server-bootstrap
Authorization: Bearer <one-time-machine-bootstrap-token>

{
  provider: "hetzner",
  instanceId: 123456,
  hostKey: "ssh-ed25519 AAAA..."
}
```

Bind that token in Convex to the server ID you just created. Hetzner exposes its numeric instance ID in the link-local metadata service, so the boot script can include it. After successful registration, delete the bootstrap token locally. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

The other technically possible approach is to pre-generate the SSH host private key and put it in cloud-init. Cloud-init supports supplied host private/public keys, but its own documentation warns that private host keys in cloud configuration may be exposed depending on the cloud's security model. I would not choose that merely to save one HTTPS callback. ([Cloud-Init](https://cloudinit.readthedocs.io/en/latest/reference/modules.html?highlight=ssh_pwauth&utm_source=chatgpt.com))

### Networking is the large hidden cost

Hosted Convex publishes regional outbound IPs, but they are **shared between deployments and must not be treated as authentication**. Hetzner firewalls can allow port 22 from selected source CIDRs, so V1 can allow Convex's current regional egress ranges plus whatever customer SSH ingress you need. ([Convex Developer Hub](https://docs.convex.dev/production/networking?utm_source=chatgpt.com))

That works, but it makes “Convex must be able to reach TCP/22” an architectural invariant. Hetzner private Networks use addresses that are not on the Internet. A later VM reachable only on a private hypervisor LAN therefore needs a bastion, tunnel, VPN, relay, or another worker placed inside that network. Those are not details of the SSH library; they are new control-plane components. ([Hetzner Docs](https://docs.hetzner.com/networking/networks/overview/?utm_source=chatgpt.com))

That is the main reason I would not make direct SSH the default abstraction for future backends.

### Credential isolation and rotation

The absolute-smallest design is one Convex environment variable holding a fleet management private key. Convex environment variables are intended for secrets, but authorized project/deployment administrators can view/manage them; this is not an HSM boundary. ([Convex Developer Hub](https://docs.convex.dev/production/environment-variables?utm_source=chatgpt.com))

The forced command meaningfully reduces the consequence of that key leaking, because it cannot normally open a shell. Per-server management keys further reduce blast radius but create one private key per VM plus storage/encryption/rotation machinery.

Rotation is distributed state:

```text
host accepts old mgmt pubkey
→ install new pubkey on every host
→ verify new key works
→ remove old pubkey everywhere
→ destroy old private key
```

An offline host delays completion. A host restored from an old snapshot may contain only the old key.

### Concurrent updates and lost SSH responses

Convex mutations are transactional and serializable, but actions are side-effecting and aren't automatically retried. Convex explicitly recommends modeling intent in a mutation and scheduling the action from there; scheduled actions execute at most once, so transient failures require application-level reconciliation. ([Convex Developer Hub](https://docs.convex.dev/database/advanced/occ?utm_source=chatgpt.com))

So use Convex as:

```text
mutation:
    update desiredKeys
    desiredGeneration += 1
    schedule reconcile(serverId)

action:
    read current desiredGeneration + complete key file
    SSH apply(generation, contents)
    mutation markApplied(generation)
```

If the VM successfully installs generation 47 but the SSH connection dies before Convex sees the response, retrying 47 is harmless. The VM reports “already at 47”. Without that host-side generation check, the lost-response case is ambiguous and concurrent actions can let an older write overwrite a newer one.

### When SSH itself breaks

This design cannot repair its own transport.

Hetzner's Rescue system can be activated out-of-band and can inject a selected SSH key into the rescue environment; Hetzner explicitly documents using Rescue to mount/chroot the disk and repair `authorized_keys`. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/rescue-system/?utm_source=chatgpt.com))

Therefore the **complete** direct-SSH architecture includes a Hetzner rescue adapter and, eventually, an equivalent rescue/console/disk-mount interface for every self-hosted backend. Otherwise “SSH got broken” is a manual support incident.

### Snapshot rollback

This is the nastiest design under rollback.

A Hetzner snapshot is a disk copy. Rolling back can therefore restore an old customer-key file, an old management public key, and an old SSH host private key. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/?utm_source=chatgpt.com))

If the current management key is still in that snapshot, the next reconcile repairs customer keys. If the management key was rotated since the snapshot, Convex may be unable to enter. If the SSH host key was rotated since the snapshot, the pin can also fail.

You can preserve old credentials to improve rollback survivability, but that conflicts directly with meaningful credential revocation. Rescue is the real backstop.

**Result:** no persistent agent, but substantial networking, reconciliation, host-trust and rescue machinery.

---

# 2. Narrow guest helper pulling desired state over HTTPS

This is much more attractive than the phrase “guest agent” suggests if its scope is genuinely tiny.

It does not need an RPC framework, websocket, package-management system, arbitrary command execution, telemetry channel, or general guest orchestration.

### Smallest complete implementation

Cloud-init installs one executable plus a systemd oneshot and timer:

```text
/usr/local/libexec/vps-access-sync
/etc/vps-access/machine-token
/etc/systemd/system/vps-access-sync.service
/etc/systemd/system/vps-access-sync.timer
```

Conceptually:

```text
GET /servers/<id>/ssh-access
Authorization: Bearer <per-server-token>

200
{
  "generation": 47,
  "authorizedKeys": "...complete file..."
}
```

If `generation > local generation`, validate the response, write a temporary file, `fsync`/rename it onto `/etc/vps-access/root.keys`, then record 47.

A systemd timer can run it after boot and periodically using `OnBootSec=` and `OnUnitActiveSec=`; `RandomizedDelaySec=` is available to avoid all machines polling simultaneously. ([GitHub](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml?utm_source=chatgpt.com))

A 30–60 second interval is already operationally simple. Add ETag/`If-None-Match` if fleet size makes empty responses material. Long polling is not needed in V1.

The service may run as root because its one job is replacing a root-owned SSH key file, but it can still be sandboxed so almost the entire filesystem is read-only except `/etc/vps-access`; systemd provides `ProtectSystem`/write allowlisting primitives for precisely this sort of service confinement. ([man7.org](https://www.man7.org/linux/man-pages/man5/systemd.exec.5.html?utm_source=chatgpt.com))

### Machine credential security

The guest credential cannot be protected from the customer: the customer has root.

That means trying to hide it with systemd credentials, TPM gymnastics, obfuscation, etc. does not solve the stated threat model. Instead make the credential **nearly worthless**:

```text
scope = this one server
allowed:
    GET desired SSH state
    optionally report applied generation
not allowed:
    change desired keys
    issue enrollment tokens
    administer account
    read other machines
```

Store only its hash in Convex.

A stolen token then reveals the public SSH keys intended for that one machine and perhaps permits a false “applied” acknowledgment. It cannot grant access or affect another VM.

Because root can copy it anyway, periodic rotation of this token has little value against the owner. A long-lived per-instance pull credential is actually better operationally for snapshot recovery. Rotate on explicit re-enrollment, suspected accidental leakage, or server replacement rather than on a short calendar.

### Bootstrap and host keys

This design gets trustworthy host-key acquisition almost for free.

On its first authenticated HTTPS request, the helper can send:

```text
instance-id
ssh_host_ed25519_key.pub
```

and Convex records the key before any client is told to SSH to that address. Hetzner metadata provides the instance ID. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

The customer CLI can fetch the pinned host key from Convex and use a product-owned `known_hosts` file. You do not need TOFU.

For future self-hosted VMs, use the same protocol with whatever immutable VM ID the provisioner gives you. cloud-init's NoCloud datasource can be supplied through local media or an HTTP(S) seed, so this bootstrap pattern is not Hetzner-specific. ([GitHub](https://github.com/canonical/cloud-init/blob/main/doc/rtd/reference/datasources/nocloud.rst?utm_source=chatgpt.com))

### Concurrent updates

This is the simplest of all three for raw keys.

Convex's transaction increments one monotonic generation and stores the **complete desired state**. Twenty simultaneous add/remove requests serialize into some final generation because mutations are serializable. The VM doesn't have twenty operations to apply; it asks “what is current?” and converges to the newest complete file. ([Convex Developer Hub](https://docs.convex.dev/database/advanced/occ?utm_source=chatgpt.com))

There is almost no distributed ordering protocol.

### Lost responses

Lost GET response: nothing happened; poll again.

Apply succeeded but ACK was lost: next request can include `appliedGeneration=47`, or Convex can simply regard “applied” as advisory.

The helper must never require a successful ACK before accepting the next desired state. Desired state is authoritative; ACK is observability.

### Recovery after SSH breaks

This is the one architecture that can recover from **product-managed customer key state** being broken without using SSH.

If `/etc/vps-access/root.keys` gets restored to an old version, truncated, or otherwise wrong while the OS, networking, timer and sshd configuration still function, the helper rewrites it from HTTPS.

That does **not** justify turning it into a general repair agent. If the customer deletes the helper, breaks networking, deletes the sshd `AuthorizedKeysFile` config, or makes `sshd` fail to start, use provider rescue. Keeping this boundary sharp is important.

### Snapshot rollback

This is where the helper is strongest.

A rollback restores stale customer keys **and the machine pull credential**. If the credential remains stable, the next timer run gets generation 91 and overwrites the generation-40 key file from the snapshot.

A snapshot used to create a *different* VM also duplicates the token. On Hetzner, compare the metadata `instance-id` with the ID to which the token was issued and refuse if it differs. That prevents an accidental clone from becoming a second incarnation of the same managed server. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

Aggressive machine-token rotation damages this nice property: an old snapshot contains a now-invalid token and cannot self-heal. There is no magic protocol that simultaneously invalidates all old copies of a secret and lets arbitrary old snapshots authenticate with those copies. You must choose.

For this threat model I would choose **stable, narrowly scoped pull credential + explicit server incarnation binding**.

**Result:** one tiny persistent component, but substantially less infrastructure around it than direct SSH.

---

# 3. Static OpenSSH trust + short-lived client certificates

This stops treating “install the customer's public key on every server” as the primitive.

Instead, install trust once.

OpenSSH supports `TrustedUserCAKeys`: a server trusts user certificates signed by the listed CA, and certificate principals determine which accounts they may authenticate to. OpenSSH certificates also carry validity intervals. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

A bootstrap configuration can be as small as:

```text
# /etc/ssh/sshd_config.d/60-vps-access.conf
TrustedUserCAKeys /etc/vps-access/user_ca.pub
AuthorizedPrincipalsFile /etc/vps-access/principals/%u
```

For server `abc123`:

```text
# /etc/vps-access/principals/root
vps:abc123
```

Then issue certificates only with principal `vps:abc123`. This also prevents an accidentally issued certificate for one server from simply being reused on another.

### Client flow

The customer creates the private key locally:

```bash
ssh-keygen -t ed25519 -f ~/.config/yourproduct/servers/abc123
```

Enrollment sends only the public key plus the single-use bearer.

Convex stores:

```text
keyId
serverId
publicKey
fingerprint
active=true
```

and returns a short-lived OpenSSH certificate.

The reference OpenSSH operation is equivalent to:

```bash
ssh-keygen \
  -s user_ca \
  -I key:<keyId> \
  -n vps:abc123 \
  -V -1m:+10m \
  -z <serial> \
  customer_key.pub
```

OpenSSH documents the identity, principals, serial and validity interval fields directly. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen.1?utm_source=chatgpt.com))

Your CLI renews, say, every five minutes. `ssh` supports an explicit `CertificateFile` alongside the private `IdentityFile`. ([OpenBSD Manual](https://man.openbsd.com/ssh_config.5?utm_source=chatgpt.com))

If the CLI has an existing product login/session, use that to authorize renewal. If it does not, the smallest self-contained addition is a **per-enrolled-key renewal bearer** that can only request a certificate for the already-recorded public key; possession of this bearer without the private SSH key still does not permit SSH authentication.

Do not reuse the one-time enrollment token as a permanent renewal credential.

### Signing inside Convex

OpenSSH's own `ssh-keygen` is the normative implementation, but a hosted Convex action cannot sensibly depend on invoking that executable.

A concrete Node implementation is `@peculiar/ssh`, whose current API supports SSH key import plus OpenSSH certificate creation/signing on WebCrypto, so the signing action can stay inside the Node runtime. ([npm](https://www.npmjs.com/package/%40peculiar/ssh?utm_source=chatgpt.com))

That is operationally smaller than running a separate signing machine. If you are uncomfortable making a comparatively young JavaScript SSH-certificate library part of a root-access path, running a dedicated signer using OpenSSH itself is the more conservative cryptographic implementation—but that adds another service, deployment, secret flow and failure domain. Count that honestly.

### Revocation semantics

“Revoke customer key” becomes:

```text
mutation:
    active = false
```

After that, the certificate endpoint stops issuing new certificates for that public key.

Any certificate already issued remains usable until its `valid-before` time. OpenSSH rejects certificates outside their validity window. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen?utm_source=chatgpt.com))

With `-1m:+10m`, your normal worst-case new-login revocation delay is about ten minutes, ignoring clock issues and an issuance already in progress at the revocation boundary.

Also, certificate expiry is checked during authentication; it is not a remote session killer. A user with an already-established root SSH session doesn't get disconnected merely because the certificate expires. The same general point applies to deleting a raw key: it prevents later authentication, not an already-running shell.

If you require “this key must stop creating new SSH sessions in <30 seconds”, use a much shorter certificate lifetime or use the pull helper.

OpenSSH does support KRLs through `RevokedKeys`, but distributing an updated KRL puts you straight back into a host-state distribution problem, and OpenSSH explicitly requires the revocation file to be atomically replaced. I would not add KRL distribution to V1 unless you already chose the helper architecture. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

### Host authentication is still separate

User certificates solve **server trusting customer**, not **customer trusting server**.

You still need a host-key story.

The smallest one is the same one-shot provisioning callback described above: cloud-init sends the newly generated host public key to Convex using a machine-bootstrap capability, Convex records it, and the CLI gets a pinned `known_hosts` entry.

You could also operate an OpenSSH **host** CA and give each VM a host certificate; OpenSSH supports host certificates as well. ([OpenBSD Manual Pages](https://man.openbsd.org/cgi-bin/man.cgi/OpenBSD-current/man1/ssh-keygen.1?utm_source=chatgpt.com))

But unless you otherwise need host certificates, that adds a second CA lifecycle for very little V1 benefit. A pin from an authenticated first-boot callback is smaller.

### CA-key isolation is the real cost

The private user-CA key is extraordinarily powerful. A compromised fleet CA can mint a valid root-access certificate.

Putting it in a Convex environment variable is mechanically simple, and Convex explicitly positions environment variables as a place for API keys/secrets, but authorized admins can retrieve/manage those values. ([Convex Developer Hub](https://docs.convex.dev/production/environment-variables?utm_source=chatgpt.com))

So there are two honest versions of this design:

**Smallest V1:** one production CA private key in a tightly administered Convex deployment secret.

**Hardened production:** signer behind a KMS/HSM or small dedicated signing service, with Convex authorized to request narrowly constrained signatures.

The second is more machinery and must be counted against the architecture.

You can also use per-server CAs to reduce blast radius, but now you have as many signing credentials as machines. That is security isolation, not operational simplification.

### Concurrency and lost responses

There is no distributed guest update.

Convex's serializable mutation decides whether the key is active. The signing action reads that state immediately before issuance and returns a certificate. Concurrent enrollment/revocation therefore reduces to application-level authorization rather than remote file races. ([Convex Developer Hub](https://docs.convex.dev/database/advanced/occ?utm_source=chatgpt.com))

A lost certificate response is cheap: request another certificate.

Do not rotate a one-time refresh credential on every certificate request unless you really need to; response loss then creates the classic “server advanced token, client never received it” recovery problem.

For the *initial single-use enrollment bearer*, make consumption **transport-idempotent**: the first public-key fingerprint presented consumes the capability, but a short-window replay with the *same token and exact same fingerprint* should return the same logical enrollment rather than attempting to bind a second key. “Single use” should mean “can authorize only one enrollment”, not “one TCP response or you're bricked.”

### Recovery and snapshots

Routine add/revoke operations cannot corrupt the guest because they never modify it. This is a very strong property.

If `sshd_config`, the CA public key or the principals file is deleted, there is no guest control channel to repair it; Hetzner Rescue is the fallback. But your normal customer-key API cannot be the thing that caused that failure.

Snapshots are excellent for ordinary customer-key revocation: the snapshot contains **no list of current customer keys**. Restore a six-month-old snapshot and a key revoked yesterday still cannot obtain a new certificate. Any old certificate on a client should already be expired by wall-clock time.

The major exception is **CA rotation**. A snapshot contains the old CA public key. If the CA was rotated because the private key was compromised, restoring an old snapshot can restore trust in the compromised CA.

That means a real CA-compromise runbook must include invalidating/replacing affected snapshots or having some host-side mechanism to remove old trust. This is the certificate design's biggest hidden lifecycle cost.

Time synchronization also becomes security-relevant because certificate validity is time based.

---

# Total machinery

Counting only normal code makes direct SSH appear tiny:

```text
ssh.connect()
write authorized_keys
```

But the complete system is really:

```text
Node SSH runtime
+ private management key
+ SSH host-key enrollment/pinning
+ public TCP/22 path from hosted Convex
+ Hetzner firewall rules for shared Convex egress
+ generation/idempotency protocol
+ failure retries
+ credential rotation rollout
+ provider Rescue integration
+ a future answer for private/self-hosted networks
```

Convex's egress addresses being shared is particularly important: the firewall restriction is defense in depth, not identity. ([Convex Developer Hub](https://docs.convex.dev/production/networking?utm_source=chatgpt.com))

The helper is:

```text
HTTPS desired-state endpoint
+ per-server low-value token
+ ~one small executable
+ systemd timer
+ generation + atomic replace
+ clone/incarnation check
```

It is more guest code but less distributed-systems machinery.

Certificates are:

```text
one static sshd trust bootstrap
+ customer-side renewal logic
+ certificate signing
+ CA custody
+ host-key pin bootstrap
+ time-based revocation semantics
+ rare CA-rotation/rescue runbook
```

That is the smallest normal-operation system because **customer access changes stop being server mutations altogether**.

## Recommendation

For V1, I would use **short-lived OpenSSH user certificates** if you can productize revocation as “no new SSH authentication after at most N minutes” rather than instantaneous raw-key removal. A concrete starting point is a roughly 10-minute certificate with renewal around halfway through its lifetime, one static CA trust configuration on the VM, per-server principals, and an independently pinned SSH host key. It gives you no persistent guest credential, no Convex→VM management network, no reconciliation queue, and no routine operation capable of bricking `authorized_keys`.

I would choose the **narrow pull helper instead** if either of these is true: you require sub-minute/near-immediate raw-key revocation, or you value automatic recovery from snapshot-restored/stale key files enough to accept one tiny systemd-managed component. Keep it deliberately below the threshold of “general guest agent”: one HTTPS GET, one managed file, one generation counter, no arbitrary commands.

I would **not choose backend-initiated SSH as the foundational V1 abstraction** for a hosted-Convex product. It is workable on Hetzner today—Convex has documented egress IPs, Hetzner can firewall port 22 by source, and Node has mature SSH clients—but it turns network reachability and provider rescue into permanent architectural obligations precisely when you already know future machines may live outside Hetzner's public-cloud networking model. ([Convex Developer Hub](https://docs.convex.dev/production/networking?utm_source=chatgpt.com))

The one caveat that could flip the recommendation is **CA-key custody**: if your security bar says a fleet-wide root-equivalent CA may not live in Convex deployment secrets, and introducing a proper external signer is out of scope for V1, the narrow HTTPS pull helper is probably the best overall minimum rather than certificates.
