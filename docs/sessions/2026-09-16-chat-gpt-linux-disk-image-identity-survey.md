# Linux Disk Image Identity Survey

Source: https://chatgpt.com/share/6aaad291-a2e8-83eb-a744-ac524379ea2b

---

## Turn 1: User

_2026-09-16T17:16:31.724Z_

A hosting product lets customers take a snapshot of a Linux virtual machine's disk and create new machines from it. The control panel manages those machines over SSH using a key it installed at creation, and pins the machine's host key. Survey, from primary sources, everything in a general-purpose Linux disk image that identifies the machine it came from or grants access to it, and therefore behaves wrongly when the image is restored onto a second machine. Cover at minimum: SSH host keys, authorized_keys, machine-id and what systemd and journald use it for, cloud-init's instance state and per-instance modules, DHCP client identifiers and DUIDs, iSCSI/NVMe initiator names, package-manager and telemetry identifiers, cron and systemd timer state, agent enrolment credentials for monitoring or configuration tools, container runtime node identity, and anything else that recurs. For each, say what breaks and how visibly, whether the standard cloud images regenerate it on first boot and under what conditions, and what major providers (AWS AMIs, Google Compute images, Azure with waagent/sysprep, DigitalOcean, Hetzner, Proxmox templates) document or automate. Distinguish what is a correctness problem from what is a security problem. Include documented incidents where duplicated identity caused real failures. Do not assume the questioner's design is right and do not recommend a single approach.

---

## Turn 2: ChatGPT

_2026-09-16T17:16:31.906Z_

I’ll treat this as an image-cloning identity audit rather than as a single “SSH key” problem. I’m going to separate persistent identifiers, access credentials, per-instance state, and scheduler/agent state; then cross-check what upstream software and the major providers actually document or regenerate.

---

## Turn 3: ChatGPT

_2026-09-16T17:17:06.764Z_

A key distinction is already clear from upstream docs: `/etc/machine-id` is explicitly specified as unique per instantiated machine, and generic images are supposed to leave it missing or empty; cloud-init separately tracks a cloud `instance-id` and caches “once-per-instance” state. Those two identity systems overlap in consequences but are not interchangeable.

---

## Turn 4: ChatGPT

_2026-09-16T17:19:38.123Z_

The “cloud image will fix it” assumption is only partly true. Cloud-init’s current documentation explicitly warns that a captured cache can make a clone look like a later boot; in its default generic-image mode it compares instance IDs, but `manual_cache_clean: true` disables that detection. Its SSH module is once-per-instance and defaults to deleting image host keys, so a failure to establish “new instance” is simultaneously a provisioning correctness failure and a host-identity security failure.

---

## Turn 5: ChatGPT

_2026-09-16T17:20:51.059Z_

A useful way to scope this is not “which files should be deleted?” but **which state in the disk claims continuity with the old machine**. That includes identifiers, credentials, cached cloud-instance state, scheduler history, and application/node identity. There is no finite OS-level list that covers an arbitrary customer VM: once software such as MySQL, Kubernetes, Puppet, Consul, VPN agents, or a commercial monitoring agent has enrolled, it can add another clone-sensitive identity. The platform therefore has to decide what semantics a snapshot-derived machine is meant to have.

I surveyed upstream Linux/systemd/cloud-init/OpenSSH documentation and the current AWS, Google Cloud, Azure, DigitalOcean, Hetzner, Red Hat, Proxmox, Kubernetes, Docker, HashiCorp, Puppet, Chef, Salt and related primary sources. The important finding is that **standard cloud-image machinery handles a useful core, but it is not a general VM-cloning generalizer**.

### A taxonomy that matters

There are four materially different things mixed together in a disk image:

| Kind of state | Desired relation after cloning | Typical consequence if copied |
|---|---|---|
| **Machine identity** | Usually different | Two live machines are interpreted as one |
| **Machine credential / enrolment secret** | Usually different or explicitly re-enrolled | Clone possesses authority granted to source |
| **Cached external-instance state** | Must correspond to new VM | First-boot/configuration is skipped or stale configuration is replayed |
| **Historical/temporal state** | Depends on snapshot semantics | Missed jobs, duplicate jobs, wrong telemetry, stale logs |
| **Storage/data identity** | Often deliberately identical | Only becomes wrong if both copies enter the same namespace/topology |

That last distinction is important. Changing every UUID is not correct either: a restored filesystem needs its filesystem UUID if `/etc/fstab` refers to it, and a restored database may intentionally need its old replication identity when replacing—not cloning—a failed member.

## Core OS and access state

