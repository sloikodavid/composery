# Bootstrap SSH Trust

Source: https://chatgpt.com/share/6aa7768b-8eec-83eb-bd29-84ca59035b1a

---

## Turn 1: User

_2026-09-14T04:04:59.223Z_

We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Trace a complete trusted bootstrap for a fresh Hetzner Cloud Ubuntu VPS, from an authorized create request to independent customer SSH and authenticated backend management. Inspect Hetzner API documentation, image/cloud-init behavior, and OpenSSH source where useful.

Identify where management keys, customer keys, host keys, and any one-time bootstrap authority originate, travel, persist, and disappear. Compare concrete host-trust acquisition methods. Explain why each proves machine identity, rather than merely observing a network response. Account for cloud-init status, unavailable callbacks, duplicated delivery, provider action completion versus OS readiness, firewall rules, IPv4/IPv6, and secret exposure through metadata or logs.

Handle rebuilds, OS replacement, address reuse, restored disks, cloned snapshots, host-key rotation, and broken SSH. Separate provider recovery from ordinary key edits. Specify safe behavior if a machine or disk is not the expected identity. Do not assume host keys identify a unique allocation after cloning.

Give the minimum bootstrap and recovery protocol, dependencies on provider capabilities, and pass/fail experiments. Do not require customer SSH connections to depend on an online platform service afterward.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.

---

## Turn 2: ChatGPT

_2026-09-14T04:05:00.258Z_

I’ll trace this as a security protocol rather than a provisioning recipe: provider API authority → first-boot authority → host identity acquisition → independent customer SSH → authenticated management, then test failure/rebuild/recovery paths against the same trust invariants. I’ll separate what Hetzner/OpenSSH/cloud-init actually guarantee from what Composery would need to add.

---

## Turn 3: ChatGPT

_2026-09-14T04:05:23.242Z_

A key distinction is already clear from Hetzner’s own interfaces: the create call returns a cloud “Action” and the server object, while cloud-init runs later inside the guest. So an action reaching `success` is not evidence that Ubuntu has completed first boot; Composery needs an in-guest readiness proof before it can trust SSH state.

---

## Turn 4: ChatGPT

_2026-09-14T04:09:30.313Z_

The host-trust conclusion is stronger than “pin whatever key answers first”: RFC 4253 explicitly says accepting an unverified host key makes SSH insecure against active attacks, and OpenBSD-current’s `ssh-keyscan(1)` gives the same warning. A customer/management public key authenticates the **client to the server**; it does not bootstrap trust in the server.

---

## Turn 5: ChatGPT

_2026-09-14T04:20:51.494Z_

## Recommendation

Use a **pull-based, one-time enrollment proof to authenticate the guest-generated SSH host key**, then make ordinary SSH entirely native and offline-capable.

Do **not** bootstrap host trust from `ssh-keyscan`, TOFU, the fact that a customer/management public key was accepted, or the Hetzner IP address. RFC 4253 is explicit: accepting a host key without verification leaves SSH insecure against active attacks. The server signs the key exchange with its host private key, but the client still needs an independent reason to believe that public key belongs to the intended machine. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4253.html))

The minimum durable identity I would store in Composery is:

`{ provider=hetzner, server_id, allocation_generation, trusted_host_keys }`

The host key is **not** the allocation identifier. Hetzner snapshots/backups are disk copies and can create duplicates, so they can copy host private keys, `authorized_keys`, cloud-init state, and Composery markers verbatim. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/))

This is compatible with your server-authoritative working direction: Composery need not keep a durable customer-key inventory. It **does** need durable machine-trust state.

---

## Evidence and version boundary

