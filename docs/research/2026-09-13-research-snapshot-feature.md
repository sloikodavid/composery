# Research Snapshot Feature

Source: https://chatgpt.com/share/6aa6f563-c7ac-83eb-bd8d-631464dc6c28

---

**User**

Research a future snapshot feature for a VPS product starting on Hetzner Cloud and later supporting VMs on dedicated hosts. We have no requirement to implement snapshots now, and migration between backends is not promised. Users may have root and alter partitions or filesystems. Compare Hetzner-native snapshots, guest file backups, and block-image backups only to establish the smallest honest product contract.

Use primary documentation. Verify export/import capabilities rather than assuming them. Cover attached volumes, architecture, boot mode, minimum disk size, image metadata, crash consistency versus application consistency, encryption and key recovery, Btrfs versus LUKS, and the effect of uncooperative guests. Analyze whether snapshots should survive source deletion and how ownership and permissions should work. Include create-from-snapshot, duplicate as a composed operation, fresh machine identities/SSH host keys, and copied application secrets. Explain why a successful capture does not prove a successful restore.

Return a compatibility matrix, minimal future snapshot metadata, and a recommendation on whether native Hetzner snapshots are a sound first feature. Identify what must be known now versus what can wait. Do not assume universal portability or prescribe a filesystem without a requirement. Cite primary sources and give a disposable restore-verification plan.

---

**ChatGPT**

I’ll anchor the comparison in Hetzner’s current primary docs/API, then use Linux/cryptsetup/systemd documentation only where the contract depends on guest behavior. I’ll separate “must decide now” from implementation details that can safely wait, and I’ll treat portability/export as unproven unless the docs explicitly support it.

---

**ChatGPT**

The first constraint is already clear: a Hetzner Cloud snapshot is a copy of the server’s primary disk only; attached Volumes are explicitly excluded. Hetzner also says running-server captures are not guaranteed disk-consistent, while snapshots persist after source deletion and are architecture-bound.

---

**ChatGPT**

A second boundary is important for the later dedicated-host backend: Hetzner exposes snapshots as provider-managed image resources with architecture and disk-size metadata, but its official image API surface exposes get/list/update/delete/protection—not a snapshot-content download/export or customer image upload/import path. So cross-backend migration must **not** be part of a native-snapshot contract.

---

**ChatGPT**

## Executive conclusion

**Yes: Hetzner-native snapshots are a sound first snapshot feature, provided the product contract is deliberately narrow.** They are a better semantic fit for “snapshot” than guest file backups, and they avoid prematurely building a portable block-image system. Hetzner defines a snapshot as a manually created copy of the server disk, permits creating a new server from it, keeps it independently until deleted, and explicitly excludes attached Volumes. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/))

The smallest defensible contract is approximately:

> **A snapshot is a backend-managed copy of a VM's primary disk, usable to create a new compatible VM on the same backend. It does not include attached volumes, does not promise cross-backend portability, application consistency, encryption-key recovery, or identity/secret rotation. Compatibility constraints recorded at capture time apply at restore.**

For Hetzner specifically, add: **same CPU architecture**, and if the source was running, **no consistency guarantee**. Hetzner recommends powering the VM off and explicitly says data consistency cannot be guaranteed for a snapshot taken while it is running. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/))

I would **not** define the generic product abstraction as “a filesystem backup” or “a universally portable VM image.” That would create promises neither Hetzner-native snapshots nor arbitrary root-controlled guests can satisfy.

---

## Compatibility matrix

