# Cloud SSH Access Models

Source: https://chatgpt.com/share/6aa87154-c3dc-83eb-b646-c8c70d00f3ba

---

## Turn 1: User

_2026-09-14T22:01:44.729Z_

Context: A company offers VPS instances through a web control panel. Customers get root and full control of the operating system. The company wants to let customers manage SSH access to their instances from the panel after creation, while the instance stays the source of truth.

Question: How do existing cloud providers and server-management products manage SSH keys and access on machines that are already running, and what do they deliberately not support?

Cover at least: AWS (EC2 Instance Connect, Systems Manager), Google Cloud (metadata keys through the guest agent, OS Login), Azure (VMAccess extension), DigitalOcean, Hetzner Cloud, Linode or Akamai, Vultr, OVHcloud, Fly.io, GitHub Codespaces, and server-management products such as Laravel Forge, Ploi, RunCloud, and Coolify. For each: the mechanism (direct authorized_keys edits, an agent, certificates, an AuthorizedKeysCommand, other), whether keys exist only at creation or can change later, which authorized_keys options the product exposes, what happens when the customer edits the files directly, how conflicts and failures are shown, how a customer who loses access recovers, and any documented limitations.

Evidence rules: Cite official documentation and, where available, the source of agents or tools. Give dates for documentation you read. Distinguish current behavior from deprecated products. Say where documentation is silent instead of guessing.

---

## Turn 2: ChatGPT

_2026-09-14T22:01:44.943Z_

I’ll build this as a provider-by-provider comparison, prioritizing official docs and official source repositories, and I’ll explicitly mark gaps where behavior isn’t documented rather than infer it. I’ll also separate “day-0 provisioning” from post-creation access management and recovery paths, because that distinction is where most products differ.

---

## Turn 3: ChatGPT

_2026-09-14T22:02:03.529Z_

A pattern is already emerging: hyperscalers that support post-creation changes generally do it via a guest-side component or an SSH lookup hook, while many VPS providers keep account-level keys as provisioning inputs only. The strongest “instance remains source of truth” examples are Azure’s VMAccess (mutates the guest), Google’s metadata guest agent (reconciles metadata into the guest), and AWS EC2 Instance Connect (temporary lookup via `AuthorizedKeysCommand` rather than persisting the key).

---

## Turn 4: ChatGPT

_2026-09-14T22:04:49.762Z_

The VPS-provider side is much more conservative than the hyperscalers: DigitalOcean explicitly forbids control-panel key changes after creation; Hetzner likewise says existing servers must be changed manually; OVHcloud documents post-creation keys as `ssh-copy-id`/manual `authorized_keys` work, with rescue mode for lost keys. That is a deliberate boundary: the provider avoids pretending its account key inventory is synchronized with a root-controlled guest.

---

## Turn 5: ChatGPT

_2026-09-14T22:08:22.447Z_

I reviewed the current official documentation and, where useful, the official open-source guest agents/CLI implementations. **Research snapshot: 14 September 2026.** Where a page exposes its own “last updated/verified” date I call that out; otherwise the date below is the access date. I treat undocumented behavior as **documentation silent**, rather than inferring implementation details.

## Executive conclusion

There are four materially different models in the market:

| Model | Examples | Who is authoritative? | Treatment of manual guest edits |
|---|---|---|---|
| **Provisioning-only keys** | DigitalOcean, Hetzner, Linode/Akamai, OVHcloud, Vultr | The VM | Provider deliberately does not synchronize account keys into an existing VM. Users edit `authorized_keys` themselves. |
| **One-shot guest mutation** | Azure VMAccess; broadly Forge/Ploi/RunCloud | The VM after the operation | Control plane asks something inside/with access to the VM to add/remove a key. There generally is no continuous desired-state reconciliation. |
| **Continuously reconciled external desired state** | Google metadata SSH keys | Metadata/control plane | Guest agent writes the control-plane state into `authorized_keys`; direct edits to managed files can be overwritten. |
| **Authenticate at login without persistent `authorized_keys` entries** | AWS EC2 Instance Connect, Google OS Login, Fly.io | IAM/access service at login time | Local `authorized_keys` is either an independent second path or not part of the managed mechanism at all. |

For a VPS product whose **instance must remain the source of truth**, the closest precedents are **Azure VMAccess plus the server-management products**, not Google metadata SSH keys or OS Login. The strongest VPS providers go further: DigitalOcean and Hetzner explicitly refuse to pretend that an account-level SSH-key list is synchronized with an existing root-controlled machine. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/vmaccess-linux?utm_source=chatgpt.com))

---

# AWS

### EC2 Instance Connect

**Mechanism.** EC2 Instance Connect does **not normally append the customer's key to `authorized_keys`**. `SendSSHPublicKey` puts the public key into EC2 instance metadata for **60 seconds**. On the VM, the EC2 Instance Connect package configures OpenSSH's `AuthorizedKeysCommand`; when `sshd` authenticates the user, AWS's helper retrieves and validates the temporary key from IMDS. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-tutorial.html?utm_source=chatgpt.com))