As researched on **14 September 2026**, Ubuntu 24.04 Noble's update archive exposes `cloud-init 26.1-0ubuntu1~24.04.1` and `openssh-server 1:9.6p1-3ubuntu13.19`. Those are archive versions; they do **not** prove which versions are baked into today's Hetzner Ubuntu image, so record `dpkg-query`/`cloud-init --version` on every qualification run. ([Ubuntu Packages](https://packages.ubuntu.com/source/noble-updates/cloud-init))

For source-level cloud-init claims below I inspected **upstream cloud-init 26.1**, tag dated **2026-02-28**, commit `8bf3567532b07e2cc15aa4c76c36ebed65ccfaec`.  For OpenSSH source claims I inspected **OpenSSH Portable 9.6p1**, tag `V_9_6_P1`, dated **2023-12-18**, commit `8241b9c0529228b4b86d88b1a6076fb9f97e4a99`.  Ubuntu carries patches on top of that Portable release, so source-sensitive behavior should also be exercised against Ubuntu's actual package.

RFC 4252 and RFC 4253 are the January 2006 SSH protocol specifications. OpenBSD manual-page evidence below is explicitly **OpenBSD/OpenSSH documentation**, not a claim that Ubuntu ships OpenBSD-current. For example, OpenBSD's `ssh-keyscan(1)` independently warns that constructing `known_hosts` from unverified scans leaves users vulnerable to MITM. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.8/ssh-keyscan.1))

### Minimum bootstrap protocol

1. **Authorize and durably record an allocation intent before touching Hetzner.** The public application operation checks the same Composery platform permission whether invoked from UI or a programmatic client. The client agent therefore needs a non-browser application credential, but it should enter the same operation/authorization layer rather than a privileged alternate API. Persist an operation/attempt ID first. Convex Actions are side-effecting, are not automatically retried, and have a ten-minute limit, so provisioning should be a resumable state machine rather than one long Action. Node 24 is currently a supported Convex Node Action runtime. ([Convex Developer Hub](https://docs.convex.dev/functions/actions))

2. **Generate four pieces of bootstrap state.** Generate a fresh allocation generation `G`; a random one-time secret `B` with short TTL; an ephemeral bootstrap SSH keypair; and a persistent per-server management keypair. The two private keys stay in Composery's trusted execution/secret-storage side. Customer private keys are never involved. `B` is the only secret that needs to cross the Hetzner provisioning channel.

3. **Create the server with the official Ubuntu 24.04 image and cloud-init user-data.** Include `G`, `B`, the bootstrap **public** key, and persistent management **public** key. Attach the firewall as part of provisioning where possible. During bootstrap, TCP/22 should be reachable only from the management execution plane on each enabled IP family. Hetzner Cloud Firewalls have implicit-deny inbound semantics; no outbound rules means outbound is permitted. Hetzner also always permits its metadata service through Cloud Firewalls. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/))

4. **Let the guest generate its own SSH host keys.** In cloud-init 26.1, `cc_ssh` is per-instance, deletes pristine-image host keys by default and generates RSA/ECDSA/Ed25519 host keys locally when explicit `ssh_keys` are not supplied. It then attempts to publish public host keys through the datasource.  Hetzner's 26.1 datasource does not implement such publication; the inherited base `publish_host_keys()` is an empty method. So there is no cloud-init→Hetzner host-key trust channel here.  

5. **At cloud-init Final, install a very small enrollment endpoint.** Give the ephemeral bootstrap public key an OpenSSH forced/restricted command rather than a general shell. The command accepts a fresh backend challenge and returns a canonical record containing at least `G`, the challenge, Hetzner instance/server ID, the DMI system serial, and all current SSH host public keys, authenticated with `HMAC(B, record)`. Install the persistent management public key as well, but the backend must not use it for management until enrollment has succeeded. `runcmd` itself only writes a script; `scripts_user` executes it in the Final stage, and both are once-per-instance, so the readiness marker must be produced at the end of the work you actually require.   

6. **Wait for two different notions of completion.** First wait for Hetzner's API Action to reach `success`; Hetzner defines that as its asynchronous tasks completing and target resources becoming consistent. That is a control-plane fact, not a statement that `cloud-final.service` has finished inside Ubuntu. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) Then probe SSH with retries. “Port 22 answered” is only reachability.

7. **Enroll the host key on one deliberately unpinned bootstrap SSH connection.** Record the SSH host key `K_seen` from that transport; authenticate with the ephemeral bootstrap client key; send a fresh challenge; verify the HMAC; require `G` to equal the pending generation; require attested metadata instance ID and DMI serial to equal one another and the Hetzner server ID returned/reconciled from the create operation; and require `K_seen` to be one of the HMAC-authenticated host keys. The exact cloud-init Hetzner datasource obtains user-data and metadata from the link-local Hetzner service and itself rejects metadata where instance ID differs from DMI `system-serial-number`.  

8. **Durably commit trust before consuming bootstrap authority.** Persist the provider server ID, `G`, complete trusted host-key set, and an enrollment audit digest transactionally. Only afterward reconnect using strict SSH host-key verification and the persistent management private key. Perform idempotent finalization: install any requested customer public keys, remove the ephemeral bootstrap authorized key/helper authority, and best-effort remove `B` from guest files. Then mark the backend copy of `B` consumed/expired and the server Ready. If a crash occurs after trust commit, the already-installed management public key lets Composery resume over the pinned channel without trusting a new host key.

That HMAC exchange proves more than “something answered at this IP.” Under the stated trust boundary, `B` was delivered through the authenticated Hetzner provisioning path to the allocation identified by its metadata/DMI ID, and the guest then cryptographically binds `B` to the exact SSH host key seen on the connection. A terminating MITM can invent an SSH host key and accept the public bootstrap credential, but it does not know `B`. It also cannot simply replay the backend's public-key authentication signature into a separate SSH connection to the real host: RFC 4252 signs the connection's unique session identifier as part of public-key authentication. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4252.html)) A transparent byte-for-byte relay leaves the real host key end-to-end, which is acceptable.