| State in the image | What goes wrong on a second machine | Security vs correctness | What normal cloud-image machinery does |
|---|---|---|---|
| **OpenSSH host private keys** `/etc/ssh/ssh_host_*_key` | Both machines present the same SSH server identity. A control plane expecting a newly generated fingerprint sees a pin mismatch; a control plane that carries the old pin forward cannot distinguish the two machines cryptographically. Theft of either copy's host private key permits impersonation of the other. OpenSSH's defaults point directly at these host-key files. ([OpenBSD Manual](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com)) | **Both; high security significance.** | cloud-init's SSH module is once-per-instance; `ssh_deletekeys` defaults to `true` and new RSA/ECDSA/Ed25519 keys are generated when that module actually executes as first-instance configuration. ([Cloud-Init Documentation](https://docs.cloud-init.io/en/latest/reference/modules.html?highlight=power_state&utm_source=chatgpt.com)) GCE's guest agent likewise documents host-key generation as a first-boot action. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/images/guest-agent-functions?authuser=2&utm_source=chatgpt.com)) |
| **`authorized_keys`**, `AuthorizedPrincipalsFile`, trusted SSH CA configuration | Every key already accepted by the source is accepted by the clone unless something explicitly removes it. In the described hosting design this includes the provider's management principal. If that credential was meant to be per-machine, the old control plane—or anyone holding its private half—retains access to the clone. | Primarily **security**, sometimes correctness when automation uses the wrong key. | Injection of a newly selected cloud SSH key does **not** imply deletion of pre-existing keys. Hetzner explicitly says keys already present in a snapshot's `authorized_keys` continue to work. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) Google's guest agent manages keys for Google-managed users but says unmanaged users are not touched. ([GitHub](https://github.com/GoogleCloudPlatform/guest-agent/blob/main/README.md?utm_source=chatgpt.com)) AWS Image Builder's cleanup is unusually aggressive: it can delete every user's `authorized_keys`. ([AWS Documentation](https://docs.aws.amazon.com/imagebuilder/latest/userguide/security-best-practices.html?utm_source=chatgpt.com)) |
| **SSH client keys / deploy keys / service keys** under `/root/.ssh`, user homes, application config | The clone can authenticate *outward* as the old host/user, perhaps to Git, backups, management networks, or another machine. | **Security.** Often more serious than the duplicated SSH host key. | Not generically regenerated. This is application/customer state. |
| **`/etc/machine-id`** and often `/var/lib/dbus/machine-id` | systemd requires the machine ID to identify the installed OS instance. Duplicates leak into services that derive IDs from it; journald attribution, DHCP DUIDs, IPv6 stable addressing, systemd-derived IDs and software licensing/enrolment can all collide. systemd explicitly says generic images for multiple machines should ship this missing or empty. ([man7.org](https://man7.org/linux/man-pages/man5/machine-id.5.html?utm_source=chatgpt.com)) | Mostly **correctness/identity**, with secondary security/privacy effects where it seeds authorization or pseudonymous identifiers. | systemd generates an ID if absent/empty. There is an important semantic wrinkle: a *missing* file or one containing `uninitialized` gives systemd “first boot” semantics; an empty file gets a new ID but is not itself considered first boot for `ConditionFirstBoot=yes`. ([man7.org](https://man7.org/linux/man-pages/man5/machine-id.5.html?utm_source=chatgpt.com)) Current `cloud-init clean --machine-id` deliberately writes `uninitialized` on systemd systems. ([Cloud-Init Documentation](https://docs.cloud-init.io/en/latest/reference/cli.html?utm_source=chatgpt.com)) |
| **systemd/journald state** `/var/log/journal/<machine-id>/…` | Journals from source and clone have the same `_MACHINE_ID`; central collectors may aggregate them as one host. If the machine ID is changed without reconciling journal directories, old persistent logs can become awkward or invisible to the normal journal lookup path. Journald stores persistent logs under a machine-ID directory and records `_MACHINE_ID` and `_BOOT_ID` separately. ([man7.org](https://man7.org/linux/man-pages/man8/systemd-journald.service.8.html?utm_source=chatgpt.com)) | **Correctness/forensics/privacy.** | Not intrinsically purged by changing machine-id. Image-building systems often clean logs separately. AWS Image Builder deletes `/var/log/journal/*`. ([AWS Documentation](https://docs.aws.amazon.com/imagebuilder/latest/userguide/security-best-practices.html?utm_source=chatgpt.com)) A systemd issue documents a machine-ID/journal mismatch producing `No journal files were found`. ([GitHub](https://github.com/systemd/systemd/issues/7092?utm_source=chatgpt.com)) |
| **Cloud-init cache and semaphores** `/var/lib/cloud/…`, cached datasource, instance ID, user/vendor data | Per-instance modules may not run; stale networking, users, SSH keys and user-data may be treated as already applied. Conversely, forcing a fresh first boot can deliberately rerun destructive per-instance user data. `/var/lib/cloud/instance` contains datasource data including user/vendor data. ([Cloud-Init Documentation](https://docs.cloud-init.io/en/latest/development/internal_files.html?utm_source=chatgpt.com)) | **Both.** Incorrect configuration plus potentially serious credential exposure. | Generic cloud images normally use cloud-init's `check` mode: cached instance ID is compared with the runtime datasource ID; a difference makes it a new instance. But `manual_cache_clean: true` changes this to “trust cache”, in which case cloning requires explicit cache cleanup. Cloud-init's own warning specifically notes that otherwise SSH host-key rotation does not occur. ([Cloud-Init Documentation](https://docs.cloud-init.io/en/24.4/explanation/first_boot.html?utm_source=chatgpt.com)) `cloud-init clean` removes its state and can additionally clean machine-id, seed data and generated network/SSH config. ([Cloud-Init Documentation](https://docs.cloud-init.io/en/latest/reference/cli.html?utm_source=chatgpt.com)) |
| **Hostname, `/etc/hosts`, resolver/network configuration, static addresses, interface MAC bindings / NetworkManager connection UUIDs** | Duplicate hostname confuses logs, DNS, service discovery and clusters; copied static IP/MAC bindings can leave the new VM offline or collide with the source. Older persistent udev NIC rules can rename the replacement NIC unexpectedly. | Mostly **correctness**. | Cloud metadata/cloud-init normally replaces the relevant portions on supported images, but arbitrary locally authored networking is not automatically generalized. Red Hat's current VM-cloning guide explicitly calls out MAC/IP/DNS/gateway/connection UUIDs, `/etc/hosts` and resolver state as clone-sensitive. ([Red Hat Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/configuring_and_managing_linux_virtual_machines/cloning-virtual-machines?utm_source=chatgpt.com)) |
| **DHCP leases and DHCP client identity** | A copied client identifier can cause a DHCP server to treat two VMs as one client. Old leases may also be retried: ISC `dhclient` explicitly keeps old leases and can reuse a still-valid lease when DHCP is initially unavailable. ([Debian Manpages](https://manpages.debian.org/trixie/isc-dhcp-client/dhclient.8.en.html?utm_source=chatgpt.com)) | **Correctness**, occasionally network-security policy implications. | It depends on DHCP implementation. `dhclient` stores its DUID in lease state and may create/reuse it there. ([Debian Manpages](https://manpages.debian.org/trixie/isc-dhcp-client/dhclient.8.en.html?utm_source=chatgpt.com)) NetworkManager's `duid` client-ID mode hashes `/etc/machine-id`, so resetting machine-id fixes that derivation. ([NetworkManager](https://www.networkmanager.dev/docs/api/latest/settings-ipv4.html)) systemd-networkd's default DUID type likewise hashes machine-id; its explicit `DUIDRawData=` overrides that derivation and would therefore survive a machine-id change. ([man7.org](https://man7.org/linux/man-pages/man5/networkd.conf.5.html)) AWS Image Builder and Azure `waagent -deprovision` explicitly remove cached DHCP leases. ([AWS Documentation](https://docs.aws.amazon.com/imagebuilder/latest/userguide/security-best-practices.html?utm_source=chatgpt.com)) |
| **IPv6 “stable” addressing and other machine-id-derived network values** | Even with a new MAC, a duplicate machine-id may yield duplicated stable address material in configurations that derive the secret from it. systemd-networkd documents stable-privacy addressing and other IDs derived from machine-id. ([man7.org](https://man7.org/linux/man-pages/man5/systemd.network.5.html)) | **Correctness/privacy.** | Fixed when the underlying machine-id is fresh, unless a stable secret/explicit value was itself persisted. |
| **`/var/lib/systemd/random-seed` and bootloader random seed** | Copies start with the same saved entropy. On entropy-starved VMs this could make early random output correlated or guessable—the exact period during which fresh SSH/TLS keys might be made. systemd explicitly warns against placing the same seed into replicated images. ([man7.org](https://www.man7.org/linux/man-pages/man8/systemd-random-seed.8.html?utm_source=chatgpt.com)) | **Security.** | systemd replaces the seed after use, but that doesn't make a cloned initial seed desirable. The documented image-building rule is to omit it. AWS Image Builder deletes it unconditionally. ([AWS Documentation](https://docs.aws.amazon.com/imagebuilder/latest/userguide/security-best-practices.html?utm_source=chatgpt.com)) |

The SSH case illustrates why a host-key-pinned control plane has **two different failure modes**, neither of which can be solved merely by “pinning better”. If host keys are regenerated, an old pin is expected to fail. If they are not regenerated, the clone and source cryptographically have the same server identity. Similarly, keeping the provider's existing `authorized_keys` entry may be intentional if the provider uses a single account-wide management key, but is a credential-continuity decision—not harmless snapshot state.

## Storage-protocol host identity

**iSCSI** has a long-lived InitiatorName, normally `/etc/iscsi/initiatorname.iscsi`. Open-iSCSI's generator refuses to overwrite an existing one without `--force`, precisely because it is persistent identity; `iscsid` reads that file and also has a persistent nodes/discovery database under `/var/lib/iscsi`. ([Debian Manpages](https://manpages.debian.org/unstable/open-iscsi/iscsi-gen-initiatorname.8.en.html?utm_source=chatgpt.com))

A clone therefore inherits both the initiator IQN and potentially target records, auto-login settings and CHAP credentials. A storage target may treat the machines as one initiator for ACLs and sessions; the clone may automatically log back into LUNs belonging to the source. That is both a **correctness** problem and, where IQN/CHAP state gates storage, a **security** problem. Stock cloud-init has no universal iSCSI identity-reset module; an installed InitiatorName is normally retained.

**NVMe-oF** has the analogous `/etc/nvme/hostnqn` and usually `/etc/nvme/hostid`. The nvme-stas tools describe both as values that should remain permanent for the lifetime of a host and explicitly say to generate them only when their files do not already exist. ([Debian Manpages](https://manpages.debian.org/unstable/nvme-stas/stasadm.1.en.html?utm_source=chatgpt.com)) That means an ordinary disk clone containing the files inherits the identity. Again there is no generic first-boot reset in stock cloud images. Controllers can use NQN/host ID for host ACLs, reservations and association, so duplication ranges from wrong controller attribution to storage-access consequences.

This pattern generalizes to Fibre Channel aliases, multipath `wwids`/bindings where locally persisted, and application-created storage login credentials. They cannot safely be cleared merely because a VM was cloned: sometimes the purpose of the restore is precisely to resume access to the same storage.

## Package registration, subscription and telemetry identity

Package *caches* are mostly harmless; package **registration** is not.

APT itself does not give Ubuntu hosts a universal APT machine UUID. But adjacent services do. Canonical's Ubuntu Pro documentation treats golden-image cloning as an identity problem and specifically directs image builders to clear `/etc/machine-id`; Public Cloud Ubuntu Pro images subsequently auto-attach. ([Ubuntu Documentation](https://documentation.ubuntu.com/pro-client/en/docs/howtoguides/create_pro_golden_image/?utm_source=chatgpt.com)) A manually supplied Ubuntu Pro subscription token is a secret and must be treated as such. ([Ubuntu Documentation](https://documentation.ubuntu.com/pro-client/en/v35/explanations/pro_token_and_machine_usage/?utm_source=chatgpt.com))

Red Hat Subscription Management is even more explicit. Red Hat's current VM-cloning instructions call for `subscription-manager clean` before cloning and separately remove SSH host keys and network-specific data. ([Red Hat Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/configuring_and_managing_linux_virtual_machines/cloning-virtual-machines?utm_source=chatgpt.com)) Red Hat also has a documented Satellite failure in which cloned RHSM facts left multiple content hosts with duplicate UUIDs; the published root cause says the old `facts.json` was copied during cloning and registration then reported a duplicate UUID. ([Red Hat Customer Portal](https://access.redhat.com/solutions/4207781?utm_source=chatgpt.com))

DNF's optional `countme` mechanism maintains persistent state to place the machine in longevity/counting buckets. Copying that state biases repository telemetry rather than ordinarily breaking boot or access. That belongs in the **telemetry-correctness/privacy** category, not the same severity class as an SSH or Puppet private key.

The same audit question applies to vendor update clients, license daemons, live-patching systems and “phone home” inventory agents: look for a locally persistent machine/account UUID plus an authentication token. The package manager itself may be innocent while the subscription layer is not.

## Timers, cron and historical execution state

A plain crontab is a schedule, not a machine identity. Cloning it is normally correct. Persistent scheduling **state**, however, changes semantics.

`systemd.timer` with `Persistent=true` stores the time at which the timer last triggered; after downtime, activation checks whether the timer should have run and can immediately trigger a missed invocation. systemd provides `systemctl clean --what=state` to remove the saved timestamp. ([GitHub](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml?utm_source=chatgpt.com)) A snapshot therefore copies “when this other VM last ran the job”.

`anacron` similarly persists timestamps under `/var/spool/anacron`; those timestamps record the date on which jobs last ran. ([Debian Manpages](https://manpages.debian.org/unstable/anacron/anacron.8.en.html?utm_source=chatgpt.com)) A clone can consequently suppress work because “the source already did it”, or perform a catch-up job immediately. Whether either is wrong depends on the job: package update is mostly correctness; backup rotation, billing export, ACME issuance or a one-time migration can have bigger effects.

There are similar state files in update timers, backup software and job runners. Cloud-init does **not** generally reset these. Proxmox's LXC machinery is noteworthy because it explicitly rewrites container host keys and even randomizes cron scheduling when configuring a container, but that is Proxmox's container-specific guest-configuration path rather than a generic QEMU disk sanitizer. ([Proxmox VE](https://pve.proxmox.com/pve-docs-9-beta/pct.1.html?utm_source=chatgpt.com))

## Enrolled management and monitoring agents

This category is open-ended and is where an OS-only “cleanup list” most often stops being sufficient.

Puppet agents store a node private key and certificate in their SSL directory; Puppet documents `private_keys/<certname>.pem` and `certs/<certname>.pem`, and explains that if those files are cleared the agent generates a new key and requests a new certificate. ([Puppet Help](https://help.puppet.com/core/8/content/puppetcore/dirs_ssldir.htm?utm_source=chatgpt.com)) A VM clone with the old directory can authenticate as the source Puppet node: **both an identity collision and a credential duplication**.

Salt's minion identity has the same structure. Salt documents the minion private/public keys under `/etc/salt/pki/minion/` and the master's acceptance of that key under a particular minion ID. ([Salt Project Docs](https://docs.saltproject.io/salt/user-guide/en/latest/topics/security.html?utm_source=chatgpt.com)) Cloning both minion ID and key gives two hosts one management identity.

Chef's `client.pem` is an API-client credential tied to a `node_name`; Chef's troubleshooting guide tells administrators to remove `client.pem` and re-register when that credential is wrong. ([Chef Documentation](https://docs.chef.io/client/19/troubleshooting/?utm_source=chatgpt.com))

Consul makes the persistence especially explicit: `node_id` is “unique … across all time”; when automatically generated it is persisted in the agent data directory. The same data directory can also contain ACL tokens. ([HashiCorp Developer](https://developer.hashicorp.com/consul/docs/reference/agent/configuration-file/node?utm_source=chatgpt.com)) A captured agent data directory therefore contains both identity and potentially authorization.

VPN/overlay agents belong here too. Tailscale, for example, says its persistent state includes the machine private key, node WireGuard private keys and Tailnet Lock private keys, and describes cloning resistance as one reason for encrypting that state at rest. ([Tailscale](https://tailscale.com/blog/encrypting-data-at-rest?utm_source=chatgpt.com)) Those are unequivocally **security-sensitive clone state**.

Monitoring products vary. Some derive host identity from EC2/GCE instance metadata and recover cleanly on a new instance; some create a local GUID or enrollment certificate and will merge two hosts into one dashboard object. There is no safe generic rule that “monitoring data may be copied”.

## Container engines and cluster/node state

A standalone OCI/containerd installation that merely has local images and containers is different from an **enrolled node**.

Docker Swarm managers persist the swarm's state, including encryption keys for the Raft log, under `/var/lib/docker/swarm`; Docker tells administrators to back up that whole directory to restore the same manager identity. ([Docker Documentation](https://docs.docker.com/engine/swarm/admin_guide/?utm_source=chatgpt.com)) Duplicating it into another concurrently active machine therefore does not create a new clean Swarm node—it duplicates cluster state and credentials. Docker's issue tracker contains an observed case of two live nodes showing the same Swarm node ID, illustrating that duplicate node identity is not merely theoretical. ([GitHub](https://github.com/moby/moby/issues/46167?utm_source=chatgpt.com))

Kubernetes kubelets hold node client credentials under `/var/lib/kubelet/pki`, and kubelet's bootstrap flow writes a generated client certificate/key there and references it through its kubeconfig. ([Kubernetes](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/?utm_source=chatgpt.com)) kubeadm also documents that `kubelet.conf` is node-specific and that kubelet certificates rotate under `/var/lib/kubelet/pki`. ([Kubernetes](https://kubernetes.io/docs/setup/best-practices/certificates/?utm_source=chatgpt.com)) A cloned joined node can therefore authenticate as the old Kubernetes node, while duplicate hostname/node-name adds a separate correctness collision. `kubeadm reset` exists specifically to revert node membership state, but it is not something a general cloud image runs automatically. ([Kubernetes](https://kubernetes.io/docs/reference/setup-tools/kubeadm/kubeadm-reset/?utm_source=chatgpt.com))

Nomad, Consul, k3s, RKE, etcd and other cluster software have analogous persisted peer/node IDs and TLS material.

## Other recurring clone-sensitive state

A serious audit should also look for these classes, even though no finite provider cleanup can know every instance:

| Class | Examples | Why it matters |
|---|---|---|
| **Host PKI and domain membership** | `/etc/krb5.keytab`, Samba/AD machine-account secrets, host TLS private keys, mTLS certificates | Two hosts authenticate as one principal. Usually **security + correctness**. |
| **VPN identity** | WireGuard private keys, Tailscale state, IPsec machine certs | Duplicate network principal; often a direct **security** problem. |
| **Database node identity** | MySQL `datadir/auto.cnf`, explicit `server_id`; database/cluster member IDs | Duplicate replication identity, split-brain or topology errors. MySQL explicitly says a copied replica must delete `auto.cnf` so a new `server_uuid` is generated. ([MySQL](https://dev.mysql.com/doc/refman/5.7/en/replication-howto-additionalslaves.html?utm_source=chatgpt.com)) |
| **Service-discovery/cluster state** | Consul `node-id`, etcd member data, RabbitMQ node/cookie state, Elasticsearch data-node metadata | A “new machine” starts as an existing cluster member. |
| **Application activation/licensing** | license certificates, machine GUIDs, activation tokens | Duplicate seats or rejected activation; sometimes secret bearer credentials. |
| **Mail identity/secrets** | DKIM private keys, SMTP client certs/passwords, queue contents | Clone can send as original domain or replay queued mail. |
| **Backup agent identity** | repository credentials, client ID, snapshot history | Clone may overwrite or prune the source's backup history. |
| **Pending queues and durable work state** | mail queues, print queues, message-spool files, local task queues | Restoring a snapshot can replay side effects. This is a restore-semantics issue, not exactly an identity issue. |
| **Filesystem, partition, LVM, mdraid, LUKS, ZFS identifiers** | FS UUIDs, GPT PARTUUID, LVM PV/VG UUIDs, RAID UUIDs, pool GUIDs | Usually **must remain unchanged** for an isolated disk clone; become ambiguous if original and clone are attached into one host/storage namespace. This is a strong counterexample to “regenerate every UUID”. |
| **Logs, shell history, cloud-init user-data, temporary credentials** | `/var/log`, `~/.bash_history`, metadata/user-data caches | Mostly disclosure rather than identity; can contain passwords/tokens and source information. AWS and Azure image-prep procedures deliberately clean some of this. ([AWS Documentation](https://docs.aws.amazon.com/imagebuilder/latest/userguide/security-best-practices.html?utm_source=chatgpt.com)) |

MySQL supplies one of the clearest documented clone failures. Its `server_uuid` is loaded from `auto.cnf`; if that file is missing a fresh UUID is generated. A replication receiver aborts if its source UUID equals its own. ([MySQL](https://dev.mysql.com/doc/refman/8.0/en/replication-options.html?utm_source=chatgpt.com)) In MySQL bug #70060, the reproducer is literally “create a VM replica, clone the VM, change the server ID, start both”; only one could stay connected because the VM clone retained the UUID. ([MySQL Bugs](https://bugs.mysql.com/bug.php?id=70060&utm_source=chatgpt.com)) Bug #72581 documents two replicas with the same UUID repeatedly disconnecting each other at high frequency and spamming logs. ([MySQL Bugs](https://bugs.mysql.com/bug.php?id=72581&utm_source=chatgpt.com))

That is an important warning against pretending this is solely an operating-system problem.

# What the major providers actually do or document

| Provider | Documented image/clone behavior relevant here |
|---|---|
| **AWS / AMIs** | AWS explicitly tells shared-AMI authors to remove SSH host key pairs, stating that leaving them in creates an MITM risk and that AWS audits public AMIs for this problem. It expects launch public keys to be obtained from instance metadata and installed at boot, commonly via cloud-init. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/building-shared-amis.html?utm_source=chatgpt.com)) EC2 Image Builder goes considerably further: its cleanup removes cloud-init state, host keys, users' `authorized_keys`, instance logs, DHCP leases, `/var/lib/systemd/random-seed`, rsyslog/journal state, and truncates both machine-id files. ([AWS Documentation](https://docs.aws.amazon.com/imagebuilder/latest/userguide/security-best-practices.html?utm_source=chatgpt.com)) An ordinary customer-created AMI should not be assumed to have received all Image Builder's sanitization. |
| **Google Compute Engine images** | Google's guest agent documents one-time-first-boot generation of SSH host keys and storage of a unique GCE instance ID at `/etc/google_instance_id`; its systemd unit intentionally starts before sshd so host keys can be regenerated. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/images/guest-agent-functions?authuser=2&utm_source=chatgpt.com)) The agent continuously reconciles metadata-managed users/SSH keys, but explicitly does not touch unmanaged users. ([GitHub](https://github.com/GoogleCloudPlatform/guest-agent/blob/main/README.md?utm_source=chatgpt.com)) Thus GCE has platform-aware regeneration, but it is not an arbitrary application-identity scrubber. |
| **Azure Linux / waagent** | Azure's `waagent -deprovision` removes Azure provisioning state, cached DHCP leases, resets hostname, and—when `Provisioning.RegenerateSshHostKeyPair=y`—removes SSH host keys. `-deprovision+user` also removes the last provisioned user. Microsoft explicitly warns this does **not** guarantee removal of all sensitive information. ([Microsoft Learn](https://learn.microsoft.com/ga-ie/azure/virtual-machines/extensions/agent-linux?view=azurermps-5.4.0&utm_source=chatgpt.com)) Current image preparation also calls `cloud-init clean` before `waagent -force -deprovision+user`. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/create-upload-generic?utm_source=chatgpt.com)) Azure distinguishes a deliberately **generalized** image from a **specialized** image because preserving machine state can be a valid semantic choice. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/generalize?utm_source=chatgpt.com)) |
| **DigitalOcean** | Custom images are required to contain correctly configured cloud-init or equivalent. DigitalOcean explicitly instructs image creators to purge previous cloud-init state with `cloud-init clean` or by cleaning `/var/lib/cloud`, otherwise the new Droplet can use the wrong datasource/state. ([DigitalOcean](https://docs.digitalocean.com/products/custom-images/how-to/upload/?utm_source=chatgpt.com)) The recovery environment even has an operation “Clear out Cloud-Init cached data (will regenerate host ssh keys)”. ([DigitalOcean](https://docs.digitalocean.com/products/droplets/how-to/recovery/recovery-iso/?utm_source=chatgpt.com)) This does not amount to automatic cleanup of arbitrary installed software. |
| **Hetzner Cloud** | Hetzner's documented behavior exposes an especially useful boundary: snapshots made from their official cloud-init-capable images are reconfigured on restoration; a selected new key is injected at first boot. **But keys already in the snapshot's `authorized_keys` continue to work.** Snapshots of rescue/manual installations might not be suitable for this cloud-init reconfiguration at all. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) So Hetzner explicitly demonstrates that “new provider key injected” and “old access removed” are separate properties. |
| **Proxmox VE** | For **LXC**, Proxmox documents active guest generalization: it sets hostname/network/DNS, rewrites `ssh_host_keys` so each container gets unique keys and randomizes cron timing. ([Proxmox VE](https://pve.proxmox.com/pve-docs-9-beta/pct.1.html?utm_source=chatgpt.com)) For **QEMU VM templates**, Proxmox cloning is fundamentally disk/config cloning; normal cloud-image customization is expected to come from the guest's cloud-init-compatible template rather than an exhaustive host-side scan of the Linux filesystem. The storage docs describe template base images becoming read-only bases for cloned disks. ([Proxmox VE](https://pve.proxmox.com/pve-docs-7/pvesm.1.html?utm_source=chatgpt.com)) |
| **Red Hat/libvirt guidance** | Although not one of the named clouds, Red Hat's cloning documentation is instructive because it explicitly enumerates network-specific information, RHSM registration, SSH host keys and “other application-specific identifiers or configurations”. ([Red Hat Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/configuring_and_managing_linux_virtual_machines/cloning-virtual-machines?utm_source=chatgpt.com)) It effectively acknowledges the open-ended part of the problem that cloud-provider first-boot code cannot solve. |

There is also a distinction between **provider-owned standard images** and a snapshot of a VM that has already booted for months. Standard images are intentionally manufactured to be instantiated: machine-id is empty/uninitialized, cloud-init cache is absent, SSH host keys are absent or deleted by first-instance logic, and no customer agents have yet enrolled. A snapshot of a running customer machine has exactly the opposite provenance.

## How much can “first boot” be trusted?

For a reasonably conventional modern Linux cloud image:

| Artifact | Normally fresh after first instantiation? | Condition |
|---|---|---|
| systemd machine-id | **Yes** | Only if image left it absent/empty/`uninitialized`, or image tooling explicitly resets it. |
| SSH host keys | **Usually** | cloud-init must recognize a new instance and `cc_ssh` must run; or provider guest agent must have its own first-boot handling. |
| cloud-init instance state | **Usually** | Datasource must expose a different instance ID and `manual_cache_clean` must remain false, or cache must have been cleaned. ([Cloud-Init Documentation](https://docs.cloud-init.io/en/24.4/explanation/first_boot.html?utm_source=chatgpt.com)) |
| Metadata SSH key | **Usually injected** | Does not imply removal of unrelated/pre-existing authorized keys. |
| DHCP client identity | **Often indirectly** | Works where identifier derives from fresh machine-id or fresh MAC. Persistent explicit DUIDs/lease DBs can defeat that. |
| random seed | **Should be absent from manufactured image** | A raw running-system snapshot contains it unless platform cleans it. |
| iSCSI/NVMe host identity | **No general guarantee** | Existing files are deliberately persistent. |
| RHSM/Ubuntu Pro/custom package registration | **Product-specific** | Needs product-aware image preparation or cloud-specific auto-attach. |
| systemd timer/anacron history | **No** | Persists as normal filesystem state. |
| monitoring/configuration agent enrollment | **Generally no** | Must be handled by that agent or image-build process. |
| Kubernetes/Docker Swarm/Consul node state | **No** | These systems intentionally persist identity and credentials. |
| arbitrary application identity | **No** | Cannot be solved generically. |

## Documented failures from duplicated or mishandled identity

Several primary sources show real consequences rather than theoretical hygiene.

**MySQL VM cloning** caused two replicas with the copied `server_uuid` to displace each other's connection. The MySQL bugs describe both “only one clone can connect” and a reconnect/disconnect loop that floods logs. ([MySQL Bugs](https://bugs.mysql.com/bug.php?id=70060&utm_source=chatgpt.com))

**Red Hat Satellite/RHSM cloning** produced duplicate-UUID registration failures because a clone retained the source machine's subscription facts. Red Hat explicitly attributes the failure to old RHSM data copied into the cloned VM. ([Red Hat Customer Portal](https://access.redhat.com/solutions/4207781?utm_source=chatgpt.com))

**Docker Swarm** has a reported production symptom in which two nodes have the same Swarm node ID after upgrade/state handling, demonstrating the kinds of cluster ambiguity a copied node identity creates. ([GitHub](https://github.com/moby/moby/issues/46167?utm_source=chatgpt.com)) Docker separately documents `/var/lib/docker/swarm` as the state that must be preserved to restore the *same* swarm manager, including encryption keys. ([Docker Documentation](https://docs.docker.com/engine/swarm/admin_guide/?utm_source=chatgpt.com))

**Consul** documents registration failures where a node name is reserved by a different node ID after restore, and the product documentation treats node ID as a persistent identity across time. ([HashiCorp Developer](https://developer.hashicorp.com/consul/docs/error-messages/consul?utm_source=chatgpt.com)) It is the mirror image of the clone problem: cluster recovery has to deliberately decide whether a machine is the old member or a new one.

**systemd journal** has had real cases where machine-ID state and persistent-journal layout disagreed and `journalctl` reported that there were no journal files. ([GitHub](https://github.com/systemd/systemd/issues/7092?utm_source=chatgpt.com))

Cloud-init's own first-boot documentation calls stale captured cache both a functional and a security issue because per-instance configuration, including SSH host-key rotation, may be skipped. ([Cloud-Init Documentation](https://docs.cloud-init.io/en/24.4/explanation/first_boot.html?utm_source=chatgpt.com))

# What this says about the hosting-product model

There are at least three internally consistent product semantics, and none is universally the right one.

An **exact clone/restore** says the disk represents the same machine state at a different point or location. Keeping application credentials, database IDs, timer state and even some cluster membership can be necessary. Running the source and clone simultaneously is then inherently unsafe for many workloads.

A **generalized image/template** says the disk is software content from which independent machines will be instantiated. In that model SSH host keys, OS machine ID, cloud-init state, platform credentials, DHCP identity, entropy seed and installed-agent/node identities need deliberately new identities. But application-aware generalization is required once the source has enrolled into external systems.

A **hybrid cloud snapshot**—which is what many VM hosting products expose—preserves almost everything but has a small first-boot layer rewrite network settings, cloud instance state and access. This is convenient, but it necessarily leaves some duplicate identities and credentials. Hetzner's documented “new key injected while old snapshot keys continue working” is a concrete example of that semantic boundary. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))

For the SSH-managed design in the question, the control plane therefore has to make **two explicit policy choices**, not one: whether a clone is supposed to retain the source's management authorization, and whether it is supposed to retain the source's SSH server identity. Reusing the old host private key answers the second question “yes”; copying the old `authorized_keys` answers the first “yes”. A host-key pin database cannot make either choice disappear.

The larger conclusion is that **a disk snapshot is a serialization of an already-enrolled machine, not automatically a reusable machine image**. systemd and cloud-init provide well-defined primitives for the OS-level portion; AWS Image Builder and Azure generalization automate substantial subsets; GCE, DigitalOcean and Hetzner rely heavily on guest-agent/cloud-init first-instance behavior; Proxmox has more invasive host-driven handling for containers. None of them can safely and generically reset iSCSI/NVMe access, Puppet/Salt/Chef identities, VPN credentials, Kubernetes/Swarm/Consul membership, database replication UUIDs, arbitrary commercial-agent enrollment, and similar application state without knowing whether the new VM is supposed to be a replacement, an independent clone, or a continuation of the old one.