| Property | Hetzner-native snapshot | Guest file backup | Future host-side block image |
|---|---|---|---|
| Fundamental unit | Provider-managed copy of server primary disk | Selected files/directories visible inside guest | Copy/snapshot of virtual block device(s) |
| Preserves partition table, bootloader, arbitrary filesystem | **Yes, as opaque disk contents** | **No**, not inherently | **Yes** |
| Attached Hetzner Volumes | **No. Explicitly excluded.** ([Hetzner Docs](https://docs.hetzner.com/cloud/volumes/overview/?utm_source=chatgpt.com)) | Can include mounted Volume files if deliberately selected, but not atomically with root by default | Only if every relevant virtual disk is explicitly included |
| Guest cooperation needed to capture | No | Yes: credentials/agent/filesystem access | No for block capture; yes for quiescing/app consistency |
| Uncooperative/root-modified guest | Still capturable, subject to consistency/bootability problems | Can disable agent, unmount data, change paths/permissions, or otherwise defeat backup | Still capturable; guest can prevent graceful quiescing |
| Running capture | Hetzner says consistency is **not guaranteed** ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/)) | Ordinary file traversal is not an atomic machine state | Only crash-consistent if underlying storage/hypervisor provides a genuine atomic point-in-time snapshot; a sequential live `dd` is not |
| Powered-off capture | Hetzner-recommended route to disk consistency ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/)) | Stable files, but still not a bootable-machine representation by itself | Stable block representation |
| Application consistency | **Not promised** | Possible with app-specific backup protocols/hooks; not generic | Possible only with guest/app cooperation or application-aware tooling |
| Multiple filesystems/disks | Only primary server disk | Possible, but coordinating a single point in time is difficult | Requires coordinated snapshots of all included devices |
| CPU architecture | Restore server must match snapshot architecture, e.g. x86→x86 and Arm64→Arm64 ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/)) | Data files may be portable; restored OS/binaries need not be | Should default to same architecture unless explicit conversion/emulation is supported |
| Boot mode / firmware | Not exposed as image compatibility metadata; safely hidden behind “same Hetzner backend” | Must be reconstructed separately | Must become explicit compatibility metadata |
| Virtual hardware | Hetzner Cloud uses KVM and virtio disks/NICs ([Hetzner Docs](https://docs.hetzner.com/cloud/technical-details/faq/?utm_source=chatgpt.com)) | Not preserved | Defined by future VM backend; restore compatibility must be validated |
| Secure Boot / TPM | Hetzner Cloud currently supports neither Secure Boot nor vTPM/TPM ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/)) | N/A to file copy itself | Backend-specific |
| Minimum restore disk | Product should require **≥ captured virtual disk size** | No image-level minimum; enough space plus recreated layout | ≥ captured virtual disk size unless an explicit shrink/conversion facility exists |
| Filesystem independence | Good; treat contents as opaque | Poorer: semantics depend heavily on file backup implementation | Good |
| Btrfs | Transparent at block/native level | Generic file backup does not preserve arbitrary subvolume/snapshot semantics; Btrfs snapshots are non-recursive across nested subvolumes ([BTRFS Documentation](https://btrfs.readthedocs.io/en/latest/Subvolumes.html?utm_source=chatgpt.com)) | Transparent as block data |
| LUKS | Captures ciphertext and on-disk LUKS metadata; **does not recover an unknown passphrase/key** | If backing up an unlocked mount, normally stores plaintext files rather than the encryption envelope | Same principle as native block copy |
| Provider-managed encryption-at-rest promise | **Do not claim one.** Hetzner's TOM says encryption of data and backups at rest for unmanaged products is the client's responsibility. ([Hetzner Docs](https://docs.hetzner.com/general/security-and-identify/technical-and-organizational-measures/)) | Product-controlled, depending on destination | Product-controlled |
| Exportable snapshot artifact | **No documented binary export/download operation found** | Usually yes as files/archive, but not thereby a VM image | Can be, if designed that way |
| Import from foreign image | **No documented Cloud snapshot upload/import operation found** | Files can be restored | Potentially, but bootability/compatibility remains separate |
| Survives source VM deletion | **Yes** ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/)) | If stored independently | Should |
| “Create new VM from snapshot” | Native Hetzner operation ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/)) | Requires rebuilding OS/layout first | Natural future operation |
| Portability to future dedicated backend | **Not promised** | Data-level portability possible | Possible only to whatever compatibility contract you later implement |