This is **not remote attestation against Hetzner or a pre-compromised root guest**. Either can obtain/control `B`. If that is in scope, the capabilities inspected here are insufficient; you need a non-forgeable hardware/provider attestation primitive such as a vTPM-backed identity.

---

## Where every authority goes

| Material | Origin → travel | Persistence and end of authority |
|---|---|---|
| Customer private key | Generated/held on Windows, macOS or Linux client; never sent to Composery or VPS | Client only. Ordinary SSH continues if Composery is offline. |
| Customer public key | Client → authenticated Composery operation → **strict-pinned** management SSH → native OpenSSH authorization file | Server/disk/snapshots until explicitly edited. Platform membership removal alone should not silently delete it. |
| Persistent management private key | Composery trusted execution/secret store | Never guest/provider. Rotate explicitly. |
| Persistent management public key | Composery → cloud-init → management account/authorization | Disk/snapshots. Non-secret. |
| Bootstrap private key | Composery | Ephemeral; delete after Ready. |
| Bootstrap public key | Composery → user-data → restricted forced-command authorization | Delete during strict-pinned finalization. |
| SSH host private keys | Generated in guest by cloud-init/`ssh-keygen` | `/etc/ssh/ssh_host_*_key`; copied by snapshots. Never use their mere uniqueness as allocation identity.  |
| SSH host public keys | Guest; exposed in SSH KEX and HMAC enrollment | Persist as Composery trust state and customer `known_hosts` material. |
| One-time `B` | Composery → Hetzner HTTPS create/rebuild user-data → link-local metadata → cloud-init → guest enrollment helper | Its **authority** ends when backend marks it consumed/expired. Residual bytes are not assumed erasable. |
| Hetzner API token | Composery only | Never send to guest. |

The final row for `B` deserves emphasis. Upstream cloud-init 26.1 writes raw user-data into the per-instance cloud directory with mode `0600`; its path map calls the raw copy `user-data.txt`. Thus deleting your bootstrap helper's copy does not mean the secret was never persisted.   The Hetzner datasource also retrieves user-data over plain HTTP from a **link-local** metadata endpoint, trying both link-local IPv6 and `169.254.169.254`. 

Therefore `B` must be short-lived and single-generation. Never place a reusable management private key, Hetzner token, customer private key, or long-lived application bearer token in user-data. Do not echo `B`, place it in command-line arguments, enable shell tracing around it, or assume snapshot/filesystem deletion securely erases it.

I found no primary documentation specifying the post-boot retention period or unprivileged-guest accessibility of Hetzner's `/hetzner/v1/userdata`. Treat that as an **unknown to test**, not as either confidential forever or publicly readable.

---

## Host-trust alternatives

| Method | Does it establish the intended machine? | Assessment |
|---|---|---|
| `ssh-keyscan`, TOFU, `accept-new` | **No.** It observes the key supplied by whoever controls the network path. RFC 4253 explicitly says unverified acceptance is insecure against active attack. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4253.html)) | Reject for bootstrap. |
| “It accepted our management/customer public key” | **No.** That authenticates the client to whoever is acting as server. RFC 4252 assumes server authentication has already happened. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4252.html)) | Reject as host identity. |
| Recommended `B`-authenticated pull proof | **Yes, under provider + fresh-image trust.** Binds provider allocation ID, fresh generation and actual SSH host key without a callback. | Baseline. |
| Guest callback containing host key + HMAC(B, …) | Same cryptographic basis as the pull scheme. | Fine optional fast path, but cannot be mandatory because callbacks may be unavailable. |
| Provider API publishes guest-generated host key bound to server ID | Could be excellent: identity derives from authenticated provider control plane rather than IP. | Not available via inspected Hetzner cloud-init datasource. |
| Provider console: locally display fingerprint/server ID and compare through authenticated Hetzner console | Strong independent channel because the console is selected through the provider resource, not by connecting to the target IP. | Good manual recovery/enrollment method. |
| Pre-generate host private key in Composery and supply it using cloud-init `ssh_keys` | **Yes, under provider confidentiality trust:** SSH proves possession of the pre-known private key. Cloud-init explicitly supports supplied private host keys.  | **Strongest simpler automated alternative**, but exposes a long-lived host private key to the API/user-data/cache/snapshot path. |
| DNS SSHFP/DNSSEC or an SSH host CA | Useful for distributing trust **after** authenticated enrollment. | Neither creates initial provenance by itself. |