The official package source is unusually useful here. AWS documents three components: `eic_run_authorized_keys`, `eic_curl_authorized_keys`, and `eic_parse_authorized_keys`; the wrapper enforces a five-second timeout so a broken metadata lookup does not indefinitely block `sshd`. ([GitHub](https://github.com/aws/aws-ec2-instance-connect-config?utm_source=chatgpt.com)) The Debian installer adds an `AuthorizedKeysCommand` override but contains checks intended to avoid trampling an already configured `AuthorizedKeysCommand`/service override. ([GitHub](https://github.com/aws/aws-ec2-instance-connect-config/blob/master/debian/postinst?utm_source=chatgpt.com))

**Post-creation.** Yes, inherently. A new ephemeral key can be pushed for any connection; there is no need to have chosen that public key at instance creation. It expires from metadata after 60 seconds, although an already established SSH session persists. ([AWS Documentation](https://docs.aws.amazon.com/us_en/AWSEC2/latest/UserGuide/ec2-instance-connect-methods.html?utm_source=chatgpt.com))

**Options exposed.** The documented interface selects the instance, OS username and public key. AWS does **not expose first-class OpenSSH per-key restriction fields** such as `command=`, `from=`, `restrict`, `no-pty`, or forwarding controls.

**Manual guest edits.** Ordinary local `authorized_keys` entries remain a separate OpenSSH authentication path. Editing them does not update IAM/EIC state. Conversely, changing `sshd_config`, replacing the `AuthorizedKeysCommand`, disabling the helper, or breaking IMDS access can disable EC2 Instance Connect even though the EC2 control plane still permits `SendSSHPublicKey`. The package's source specifically reflects awareness of `AuthorizedKeysCommand` conflicts. ([GitHub](https://github.com/aws/aws-ec2-instance-connect-config/blob/master/debian/postinst?utm_source=chatgpt.com))

**Failures/recovery.** Control-plane failures appear as EC2 Instance Connect/API or client errors; guest lookup failures are `sshd`/helper-side failures. AWS's helper intentionally fast-fails on metadata trouble. There is no “merge conflict” UI because EIC is not reconciling a persistent guest file. A separate recovery route is Systems Manager when configured, or EC2's other console/recovery facilities.

### Systems Manager Session Manager

This is important because AWS deliberately offers an access system that is **not SSH-key management at all**. Native Session Manager uses SSM Agent plus IAM to provide an interactive shell without opening inbound ports or maintaining SSH keys. IAM is the access authority; SSM Agent creates the bidirectional channel. ([AWS Documentation](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html?utm_source=chatgpt.com))

AWS also supports **SSH over Session Manager**, but that is only a transport tunnel. The target still has to run SSH and the user's SSH key must already be accepted by the target OS. AWS explicitly says SSH-over-Session-Manager sessions cannot have their command contents logged because Session Manager sees encrypted SSH traffic. ([AWS Documentation](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-enable-ssh-connections.html?utm_source=chatgpt.com))

So SSM is a useful recovery/administrative analogue, but **not a solution for keeping `authorized_keys` synchronized**. If SSM Agent/IAM/network connectivity is broken, that route is unavailable.

**Docs/source read:** AWS EC2 and SSM current docs, accessed 14 Sep 2026; `aws/aws-ec2-instance-connect-config` current repository, accessed 14 Sep 2026.

---

# Google Cloud

Google offers two substantially different models.

### Metadata SSH keys + guest agent

**Mechanism.** When OS Login is off, project or instance metadata contains SSH keys. Google's guest agent creates/manages local users and their `authorized_keys` files from that metadata. The official guest-agent source says it maintains the authorized-key file for Google-managed users and deletes the file when the last metadata key for that managed user disappears. Accounts not managed by the guest agent are not touched. ([GitHub](https://github.com/GoogleCloudPlatform/guest-agent?utm_source=chatgpt.com))

**Post-creation.** Fully supported. Instance metadata keys can be changed after VM creation through Console, `gcloud`, or REST. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/add-ssh-keys?utm_source=chatgpt.com))

**Options exposed.** Google documents its own metadata syntax: key + username, optionally with a `google-ssh` JSON object containing `userName` and `expireOn`. It does not expose general-purpose OpenSSH `authorized_keys` restrictions as structured controls. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/add-ssh-keys?utm_source=chatgpt.com))

**Manual guest edits.** This is explicitly **not instance-source-of-truth behavior**. Google's docs warn that public keys added directly to a managed user's `~/.ssh/authorized_keys` **might be overwritten by the guest agent**, and recommend metadata instead. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/add-ssh-keys?utm_source=chatgpt.com))