The biggest distinction in the table is that **guest file backup is useful backup technology, but it is not the smallest faithful implementation of a VPS “snapshot.”** PostgreSQL gives a good concrete example: copying its files while it is running is not sufficient; a true consistent filesystem snapshot behaves like a crash and requires WAL recovery, and multiple filesystems need simultaneous snapshots. ([PostgreSQL](https://www.postgresql.org/docs/17/backup-file.html?utm_source=chatgpt.com)) Filesystem freezing can create a stable on-disk filesystem image by completing transactions and flushing dirty data, but that still does not make arbitrary applications semantically consistent. ([man7.org](https://www.man7.org/linux/man-pages/man8/fsfreeze.8.html?utm_source=chatgpt.com))

---

## Export/import and future backend portability

This is one area where avoiding assumptions matters.

The current Hetzner Cloud API describes Images as VM disk blueprints. Its published image operations are list/get/update/delete plus protection; snapshots are created through the server `create_image` action. There is **no documented operation to download/export the contents of a Cloud snapshot and no operation to upload/import a customer's VM image as a Cloud snapshot**. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

Hetzner does let snapshots move between Cloud projects, but that is an internal resource move, not artifact export. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/))

Similarly, Hetzner's dedicated-server facilities do not bridge this gap. `installimage` can install particular custom Linux `.tar.gz` images under documented constraints, and dedicated systems can be installed through ISO/KVM, but that is not an HCloud-snapshot import mechanism. ([Hetzner Docs](https://docs.hetzner.com/robot/dedicated-server/operating-systems/installing-custom-images/?utm_source=chatgpt.com))

Therefore the contract should say **“restorable on a compatible backend”**, not “portable image.” A future migration product can be built separately.

---

## Architecture, disk size, boot mode and image metadata

Hetzner's image model exposes `image_size`, `disk_size`, creation/source information, OS flavor/version, architecture, protection and labels, among other state. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/image.go)) Architecture is a real compatibility constraint: Hetzner explicitly disallows restoring an x86 snapshot onto Arm64 or vice versa. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/))

`disk_size` should become your **minimum restore-disk requirement**. Do not optimize it down to “number of bytes actually used.” Hetzner itself refuses disk shrinking regardless of used capacity because a virtual disk can contain arbitrary partitions, filesystems and encryption that the platform cannot safely shrink. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) This is particularly relevant when users have root.

`os_flavor` and `os_version` are useful display/provenance values but should **not be compatibility authorities**. A root user can replace the filesystem contents after the original image was installed.

Boot mode deserves a subtle treatment. The Hetzner image metadata has architecture but no firmware/boot-mode property. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/image.go)) For a Hetzner-native-only contract that is acceptable: firmware compatibility is effectively encapsulated by “restore through Hetzner Cloud.” It is **not evidence that boot mode does not matter**. When you introduce VMs on dedicated hosts, record the VM's firmware mode explicitly—e.g. BIOS/UEFI/unknown—as part of that backend's compatibility metadata. Do not infer it from whether an EFI partition happens to exist.

Hetzner's own documented raw partition-migration procedure illustrates why “we have the bytes” is weaker than “the resulting machine boots”: it calls out UUID/fstab fixes and reinstalling GRUB after moving partitions. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/migrate-partition/?utm_source=chatgpt.com))

---

## LUKS and Btrfs: orthogonal concerns

These should not drive a filesystem choice.