I would choose the pre-generated-host-key alternative over the HMAC protocol only if you consciously decide that Hetzner user-data and all resulting cloud-init/snapshot persistence are an acceptable channel for a **long-lived host private key**. It eliminates the enrollment helper and shared secret, so it is materially simpler. Given the currently undocumented metadata-retention/access details, I would not make that trade by default.

---

## Live management after enrollment

The server-authoritative model is technically sound. In upstream Portable 9.6p1, `user_key_allowed()` iterates configured `AuthorizedKeysFile` paths during public-key authentication, and the file is opened/read for that authentication attempt. A normal `authorized_keys` content edit therefore does not require `sshd` reload in that code path.  

A Composery key operation should consequently be: platform authorization → strict-pinned management SSH → verify live Hetzner server ID/DMI and `G` marker → read current native state → apply a compare-and-swap/expected-hash edit → reread. That preserves out-of-band edits and avoids needing a persistent customer-key inventory.

The `G`/marker check is an **accident detector**, not a root-resistant attestation: customer root can alter files and command output. Customer root can also remove Composery's management key or break `sshd`; that is legitimate control of a customer-controlled VPS and should result in “management unavailable,” not silent privilege restoration.

After Ready, change the firewall from bootstrap policy to the customer's intended SSH policy. If customers must be able to SSH from arbitrary networks without Composery online, TCP/22 cannot remain restricted solely to Composery egress. Handle IPv4 and IPv6 independently: Hetzner permits IPv4-only, IPv6-only and dual-stack servers, and Primary IPs can later be detached/reassigned, which is another reason an address cannot be identity. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/))

