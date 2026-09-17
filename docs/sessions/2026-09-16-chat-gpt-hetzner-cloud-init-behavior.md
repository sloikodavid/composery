# Hetzner Cloud-init Behavior

Source: https://chatgpt.com/share/6aab2c44-e3ac-83eb-b7cb-79d46da726b1

---

## Turn 1: User

_2026-09-16T22:58:53.848Z_

As of September 2026, from Hetzner's documentation and cloud-init's documentation, describe how cloud-init behaves on

Hetzner Cloud: the maximum user data size, when user data runs relative to network and SSH readiness, which datasource

Hetzner uses and what instance identifier it provides, what happens to user data on rebuild and on a server created from

a snapshot, whether write_files to /run survives a reboot, and known failure modes where user data silently does not

run. Distinguish Hetzner-specific behaviour from generic cloud-init behaviour.

---

## Turn 2: ChatGPT

_2026-09-16T23:52:08.032Z_

I’ll separate what Hetzner explicitly documents from what cloud-init itself guarantees, and I’ll call out where behavior depends on datasource/cache state rather than Hetzner policy.

---

## Turn 3: ChatGPT

_2026-09-16T23:52:35.503Z_

A key distinction is emerging: “rebuild” and “create a new server from a snapshot” are not equivalent to cloud-init. The deciding factor is the cached instance ID on disk versus Hetzner’s current metadata instance ID.

---

## Turn 4: ChatGPT

_2026-09-16T23:53:23.173Z_

As of September 2026, the cleanest way to think about Hetzner Cloud + cloud-init is: **Hetzner supplies a Hetzner-specific datasource and metadata/user-data transport; cloud-init decides when and whether the supplied data is actually applied.** Those are separate layers.