**LUKS is block encryption.** A whole-block/native snapshot copies the encrypted blocks and their on-disk LUKS header/keyslots. It does not somehow learn an external passphrase or recovery secret. Cryptsetup documents that if the LUKS header is damaged, the data is lost without a header backup; a header backup plus a passphrase valid at backup time can itself continue to unlock the data, which also makes that header backup sensitive key material. ([man7.org](https://www.man7.org/linux/man-pages/man8/cryptsetup-luksHeaderBackup.8.html?utm_source=chatgpt.com))

So the product contract should be: **guest encryption is preserved opaquely, and recovery of guest-managed encryption keys is the user's responsibility unless you later introduce an explicit key-management product.** A snapshot marked “available” can therefore be perfectly intact and still unrecoverable because the user lost the unlock secret.

A guest file backup of an already-unlocked LUKS filesystem has the opposite property: it can copy plaintext files but generally does not preserve the LUKS container/header/keyslot arrangement.

**Btrfs is a filesystem/COW mechanism, not an encryption substitute.** Its own documentation says a Btrfs snapshot shares underlying blocks and is not itself a backup; nested subvolumes are not recursively included in an ordinary subvolume snapshot. Btrfs send/receive can deliberately transport read-only subvolume snapshots, but reconstructs an equivalent filesystem object rather than an exact 1:1 block image. ([BTRFS Documentation](https://btrfs.readthedocs.io/en/latest/Subvolumes.html?utm_source=chatgpt.com))

None of that creates a reason for your VPS product to prescribe ext4, Btrfs, LUKS, or anything else. **The strongest small contract treats the primary disk as opaque.**

---

## Source deletion, ownership and permissions

Snapshots should **survive source-machine deletion by default**. That is consistent both with the disaster-recovery use case and with Hetzner's own snapshot lifecycle: snapshots remain after the originating server has been deleted, unlike server-bound Backups. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/)) Cascading snapshot deletion with VM deletion would turn an independent recovery asset into an unexpectedly fragile child resource.

I would model ownership as **project/tenant ownership**, not ownership by the human who clicked “Create snapshot.” Keep the original VM ID as immutable provenance even after that VM disappears. An explicit “delete VM and its snapshots” workflow can exist later, but it should enumerate the independently billed recovery objects and require separate authorization.

The authorization rules should be capability-oriented: creating needs access to the source plus `snapshot.create`; restoring needs `snapshot.use` plus `machine.create`; deleting needs `snapshot.delete`; moving ownership between projects needs a stronger administrative permission. “Duplicate” needs the union of those permissions.

Do not blindly clone Hetzner's role descriptions. Their current general Cloud FAQ says a `Restricted` user cannot create or delete snapshots, while the older snapshot-specific FAQ still says restricted users can change them. ([Hetzner Docs](https://docs.hetzner.com/cloud/general/faq/)) That documentation discrepancy is another reason your own API authorization contract should be explicit and tested independently.

Deletion protection can remain a separate property; Hetzner supports protection against accidental snapshot deletion. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/))

---

## Create-from-snapshot versus duplicate

These should be distinct concepts.

**Create from snapshot** is the low-level operation: create a compatible machine whose primary disk starts with the captured disk contents. Everything inside that disk should be assumed copied—including `/etc/machine-id`, SSH configuration and host private keys, TLS keys, database passwords, API tokens, cluster credentials and application secrets.

Hetzner does some cloud-init-based reconfiguration for snapshots descended from its official images, including injecting selected SSH authorization keys or a generated root password. It explicitly warns that snapshots from systems installed through other means may not be fit for this cloud-init reconfiguration. Existing authorized SSH keys in the snapshot can remain usable. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/))

That is not enough to promise safe cloning for every root-controlled guest.

**Duplicate** should therefore be a composed, higher-level operation:

`capture/create-from-snapshot → instantiate new VM → establish fresh machine identity where supported → verify boot`

A proper simultaneous duplicate should have a fresh system machine identity and fresh SSH **host** keys. Cloud-init provides mechanisms to delete inherited host keys and generate new ones, and its image-building guidance recommends cleaning cloud-init state and the machine ID before a cloned image's first boot. ([Cloud-Init](https://cloudinit.readthedocs.io/en/latest/topics/modules.html?highlight=growpart&utm_source=chatgpt.com)) But because users can replace cloud-init, encrypt the root disk, change filesystems, or otherwise make the guest opaque, **you cannot guarantee identity sanitation for arbitrary snapshots without a supported-guest condition.**

Thus:

- generic **create-from-snapshot** may be a literal disk clone;
- **duplicate** may promise fresh machine identity/SSH host keys only for guest configurations where you have a tested first-boot mechanism;
- neither operation should imply rotation of arbitrary **application secrets**. A duplicate may deliberately contain the same database credentials, TLS private key or SaaS API token until the application/operator rotates them.

That distinction avoids a dangerous implication that “fresh SSH keys” means “no duplicated secrets.”

---

## Why successful capture does not prove successful restore

The provider reporting a snapshot as `available` proves that its **capture operation completed**, not that the saved system is recoverable. Hetzner's image state itself distinguishes `creating` and `available`, but that metadata says nothing about application health. ([GitHub](https://github.com/hetznercloud/hcloud-go/blob/main/hcloud/image.go))

A successful capture may contain an already-corrupt filesystem, a broken bootloader, an OS that depends on an excluded Volume, a database caught in an unusable live-copy state, an encrypted root filesystem whose unlock secret has been lost, duplicate machine identity, or a guest configured for devices that the future destination does not expose. A running Hetzner capture adds the stronger problem that Hetzner makes **no disk-consistency guarantee at all**. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/))

This suggests two distinct statuses forever:

**capture status:** creating / available / failed

**restore verification:** never tested / last test succeeded / last test failed

Never translate `available` into “verified backup.”

---

## Minimal future snapshot metadata

This is enough to preserve the contract without prematurely designing the dedicated-host implementation:

| Field | Why it belongs now |
|---|---|
| `id` | Product resource identity |
| `project_id` / `tenant_id` | Stable ownership independent of source VM |
| `backend` | e.g. `hetzner_cloud_native`; prevents pretending all artifacts are equivalent |
| `backend_ref` | Opaque provider snapshot/image identifier |
| `state` | `creating`, `available`, `failed`, `deleting` |
| `created_at` | Snapshot provenance |
| `source_machine_id` | Historical origin; must remain meaningful after source deletion |
| `architecture` | Required Hetzner restore constraint |
| `min_restore_disk_bytes` | Do not restore onto smaller primary disk |
| `boot_mode` | `provider_managed`, `bios`, `uefi`, or `unknown`; Hetzner-native can initially use `provider_managed` |
| `included_devices` | At minimum identifies primary disk |
| `excluded_devices` | Records attached Volumes/disks known to be omitted, avoiding ambiguity |
| `consistency` | At least `offline_disk_consistent`, `crash_consistent`, `application_consistent`, `unknown` |
| `capture_power_state` | Explains why a consistency value was assigned |
| `restore_scope` | Initially something like `same_backend`; prevents implicit portability promises |
| `description` / user label | Usability |
| `delete_protected` | If exposed |
| `provider_metadata` | Optional namespaced/advisory metadata, not part of generic guarantees |

I would **not** make filesystem type, LUKS detection, OS name/version, Btrfs layout, or “encrypted=true/false” mandatory metadata. With arbitrary root access these are expensive or unreliable observations, can change underneath you, and are unnecessary for an opaque block snapshot.

Likewise, do not store `application_consistent=true` merely because the VM was powered off. A cleanly stopped system has a stable disk; whether every application reached some application-defined consistency point is a stronger assertion the infrastructure layer generally cannot prove.

If restore testing is later automated, add `last_restore_verification_at`, `verification_result` and the verifier version separately. They should never modify the original capture-consistency claim.

---

## What needs deciding now, and what can wait