Convex publishes IPv4 and IPv6 egress ranges, but warns those addresses are shared across deployments. Firewall source restrictions are therefore exposure reduction, never authentication; SSH cryptography remains mandatory. ([Convex Developer Hub](https://docs.convex.dev/production/networking))

---

## Rebuild, clone, rotation and recovery behavior

| Event | Safe Composery behavior |
|---|---|
| Rebuild to fresh official Ubuntu | Create a **new generation and new B**. Old host trust is historical, not authority for the replacement OS. Require complete enrollment again. |
| Rebuild from Snapshot/Backup | Same rule. Never inherit trust just because server ID or host key matches. Hetzner explicitly says snapshot keys can survive and the snapshot is a disk copy. ([docs.hetzner.com](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) |
| New server from Snapshot | Fresh provider server ID + fresh generation. Even if the cloned host key exactly matches another server, it is a new allocation. |
| Primary-IP/address reuse | Resolve the IP only as a locator. Trust is selected by provider server ID/generation, not by address. |
| Planned host-key rotation | While the old host key is still strictly trusted, retrieve the new public key through that trusted connection, durably add the new pin, prove a connection using it, then retire the old key. |
| Unexpected SSH host-key change | **No write and no auto-accept.** Enter identity-mismatch/recovery state. |
| Management key removed / `sshd` broken | Ordinary SSH management stops. Provider Rescue/console is a separate, explicitly authorized recovery mechanism. |
| Rescue boot | Never replace the installed OS host pin with the Rescue system's host key. Rescue is a different OS. Hetzner documents using Rescue to mount/chroot the installed root disk and repair `authorized_keys`. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/how-to-rescue/change-ssh-key/)) |
| Disk identity does not match expected marker/lineage during recovery | Mount read-only first and make **no automated mutation**. Surface an identity mismatch and require an explicit owner recovery/re-enrollment decision. |

There is an important fundamental limit: if a snapshot of the **same server** copies the current host private key, `G`, management authorization and every local marker, and is later restored to that same Hetzner server ID outside Composery, an SSH-only observer cannot necessarily distinguish the restored bit-for-bit state from the original. A cloned disk can copy every disk-resident “identity.” Detecting rollback of that form requires a non-clonable/monotonic provider or hardware primitive, or maintaining a backend/guest freshness protocol whose limitations are explicitly understood. Do not market the local marker as clone-proof identity.

Cloud-init itself illustrates the problem. It determines “new instance” largely by comparing its cached instance ID with the runtime instance ID. A captured filesystem can therefore carry first-boot state forward.  On Hetzner, the datasource's instance ID is tied to DMI serial.  For a snapshot **rebuilt onto the same Hetzner server ID**, the exact behavior of the current image/cache path must be tested rather than assumed. Hetzner says cloud-init key injection works for snapshots originating from official images, but that does not by itself prove your new per-instance enrollment script will rerun. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/)) Failure to produce the fresh `G/B` proof should simply leave the server untrusted.

Provider recovery should remain distinct from ordinary key editing. It is an exceptional operation with higher consequences, not an automatic fallback whenever SSH authentication fails.

---

## Explicit pass/fail qualification

I did **not** create a Hetzner VM or run these experiments. I inspected current primary documentation and source. These are the tests I would make release gates:

| Experiment | PASS criterion |
|---|---|
| Fresh Ubuntu 24.04 create | Record actual image/package versions, provider ID, DMI serial, metadata ID, Action completion, SSH reachability and Final completion. Server becomes Ready **only** after valid enrollment proof. |
| Action-vs-guest readiness | Demonstrate that backend does not infer Ready from Hetzner Action `success` or TCP/22 accepting connections. |
| MITM host substitution | A terminating fake SSH server with its own host key must never become pinned; `K_seen != HMAC-authenticated host key` fails. |
| Bootstrap replay | Replaying an old response or challenge fails; consumed/expired `B` can never enroll anything. |
| Duplicate application delivery | Repeated same Composery operation produces one logical server. An ambiguous provider create is reconciled before another create attempt. If multiple provider servers exist, none is silently selected. |
| IPv4/IPv6 | Qualify IPv4-only, IPv6-only and dual-stack; both firewall families behave as intended and management can actually reach every supported configuration. |
| Firewall | During bootstrap only intended management sources can initiate 22; after Ready the configured customer SSH policy works with Composery offline. |
| User-data exposure | With a non-production canary, inspect `/hetzner/v1/userdata` as root and unprivileged user, `/var/lib/cloud`, journals, cloud-init logs, console output and support bundles. Record retention/access behavior. No reusable authority may survive backend expiry. |
| Official-image rebuild | Fresh G/B required; previous host trust alone never authorizes the new OS. |
| Snapshot rebuild on same server | Verify whether current Hetzner Ubuntu/cloud-init actually executes fresh enrollment user-data. If not, automatic enrollment must fail closed. |
| Snapshot clone | Deliberately clone a server retaining identical host private keys. Different Hetzner server ID must prevent trust inheritance. |
| IP reassignment | Move/reuse a Primary IP. A new server at the old address must not acquire the prior machine's trust. |
| Planned host-key rotation | New key is learned over the old pinned channel and verified before old pin removal; customer native SSH succeeds afterward without platform availability. |
| Broken SSH | Delete management authorization or break sshd. Normal operations stop; only explicit Rescue/console recovery proceeds. |
| Wrong disk in recovery | Read-only inspection fails identity/lineage checks and performs zero automatic writes. |
| Native-key edit | Add/remove an authorized key without sshd reload; a new login immediately reflects the edit against the exact Ubuntu package shipped on the Hetzner image. |

For create duplication specifically, I did **not** find a documented Hetzner idempotency token in the primary material inspected. Do not turn that absence into a protocol assumption. Use a durable Composery attempt ID and provider labels for reconciliation—Hetzner supports labels and label selectors—and verify the current API/OpenAPI or with Hetzner before claiming exactly-once infrastructure creation. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

---

## Unresolved questions before freezing the protocol

The remaining evidence gaps are narrow but material: the exact package/image build currently delivered as Hetzner “Ubuntu 24.04”; actual `/hetzner/v1/userdata` lifetime and which guest principals can read it; exact cloud-init behavior for **same-server** snapshot rebuild with cached instance state; and whether the current Hetzner API provides any create-request idempotency facility not surfaced in the documentation inspected.

There is one product-level question evidence cannot answer: **is the trusted-computing base allowed to include Hetzner's control plane and the pristine official image?** The protocol above assumes yes. If Composery must prove a machine against a malicious provider or a guest already controlled before enrollment, this design—and TOFU, callbacks, injected SSH keys, and provider console checks—cannot meet that stronger requirement without an additional hardware/provider attestation primitive.

Within the stated scope and the normal cloud-provider trust model, I would ship the **guest-generated host key + one-time HMAC enrollment** design. It preserves native OpenSSH afterward, keeps customer private keys client-side, needs no callback or authenticated browser session on the VPS, tolerates platform outages after setup, and gives Composery an explicit reason to trust a host key rather than merely observing one.