| Question | Hetzner-specific behavior | Generic cloud-init behavior |
|---|---|---|
| **Maximum user-data size** | Hetzner limits Cloud config / `user_data` to **32 KiB**. The Console documents that limit, and Hetzner’s Terraform/Python tooling describes the same 32 KiB limit. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/?utm_source=chatgpt.com)) | cloud-init itself supports much larger/varied user-data formats; the 32 KiB ceiling is a **Hetzner transport/API limit**, not a cloud-init limit. |
| **Datasource** | Official Hetzner images use `DataSourceHetzner`. The datasource reads `http://169.254.169.254/hetzner/v1/...` (and, in current cloud-init, an IPv6 link-local equivalent). Hetzner says its official system images include the required special cloud-init datasource. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/main/cloudinit/sources/DataSourceHetzner.py)) | Datasource selection and caching are cloud-init mechanisms. |
| **Instance identifier** | Hetzner metadata exposes `instance-id`, whose documented value is the numeric **Hetzner Server ID**; e.g. server 42 returns `42`. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) The current Hetzner datasource also verifies that this value equals the VM’s SMBIOS system serial number. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/main/cloudinit/sources/DataSourceHetzner.py)) | cloud-init uses the datasource's instance ID to decide whether this is a new instance and therefore whether `once-per-instance` modules should run. |
| **Network timing** | The Hetzner datasource itself needs enough networking to reach the Hetzner metadata service; current `DataSourceHetzner` can establish ephemeral networking to fetch it. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/main/cloudinit/sources/DataSourceHetzner.py)) | cloud-init's **Network** stage occurs after configured networking is up. It fully consumes user-data there; early things such as `bootcmd`/boothooks may execute then. ([Cloud-init](https://cloudinit.readthedocs.io/_/downloads/en/20.4/pdf/?utm_source=chatgpt.com)) |
| **Normal shell user-data / `runcmd` timing** | Nothing Hetzner-specific changes the usual cloud-init stage model. | A `#!` user-data script runs in the **Final** stage, relatively late in boot; `runcmd` is prepared earlier but is actually executed by `scripts_user` in Final. ([Cloud-init](https://cloudinit.readthedocs.io/topics/format.html?utm_source=chatgpt.com)) |
| **SSH readiness** | Hetzner does not document “SSH ready” as meaning “cloud-init finished.” | **Do not use successful SSH as a completion signal.** Final-stage user scripts can still be running after the machine is network-reachable and sshd is available. cloud-init explicitly recommends using `cloud-init status --wait` when another process must wait for completion. ([Cloud-init](https://cloudinit.readthedocs.io/_/downloads/en/22.1_a/pdf/?utm_source=chatgpt.com)) |

### Network up is not the same thing as provisioning complete

There are several user-data execution points. Cloud-init's Network stage waits for configured networking before doing full user-data processing, but a conventional shell script supplied as user-data, and commands from `runcmd`, execute much later in `cloud-final.service`. ([Cloud-init](https://cloudinit.readthedocs.io/_/downloads/en/20.4/pdf/?utm_source=chatgpt.com))

That means a Hetzner server can accept SSH while your provisioning script is still installing packages, writing application configuration, or restarting services. The robust readiness test is therefore something like `cloud-init status --wait`, not “port 22 accepted a connection.”

### Rebuilds

There was an important Hetzner change on **16 January 2026**: the rebuild API gained an optional `user_data` parameter. Hetzner describes it as functionally identical to the `user_data` used when creating a server. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog)) A rebuild overwrites the server disk with the selected image; Hetzner’s client documentation describes `user_data` as “Cloud-Init user data to use during Server rebuild.” ([GitHub](https://github.com/hetznercloud/hcloud-python/blob/main/hcloud/servers/client.py?utm_source=chatgpt.com))

The important qualification is that **supplying user-data and cloud-init executing a once-per-instance action are not the same guarantee**. With a normal Hetzner-provided system image, you are starting from an image prepared for first-boot cloud-init, so the expected behavior is that the rebuild's user-data is consumed on that new installation.

A rebuild **from a snapshot** is subtler, because the snapshot is a disk image and can contain `/var/lib/cloud` state from the machine from which it was taken. Hetzner explicitly says snapshots are copies of the server disk. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/?utm_source=chatgpt.com)) Cloud-init's generic rule is to compare the cached previous instance ID with the datasource's current instance ID; if they are equal, it treats the boot as the same instance and normally suppresses `once-per-instance` work. ([Cloud-init](https://cloudinit.readthedocs.io/_/downloads/en/22.1_a/pdf/?utm_source=chatgpt.com))

So there is a potentially nasty same-server case:

**snapshot of server 123 → rebuild server 123 from that snapshot**

If the snapshot contains cloud-init state saying instance ID `123`, and the rebuilt VM is still Hetzner server `123`, cloud-init can regard it as the **same instance**. User scripts, `write_files`, `runcmd`, and many other modules are `once-per-instance`, so merely providing fresh user-data does not, generically, guarantee those modules will replay. This behavior comes from cloud-init's cache semantics, not from the Hetzner user-data API.

Hetzner's documentation does say snapshots made from official images remain suitable for first-boot reconfiguration—for example, SSH keys/root-password setup during rebuild is performed with cloud-init. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com)) But Hetzner does **not** document a general promise that every cloud-init semaphore/cache in an arbitrary customer snapshot is cleared for you. If your correctness depends on replaying arbitrary user-data after restoring a snapshot, clean the cloud-init state before imaging or explicitly design for that case.

### Creating a *new* server from a snapshot

This case behaves better.

A new Hetzner server gets a **new Server ID**, and `instance-id` is precisely that Server ID. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com)) Therefore, even if the snapshot contains `/var/lib/cloud` from the source machine, cloud-init's normal “check” policy sees:

`cached source server ID ≠ current new server ID`

and treats it as a **new cloud-init instance**, so `once-per-instance` processing is eligible to run again. That is exactly the class of cloning/image-capture scenario cloud-init's first-boot instance-ID comparison is designed to handle. ([Cloud-init](https://cloudinit.readthedocs.io/_/downloads/en/22.1_a/pdf/?utm_source=chatgpt.com))

What does **not** happen is automatic replay of “whatever old user-data created the source machine.” The snapshot preserves the *disk effects* of that old provisioning and possibly its cached cloud-init files. The new server's datasource supplies the user-data associated with the **new server creation request**. If you supply no new user-data, there is no new user-data payload merely because the disk came from a snapshot.

### `write_files` into `/run`

A `write_files` entry targeting `/run/foo` works during first boot; cloud-init even recommends `/run/...` instead of `/tmp/...` for boot-time temporary files because `/tmp` can race with `systemd-tmpfiles-clean`. ([Cloud-init](https://cloudinit.readthedocs.io/en/22.2/topics/modules.html?utm_source=chatgpt.com))

But **it does not survive a reboot**. `/run` is runtime state and the Filesystem Hierarchy Standard requires its contents to be cleared at boot. ([Freedesktop Specifications](https://specifications.freedesktop.org/fhs/latest/run.html?utm_source=chatgpt.com))

This combines badly with the fact that `cc_write_files` is **once-per-instance**. ([Cloud-init](https://cloudinit.readthedocs.io/en/22.2/topics/modules.html?utm_source=chatgpt.com)) Thus:

```text
first boot:
  write_files creates /run/myfile       ✓

ordinary reboot:
  /run is cleared                       ✓
  write_files does not run again        ✓
  /run/myfile is now absent             ✓
```

If you need a `/run` file every boot, create it from a systemd unit, `tmpfiles.d`, or a per-boot cloud-init mechanism—not ordinary `write_files`.

### Cases where user-data can appear to “silently” not run

The most important failure modes are a mixture of Hetzner-specific and generic cloud-init behavior:

- **Snapshot/cache says “same instance.”** This is generic cloud-init. Most user-facing cloud-config modules—including `write_files`, `runcmd`, and `scripts_user`—are once-per-instance. A preserved `/var/lib/cloud` with the same instance ID can cause new-looking user-data not to be re-consumed in the way you expected. ([Cloud-init](https://cloudinit.readthedocs.io/en/latest/topics/modules.html?highlight=growpart&utm_source=chatgpt.com))
- **Using a non-Hetzner/custom image that is not prepared for Hetzner's datasource.** Hetzner explicitly says their supplied system images contain the special datasource required for cloud-init; an OS installed manually through Rescue/ISO may not be suitable for Hetzner reconfiguration. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))
- **Metadata/DHCP reachability problems.** `DataSourceHetzner` obtains both metadata and user-data through Hetzner's link-local metadata service. If it cannot establish the ephemeral network or obtain a DHCP lease, datasource discovery can fail before user-data is available. The datasource code explicitly bails on DHCP failure. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/main/cloudinit/sources/DataSourceHetzner.py)) This has shown up in real cloud-init/Hetzner regressions and especially in unusual networking setups. ([GitHub](https://github.com/canonical/cloud-init/issues/5961?utm_source=chatgpt.com))
- **The cloud-init 24.4 Hetzner metadata connectivity regression.** In early 2025, Ubuntu builds with cloud-init 24.4 could report repeated timeouts reaching `/hetzner/v1/metadata/instance-id`; Ubuntu 24.04 could end with `cloud-init status` exit code 2 even though the machine otherwise appeared usable. ([GitHub](https://github.com/canonical/cloud-init/issues/5971?utm_source=chatgpt.com)) It is a good illustration of why checking only “VM is up” or SSH is misleading.
- **SSH succeeds before Final-stage scripts finish.** This is not technically a skipped run, but operationally it often looks like one. The user logs in, sees that the desired files/packages are not there yet, and assumes cloud-init failed while `cloud-final` is still executing. ([Cloud-init](https://cloudinit.readthedocs.io/topics/format.html?utm_source=chatgpt.com))
- **User-data has no recognized cloud-init format/header.** Generic cloud-init dispatches user-data according to its format—e.g. `#cloud-config`, `#!...`, MIME multipart, boothook, etc. Shell scripts require a shebang and cloud-config requires its identifying header. ([Cloud-init](https://cloudinit.readthedocs.io/topics/format.html?utm_source=chatgpt.com)) Syntax/schema errors are normally logged rather than surfaced by Hetzner's “server created” action, so from the Cloud Console side they can look silent.
- **You merely rebooted.** A plain reboot does not mean “run creation user-data again.” `scripts_user`, `write_files`, `runcmd`, and many modules are once-per-instance. ([Cloud-init](https://cloudinit.readthedocs.io/en/latest/reference/modules.html?highlight=ssh_pwauth&utm_source=chatgpt.com))

One additional September-2026-specific Hetzner point: Hetzner removed its old **EC2-compatible metadata routes after 1 August 2026**. Software must use the documented `/hetzner/v1/*` metadata paths. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog)) Current `DataSourceHetzner` does exactly that, so this mainly affects custom scripts or outdated software that hard-coded `/latest/meta-data/...` or `/2009-04-04/...`.

**Practical rule:** on Hetzner, treat **server creation/rebuild success**, **network availability**, **SSH availability**, and **cloud-init completion** as four different milestones. For automation, verify the last one explicitly with `cloud-init status --wait` and inspect `/var/log/cloud-init.log` / `/var/log/cloud-init-output.log` when it is not `done`.

---

If you want, I can:

- Explain how to reset cloud-init state to re-run user-data on Hetzner server rebuilds
- Describe best practices for ensuring reliable cloud-init execution on Hetzner servers
- Analyze Hetzner's user-data size limit impact on complex cloud-init scripts