| Must be fixed in the product model now | Can safely wait |
|---|---|
| A snapshot is a backend-specific primary-disk recovery object, not universally portable | Raw/qcow2/other dedicated-host artifact format |
| Attached Hetzner Volumes are excluded | Multi-volume snapshot orchestration |
| Snapshot survives source deletion | Retention schedules and automated pruning |
| Project/tenant owns snapshot | Storage implementation, compression and dedupe |
| Same-architecture constraint | CPU emulation or conversion |
| Target disk cannot be smaller than recorded minimum | Automated filesystem/partition shrinking |
| Boot compatibility is explicit/unknown rather than guessed | Exact dedicated-host firmware/machine types |
| Running Hetzner snapshot has unknown/unpromised consistency | Guest freeze agents and app-aware quiescing |
| No app-consistency promise without app cooperation | PostgreSQL/MySQL/etc. plugins |
| No guest-encryption key-recovery promise | KMS/key escrow/recovery products |
| Create-from-snapshot copies the disk including secrets | Automated application-secret rotation |
| Duplicate is higher-level than restore | Which guest families qualify for guaranteed identity sanitation |
| Cross-backend export/migration is outside snapshot contract | A separate migration/conversion feature |
| Capture success and verified restore are separate concepts | Automated restore-verification service |

The schema should be extensible now, but the dedicated-host implementation does not need to be chosen now.

---

## Disposable restore-verification plan

A meaningful verification test should exercise the contract rather than merely make an API call:

1. **Build disposable source fixtures.** Have one VM per supported architecture and at least one root-customized fixture. Record partition layout, filesystem types, `/etc/machine-id`, SSH host-key fingerprints, sentinel file hashes and a small application's known state. Attach a Hetzner Volume containing a different sentinel so exclusion can be proven.

2. **Exercise capture consistency separately.** Create a snapshot with a cleanly powered-off source. If live capture will ever be exposed, create another while continuously writing and treat its expected consistency as `unknown`, not as a passing consistency test.

3. **Exercise lifecycle independence.** Delete one source VM and confirm its snapshot remains usable. This verifies the product's source-deletion contract, not just Hetzner's documentation.

4. **Test compatibility gates before restore.** Reject the wrong architecture and a target primary disk below `min_restore_disk_bytes` at your API layer. Then create a disposable compatible machine from the snapshot.

5. **Verify restoration, not just boot creation.** Require the guest to reach userspace; check filesystem integrity/recovery messages, sentinel hashes, expected mounts and the test application's actual state. Confirm the attached-Volume sentinel is absent and that the product never represented that Volume as captured.

6. **Test encryption explicitly.** For a LUKS fixture, restore using the independently retained unlock secret and prove data access. In a separate destructive fixture, deliberately omit the secret and verify the system correctly reports that the snapshot does not provide key recovery rather than claiming corruption. Cryptsetup's documented recovery dependency makes this an important distinction. ([man7.org](https://www.man7.org/linux/man-pages/man8/cryptsetup-luksHeaderBackup.8.html?utm_source=chatgpt.com))

7. **Exercise duplicate identity semantics.** On any guest type for which the product promises a safe duplicate, compare source and clone machine IDs and SSH host-key fingerprints and require them to differ. At the same time, put a benign “application secret” sentinel in the source and verify that it *does* remain copied—demonstrating the boundary of the identity-rotation promise.

8. **Add hostile layouts over time, then destroy everything.** Useful regression fixtures include Btrfs with nested subvolumes, LUKS, custom partitioning/bootloader, a nearly full disk, disabled cloud-init and an intentionally uncooperative guest. After recording outcomes, delete the restored machine and test snapshot so verification remains genuinely disposable.

---

## Recommendation

Implementing nothing now is entirely reasonable. The decisions worth preserving in the design today are the **semantics**, not the storage machinery.

When snapshots do become a feature, **Hetzner-native snapshots are the right first implementation** because they align naturally with an opaque whole-primary-disk contract, survive source deletion, support create-new-server directly, preserve arbitrary guest disk layouts without requiring a guest agent, and let you avoid inventing a portable image format before portability is actually a requirement. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/))

The product wording should avoid four traps: don't call attached Volumes protected; don't promise consistency for live Hetzner snapshots; don't equate provider `available` with restorable; and don't promise export/migration to the future dedicated-host backend.

Guest file backup can later be a **different backup product**, especially for selective recovery or application-aware protection. Host-side block images can later implement the **same snapshot abstraction** on dedicated-host VMs. Neither requires weakening the initial contract, and neither requires prescribing Btrfs, LUKS, or any other guest filesystem.