There is also a control-plane conflict hazard: REST metadata updates operate on the metadata value as a whole and use a metadata fingerprint. Google's documentation warns that if existing keys are not included when writing the new metadata value, they are erased. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/add-ssh-keys?utm_source=chatgpt.com))

**Failure/recovery.** A stopped/broken guest environment can prevent metadata access from becoming usable SSH access. Google surfaces SSH diagnostic messages and recommends the serial console for broken `sshd`, permissions, networking or guest-environment problems. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/troubleshooting/troubleshooting-ssh-errors?utm_source=chatgpt.com))

This is probably the clearest **counterexample** to your desired architecture: the control plane is effectively authoritative for the subset of accounts the Google agent manages.

### OS Login

**Mechanism.** OS Login removes key distribution from `authorized_keys` entirely for OS Login identities. `sshd` is configured with Google's `AuthorizedKeysCommand`, and `google_authorized_keys` retrieves keys from the user's OS Login profile. NSS and PAM modules provide the OS identity and enforce Google IAM login/admin permissions. ([GitHub](https://github.com/GoogleCloudPlatform/guest-oslogin?utm_source=chatgpt.com))

Current guest-agent source shows the exact configuration, including:

`AuthorizedKeysCommand /usr/bin/google_authorized_keys`

and, where certificate authentication is used, `TrustedUserCAKeys` plus `AuthorizedPrincipalsCommand`. ([GitHub](https://github.com/GoogleCloudPlatform/guest-agent/blob/main/google_guest_agent/oslogin.go?utm_source=chatgpt.com))

**Post-creation.** Yes. Keys can be added and removed from an OS Login profile, including an expiry/TTL. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/add-ssh-keys?utm_source=chatgpt.com))

**Options exposed.** Google exposes identity/IAM, expiry, 2FA/security-key modes and certificate-based authentication—not arbitrary OpenSSH key-line options.

**Manual guest edits.** Enabling OS Login deletes the VM's existing metadata-managed `authorized_keys` files and causes metadata SSH keys to stop being accepted. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/oslogin/set-up-oslogin?authuser=758840678&utm_source=chatgpt.com)) There is an important current nuance: Google now documents that you **can** have a separate local account authenticated by its own `authorized_keys` while OS Login is enabled, provided its username and UID do not collide with an OS Login user. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/oslogin?authuser=14&utm_source=chatgpt.com))

So local files can coexist, but they are a separate authentication namespace; editing them does not change OS Login/IAM.

**Failures/limitations.** Google documents specific OS Login failures rather well: profiles have a **32 KiB size limit** and currently a practical limit of **64 SSH keys**; metadata-server rate limiting can produce HTTP 429; username/UID conflicts are surfaced as failed-precondition errors. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/troubleshooting/troubleshoot-os-login?utm_source=chatgpt.com))

**Docs/source read:** current Google Cloud Compute/OS Login docs and current `guest-agent` / `guest-oslogin` repositories, accessed 14 Sep 2026.

---

# Azure — VMAccess for Linux

Azure's VMAccess extension is probably the cleanest hyperscaler precedent for **“perform a mutation in the guest, then let the guest own the result.”**

**Mechanism.** VMAccess is a VM Extension executed through the Azure Linux Agent. It can create/manage a user, add an SSH public key, remove prior keys, reset SSH configuration, set account expiry, remove a user, or restore a backed-up SSH configuration. Current handler version in the docs is 1.5. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/vmaccess-linux?utm_source=chatgpt.com))

The common CLI operation:

`az vm user update --ssh-key-value …`

**appends** the new public-key text to the user's `~/.ssh/authorized_keys`; Microsoft explicitly says it does not replace or remove existing keys. At the lower-level extension interface, `remove_prior_keys: true` can instead remove old keys while adding the new one. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/vmaccess-linux?utm_source=chatgpt.com))

**Post-creation.** Yes; access recovery is one of its primary purposes.

**Options exposed.** Username, key, account expiration and replace/remove-prior-keys semantics are exposed. Microsoft documents RSA, Ed25519 and PEM key inputs. There are no structured fields for arbitrary `authorized_keys` restrictions such as `command=`, `from=`, `no-port-forwarding`, etc. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/vmaccess-linux?utm_source=chatgpt.com))

**Manual guest edits.** VMAccess is a one-shot mutation, not documented as a reconciliation service. Therefore there is no documented control-plane promise that Azure will restore a key a customer later removes. Likewise, Azure does not document a read-back/drift-resolution model for arbitrary direct edits. The actual VM configuration is what SSH subsequently uses.

One caution: VMAccess can alter `sshd_config` during some user-update/reset operations, and Microsoft documents a backup/restore mechanism. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/vmaccess-linux?utm_source=chatgpt.com))

**Failure/conflict reporting.** Azure exposes VM Extension provisioning state and detailed VMAccess/`waagent` logs. Current docs give examples such as extension timeouts and “No password or ssh_key is specified.” ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/vmaccess-linux?utm_source=chatgpt.com))

**Recovery.** VMAccess only works if Azure's guest-extension channel works. The VM Agent is required to install and execute extensions; a broken/unready agent means the extension cannot do its job. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/troubleshoot?utm_source=chatgpt.com)) Azure therefore also documents Serial Console, Run Command and other SSH-recovery paths. ([Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/linux/troubleshoot-ssh-connection?utm_source=chatgpt.com))

**Docs/source read:** current VMAccess documentation accessed 14 Sep 2026; Azure Linux Agent troubleshooting last updated **16 Apr 2026**; current `WALinuxAgent` and `azure-linux-extensions` source repositories accessed 14 Sep 2026.

---

# DigitalOcean

DigitalOcean draws a very explicit line between **account keys used at provisioning** and **the contents of an already-running Droplet**.

**Mechanism/post-creation.** The panel's SSH keys are provisioning inputs. DigitalOcean states:

> “you can’t add or modify the SSH keys on your Droplet using the control panel after you create it”

Instead, customers use `ssh-copy-id` or edit the machine themselves. ([DigitalOcean](https://docs.digitalocean.com/products/droplets/how-to/add-ssh-keys/to-existing-droplet/?utm_source=chatgpt.com))

Consequently, deleting an account/team key does not constitute revocation from already-created machines; the running guest owns its SSH state.

**Options.** None at the DigitalOcean post-creation control-plane layer. If the customer manually edits OpenSSH files, ordinary OpenSSH syntax/options are available, but that is not a DigitalOcean key-management feature.

**Direct edits/conflicts.** Direct edits are the canonical runtime state. There is no panel synchronization, no merge algorithm and thus no panel “conflict” state to show.

**Recovery.** DigitalOcean has a separate out-of-band Recovery Console, available even when normal networking or `sshd` is broken, plus a Recovery ISO. The console can be used after resetting an OS password and then fixing `authorized_keys` or SSH config. ([DigitalOcean](https://docs.digitalocean.com/products/droplets/how-to/recovery/recovery-console/?utm_source=chatgpt.com))

A subtle distinction: the normal Droplet Console is network/SSH based; the **Recovery Console** is the out-of-band VNC-like mechanism. ([DigitalOcean](https://docs.digitalocean.com/products/droplets/how-to/recovery/recovery-console/?utm_source=chatgpt.com))

**Docs read:** “existing Droplet SSH key” last verified **13 Jul 2026**; Recovery Console **3 Sep 2026**; Recovery ISO **13 Jul 2026**.

---

# Hetzner Cloud

Hetzner is similarly explicit.

**Mechanism.** A selected key is inserted during creation, normally via cloud-init for official images/snapshots. Hetzner says that after the server has been created, it is **not possible to add another SSH key through Hetzner Console**. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/?utm_source=chatgpt.com))

**Post-creation.** Manual OS operation only.

**Options.** No control-panel `authorized_keys` options because there is no post-creation key-management API. Whatever the customer configures directly with OpenSSH is outside the panel feature.

**Direct edits/conflicts.** The guest wins. A key added to the customer's Hetzner account later does nothing to an existing server. Snapshot contents can retain additional `authorized_keys` entries independently of the key Hetzner injects. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))

**Failure/recovery.** Hetzner's June 2026 recovery guide explicitly says keys can only be stored on cloud servers during creation. If access is lost, enable the Rescue System, mount/chroot the normal filesystem, edit `/root/.ssh/authorized_keys`, then reboot. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/how-to-rescue/change-ssh-key/?utm_source=chatgpt.com))

No synchronization means there is likewise no key-conflict UI.

**Docs read:** key replacement guide created/last changed **2 Jun 2026**; other current Hetzner docs accessed 14 Sep 2026.

---

# Linode / Akamai Cloud

This follows the same provisioning-only model.

**Mechanism.** Profile SSH keys can be selected when a Linode is created; selected keys are installed into root's account. Akamai explicitly describes adding account keys so they can be installed on **new Linodes**. ([Akamai TechDocs](https://techdocs.akamai.com/cloud-computing/docs/manage-ssh-keys?utm_source=chatgpt.com))

**Post-creation.** The account-key system does not mutate existing Linodes. Akamai explicitly states that removing a key from Cloud Manager **does not remove that key from existing Linodes**. ([Akamai TechDocs](https://techdocs.akamai.com/cloud-computing/docs/manage-ssh-keys?utm_source=chatgpt.com)) Manual `authorized_keys` management is therefore the post-create method. ([Akamai TechDocs](https://techdocs.akamai.com/cloud-computing/docs/set-up-and-secure-a-compute-instance?utm_source=chatgpt.com))

**Options.** Cloud Manager documents accepted key algorithms, including RSA, DSS, ECDSA, Ed25519 and security-key formats, but does not expose structured OpenSSH per-key restrictions. ([Akamai TechDocs](https://techdocs.akamai.com/cloud-computing/docs/manage-ssh-keys?utm_source=chatgpt.com))

**Manual edits/conflicts.** Guest state is authoritative; Cloud Manager's profile list is not a live inventory.

**Recovery.** Lish gives console access independently of ordinary network SSH. If an OS password is unavailable, Cloud Manager can reset the root password on official-distribution Linodes; Rescue Mode/Finnix is available when the normal system cannot boot. ([Akamai TechDocs](https://techdocs.akamai.com/cloud-computing/docs/access-your-system-console-using-lish?utm_source=chatgpt.com))

**Docs read:** current Akamai Cloud/Linode documentation accessed 14 Sep 2026.

---

# Vultr

Vultr makes perhaps the most dramatic version of this distinction.

**Mechanism.** Account-level keys can be created/updated in Vultr's control plane, but that does **not mean an existing instance is safely reconciled in place**. Vultr's current documentation says changing SSH keys on a running server through the Vultr Console invokes **Reinstall SSH Keys**, which **reinstalls the OS and wipes all data**. ([Vultr Docs](https://docs.vultr.com/products/compute/instances/cloud-compute/management/reinstall-ssh-keys?utm_source=chatgpt.com))

To change access without data loss, Vultr tells the customer to use `ssh-copy-id`/manual guest management instead. ([Vultr Docs](https://docs.vultr.com/how-to-add-and-delete-ssh-keys?utm_source=chatgpt.com))

**Post-creation.** Yes manually; no nondestructive panel reconciliation.

**Options.** No documented structured OpenSSH key restrictions in Vultr's account-key UI.

**Direct edits.** They are the nondestructive supported route and therefore become the runtime truth. Updating an account key is not represented as synchronizing that key into an existing machine. ([Vultr Docs](https://docs.vultr.com/products/orchestration/ssh-keys/update-ssh-keys?utm_source=chatgpt.com))

**Failure/recovery.** By default, Vultr says instances retain password authentication even if initially deployed with a key, and the generated root/`linuxuser` password can be viewed in the console. If the customer has manually disabled password authentication, Vultr directs them to its Web Console. ([Vultr Docs](https://docs.vultr.com/support/products/compute/i-lost-the-ssh-key-for-my-vultr-compute-instance?utm_source=chatgpt.com))

**Docs read:** manual add/delete guide updated **15 Apr 2026**; Reinstall SSH Keys **26 May 2026**; lost-key guide **18 Dec 2025**.

---

# OVHcloud

OVHcloud also treats the running OS as customer-owned.

**Mechanism.** At Public Cloud instance creation, the OVHcloud panel allows one key for the preconfigured account. Additional keys on a running instance are added with `ssh-copy-id` or by editing `~/.ssh/authorized_keys` directly. ([OVHcloud](https://docs.ovhcloud.com/en/guides/public-cloud/compute/configuring-additional-ssh-keys?utm_source=chatgpt.com))

**Post-creation.** Yes, but as an OS administration task rather than a live control-panel key resource.

**Options.** OVH documents RSA, ECDSA and Ed25519, but no panel-level `authorized_keys` option model. Normal OpenSSH options can of course be configured manually in the guest.

**Direct edits/conflicts.** The file itself is authoritative. OVH does not document a control-plane copy being reconciled against it.

**Failure/recovery.** If the private key is lost, OVH's documented procedure is to boot the instance into Rescue Mode, mount/chroot the filesystem, edit the appropriate user's `authorized_keys`, remove the obsolete key and reboot. ([OVHcloud](https://docs.ovhcloud.com/en/guides/public-cloud/compute/replacing-lost-ssh-key-pair?utm_source=chatgpt.com))

**Docs read:** additional-key guide last updated **9 Sep 2024** in the global docs; US support rendition updated **15 Jun 2026**; lost-key/replacement guide **13 Jun 2024**. The older dates do not indicate deprecation; these remain linked from the current Compute documentation.

---

# Fly.io

Fly.io is fundamentally different from conventional VPS key management.

**Mechanism.** Fly's managed SSH path issues **short-lived SSH credentials/certificates** through `fly ssh issue`; `fly ssh console` then connects to a running Machine, ordinarily over Fly's private/WireGuard networking. `fly ssh log` exposes issued certificate history. ([Fly.io](https://fly.io/docs/flyctl/ssh/?utm_source=chatgpt.com))

**Post-creation.** Yes—credentials are issued whenever needed. By default they last 24 hours; current CLI docs allow `--hours` from 1 up to less than/equal to the documented 72-hour boundary and allow selecting Unix usernames, defaulting to `root` and `fly`. ([Fly.io](https://fly.io/docs/flyctl/ssh-issue/?utm_source=chatgpt.com))

**Options.** Username(s), validity period and where the credential is stored/loaded are exposed. Arbitrary `authorized_keys` restrictions are not.

**Direct guest edits.** Fly's current SSH docs do **not document a persistent per-Machine `authorized_keys` file as the authority for Fly-managed SSH credentials**, so I would not infer synchronization semantics. If an application owner installs/runs a conventional public OpenSSH server themselves, that is a separate customer-managed SSH setup.

**Failures/recovery.** Losing a local credential is inexpensive so long as the user remains authenticated to Fly: issue a new one. If the Machine itself is stopped/broken, the SSH path needs the Machine to become available; this is not an out-of-band serial-console analogue.

**Docs read:** current Fly CLI docs accessed 14 Sep 2026; no page-level update date exposed.

---

# GitHub Codespaces

Codespaces is useful as a product comparison, but it is **not a root-controlled VPS precedent**.

**Mechanism.** `gh codespace ssh` obtains connection details for a codespace and uses ordinary SSH. The GitHub CLI automatically selects or creates a local SSH key pair; it can also emit an OpenSSH configuration so normal `ssh`, `scp`, `rsync`, etc. can connect. The **codespace container itself must have an SSH server installed**. ([GitHub CLI](https://cli.github.com/manual/gh_codespace_ssh?utm_source=chatgpt.com))

**Post-creation.** SSH access is established on demand; `-i` lets the client choose a different local key. This is not presented as a persistent web-panel list of server-authorized users.

**Exact remote mechanism.** Current official documentation describes local key generation and the requirement for an SSH server but is **silent on the precise server-side plumbing used to authorize the selected key**—i.e. whether GitHub writes a temporary `authorized_keys` entry, uses another hook, or otherwise brokers that part. I would not classify it more narrowly without source evidence.

**Options.** GitHub exposes SSH client flags/configuration, but no control-panel abstraction for server-side `authorized_keys` restrictions.

**Manual edits/conflicts.** Documentation is silent on reconciliation between manual `authorized_keys` changes inside a devcontainer and the `gh codespace ssh` broker. Devcontainer rebuild semantics also make arbitrary container mutations a poor persistent-control-plane model.

**Recovery.** If the local automatic key disappears, authenticated `gh` can create another. If the devcontainer lacks/breaks its SSH server, GitHub tells the user to install the devcontainer `sshd` feature/rebuild rather than recover a host VM's SSH configuration. ([GitHub CLI](https://cli.github.com/manual/gh_codespace_ssh?utm_source=chatgpt.com))

**Docs read:** current GitHub CLI documentation accessed 14 Sep 2026.

---

# Laravel Forge

Forge currently supports server SSH-key CRUD, but its public documentation gives much less implementation detail than the hyperscalers.

**Current behavior.** The current official Forge SDK **v4/API v2** includes `sshKeys`, `sshKey`, `createSshKey`, and `deleteSshKey` operations for an existing server. ([GitHub](https://github.com/laravel/forge-sdk?utm_source=chatgpt.com)) So post-creation key management is definitely a current feature.

**Mechanism.** The exact current v2 server-side implementation—direct `authorized_keys` editing versus a helper—is **not documented publicly**. Forge is a remote server manager and must retain management access, but it would be speculation to claim a particular current file-edit routine.

**Options.** Current SDK surface confirms CRUD, but does not document structured `command=`, `from=`, forwarding/PTY restrictions, etc.

**Direct edits/conflicts.** Current documentation does not describe a live rescan or reconciliation algorithm if the customer modifies the same file independently. Thus there is no documented guarantee that the Forge list is a canonical reflection of arbitrary guest edits.

**Important deprecated evidence.** Forge's old `/api/v1` documentation exposed `name`, `key` and `username`, with newly created keys having an `installing` status. That documentation is now explicitly marked **deprecated**; it should only be used as historical evidence of how Forge modeled the operation, not as the current API contract. ([Laravel](https://forge.laravel.com/api-documentation?utm_source=chatgpt.com))

The current v4 upgrade guide says the old server `reconnect`, `revokeAccess` and `reactivate` API convenience operations have **no v2 equivalents**. ([GitHub](https://github.com/laravel/forge-sdk/blob/4.x/UPGRADE-4.0.md?utm_source=chatgpt.com)) This is another reason not to rely on old Forge recovery semantics as current behavior.

**Recovery.** Current public v2 docs I found are silent on an out-of-band recovery mechanism if Forge itself loses SSH access. Practically this means Forge should not be treated as a substitute for the underlying cloud provider's console/rescue mechanism.

**Docs/source read:** current Forge SDK/API v2 source accessed 14 Sep 2026; legacy API v1 explicitly deprecated.

---

# Ploi

Ploi provides unusually clear evidence that its SSH-key objects correspond to an asynchronous physical change on the server.

**Mechanism/post-creation.** Its current API supports `POST /servers/{server}/ssh-keys` with a public key and optional `system_user`; returned objects initially have status `created`. Current status documentation defines SSH-key states as:

- `created`: physically adding the key has not started yet
- `active`: installed/ready
- `destroying`: being deleted

([Ploi](https://developers.ploi.io/getting-started/resource-statuses?utm_source=chatgpt.com))

The migration documentation is even more explicit about mechanism: Ploi adds its own key to `/root/.ssh/authorized_keys` and appends its key to imported users' `authorized_keys`. ([Ploi](https://ploi.io/documentation/server/how-do-i-migrate-from-laravel-forge?utm_source=chatgpt.com))

**Options.** Name, key and `system_user` are documented. No per-key OpenSSH restriction fields are documented. ([Ploi](https://developers.ploi.io/ssh-keys/create-ssh-key?utm_source=chatgpt.com))

**Manual edits.** The current SSH-key API returns Ploi's known server-key resources, but docs do not claim arbitrary external edits are discovered/reconciled. More importantly, Ploi itself currently depends on root SSH: its updated documentation says disabling `PermitRootLogin` cuts off Ploi's management access. ([Ploi](https://ploi.io/documentation/ssh/can-i-safely-change-permitrootlogin-in-the-ssh-config-file?utm_source=chatgpt.com)) Removing Ploi's own key manually therefore breaks management.

**Failure/conflicts.** Ploi exposes an `unreachable` server status when it cannot reach a server. The documented SSH-key statuses themselves do not include a specific `failed` state, so documentation is silent about how an individual failed key-add is represented beyond the broader server/build/error mechanisms. ([Ploi](https://developers.ploi.io/getting-started/resource-statuses?utm_source=chatgpt.com))

**Recovery.** No provider-independent out-of-band recovery is documented. If Ploi's SSH path is severed, the underlying VPS provider's console/rescue route is the meaningful fallback.

**Documentation inconsistency.** Some much older Ploi pages, last updated about eight years ago, say direct root login is disabled; a page updated roughly two months before this research says Ploi currently connects as root and requires `PermitRootLogin`. I would treat the newer document as current. ([Ploi](https://ploi.io/documentation/ssh/basic-ssh-information?utm_source=chatgpt.com))

---

# RunCloud

RunCloud is very close to the UX you are considering.

**Mechanism/post-creation.** RunCloud has an SSH Key Vault storing public keys. From a connected server's **SSH Key** screen, the user chooses a vaulted key and OS user and adds it to the running server. RunCloud says the page lists SSH keys “currently installed in your server.” ([RunCloud Website](https://runcloud.io/docs/configure-ssh-on-runcloud?utm_source=chatgpt.com))

RunCloud installs a required `runcloud-agent` whose purpose is to let the dashboard communicate with the server. ([RunCloud Website](https://runcloud.io/docs/getting-started?utm_source=chatgpt.com)) However, the docs I found do **not explicitly say that the SSH-key operation itself is performed by the agent** rather than another RunCloud management channel/helper. That implementation detail is documentation-silent.

**Options.** RunCloud exposes:

- target OS user;
- a **temporary key** that is automatically removed after 12 hours;
- separately, server-wide SSH settings such as “passwordless login,” “prevent root login,” and `UseDNS`.

It does not document arbitrary OpenSSH per-key restrictions. ([RunCloud Website](https://runcloud.io/docs/connect-to-server-via-ssh?utm_source=chatgpt.com))

**Direct edits/conflicts.** Although the UI language says “currently installed,” the docs do not say whether the list is freshly read from `authorized_keys`, cached from RunCloud's database, or continuously reconciled. Therefore I would not infer its behavior after an out-of-band file edit.

**Failure reporting.** RunCloud has explicit agent-health UI: an outdated/discrepant guest agent can trigger “Server not running latest agent,” and a **Sync Agent** action reconciles the reported agent version. This proves they do expose at least some guest/control-plane drift, though not specifically SSH-key drift. ([RunCloud Website](https://runcloud.io/docs/how-to-update-runcloud-agent-manually?utm_source=chatgpt.com))

**Recovery.** If the RunCloud management channel still functions, its own documentation tells a locked-out user to add a new key from the dashboard. ([RunCloud Website](https://runcloud.io/docs/reset-root-password?utm_source=chatgpt.com)) If the guest-management channel itself is unavailable, the docs do not describe an independent RunCloud serial/rescue path; use the underlying cloud provider.

**Docs read:** core SSH/Key Vault docs last updated **1 Aug 2025**; agent-update docs **2 Oct 2025**; current generic server-connection guide **7 Jul 2026**.

---

# Coolify

Coolify is a useful negative precedent because it deliberately manages **Coolify's credential**, not a customer SSH-access list.

**Mechanism.** Coolify stores a private SSH key; **the operator must put the matching public key into the server user's `~/.ssh/authorized_keys`**. For an already connected server, you can select a different private key in Coolify and run **Check connection**, but Coolify's documented rotation procedure explicitly requires manually adding the new public key to every server, switching Coolify, verifying, then manually deleting the old public key. ([Coolify](https://coolify.io/docs/core/security/credentials/ssh-keys?utm_source=chatgpt.com))

**Post-creation.** You can change which credential Coolify uses, but this is not a “manage all authorized users on the server” facility.

**Options.** It does not expose `authorized_keys` restrictions. More unusually, it **explicitly does not support an interactive passphrase or second-factor prompt on the private key Coolify itself uses**, because its SSH sessions must be noninteractive. ([Coolify](https://coolify.io/docs/core/security/credentials/ssh-keys?utm_source=chatgpt.com))

**Manual edits.** They are authoritative. Remove the matching public key from the server and Coolify immediately loses access. Deleting a private-key object from Coolify does not imply deleting the corresponding public-key line from the guest. Its safe-delete mechanism concerns references inside Coolify itself. ([Coolify](https://coolify.io/docs/core/security/credentials/ssh-keys?utm_source=chatgpt.com))

**Failure/conflict reporting.** “Check connection” validates whether the chosen private key can actually authenticate. Coolify documents concrete troubleshooting for incorrect user/IP/port/key, firewall problems and `sshd`; there is no synchronization/conflict model because it deliberately does not own the remote `authorized_keys` lifecycle. ([Coolify](https://coolify.io/docs/core/infrastructure/servers/add-server?utm_source=chatgpt.com))

**Recovery.** Restore the public key through some other administrative path/provider console and retry validation. Coolify cannot repair the very SSH path it depends on once that path is gone.

**Docs read:** current Coolify documentation accessed 14 Sep 2026; no page-level update date exposed.

---

# What providers deliberately avoid

Across these products, some boundaries are remarkably consistent.

**Almost nobody exposes arbitrary `authorized_keys` options as a web-control-plane schema.** The products that manage ordinary keys generally expose a **public key + Unix user**, sometimes with expiry. RunCloud adds a 12-hour lease; Google/Fly use expiry in their own access model; Azure has account expiry and replace-existing semantics. I found no covered product offering a general UI/API model for `command=`, `environment=`, `from=`, `permitopen=`, `restrict`, agent forwarding, X11 forwarding, PTY restrictions, etc. Where those are possible, they normally remain raw OpenSSH configuration owned by the server.

They also generally avoid **two writers both claiming canonical ownership**. The choices are instead very clear:

- Google metadata keys: “metadata wins; guest agent may overwrite you.”
- OS Login/EIC/Fly: “don't make a persistent key file the access authority.”
- DigitalOcean/Hetzner/Linode/OVH/Vultr: “the server wins; our account-key list is not an existing-server inventory.”
- Azure/Ploi/RunCloud: “perform an operation against the guest,” with no documented perpetual reconciliation afterward.

That last distinction is particularly important for your product.

## The design I would take from this

For a VPS where **the instance must remain the source of truth**, I would not model panel keys as desired state and periodically regenerate `authorized_keys`. That turns you into Google metadata SSH keys and creates exactly the ambiguity you are trying to avoid.

Instead, I would make panel operations transactional **guest mutations plus read-back**:

1. The panel asks a guest agent or privileged control channel to **read the current effective key file**, not a cached control-plane copy.
2. Parse it using OpenSSH-compatible grammar. Preserve every unknown line, comment and option byte-for-byte where possible.
3. Add/remove one key by fingerprint and target Unix account; use an atomic write with correct ownership, mode and SELinux/AppArmor handling.
4. Immediately read it back. Only after verification show the operation as successful.
5. On every panel view, either read current guest state or clearly label the last observed state and timestamp. Keys added manually should appear as **unmanaged/external**, not as conflicts.
6. If a managed key has been manually changed/removed, accept the guest's state. Do not silently restore it.
7. Keep recovery on a channel that does **not depend on working SSH**: serial/VNC/rescue boot or a hypervisor-backed command/guest-agent channel. Azure, DigitalOcean, Hetzner and Linode all demonstrate why this separation matters. ([Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/linux/troubleshoot-ssh-connection?utm_source=chatgpt.com))
8. For a first version, I would **preserve but not author arbitrary `authorized_keys` options**. That matches essentially every comparator here. A line containing `from=` or `command=` should remain intact and visible as advanced/unmanaged state rather than being normalized away.

The most useful product wording would therefore be something like **“SSH access on this server”**, not “keys attached to this VPS.” The former can truthfully mean “what we currently observed and can edit on the machine”; the latter tends to imply a control-plane relationship that DigitalOcean, Hetzner, Linode and OVH deliberately avoid promising.

The two strongest precedents for the exact architecture are **Azure VMAccess for execution semantics** and **RunCloud/Ploi for panel UX**, combined with the **DigitalOcean/Hetzner rule that direct guest edits remain authoritative**. Google metadata SSH keys are the architecture to avoid if maintaining the guest as source of truth is a hard requirement.
