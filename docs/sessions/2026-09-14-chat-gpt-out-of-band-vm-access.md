# Out Of Band VM Access

Source: https://chatgpt.com/share/6aa874fd-fe08-83eb-98bc-6d072d1973dc

---

## Turn 1: User

_2026-09-14T22:02:03.247Z_

Context: A company runs customer VPS instances on Hetzner Cloud today and plans to run its own virtualization hosts later. Its control panel connects to each instance over SSH with a management key that cloud-init installs at creation. Customers have root, so they can remove that key, change the SSH configuration, or replace the operating system. The company wants to understand every way it can act on an instance, or restore its own access, without depending on SSH inside the instance.

Question: Which out-of-band channels exist for running commands, changing files, or restoring access on a virtual machine, and what are their tradeoffs?

Cover: Hetzner Cloud features (rescue system, rebuild with user data, root password reset, console, images, backups) and exactly what each allows; QEMU guest agent commands such as guest-exec and file writes; cloud-init behavior on later boots; virtio-serial and vsock agents; libvirt, Proxmox, Firecracker, and Cloud Hypervisor facilities; and what major cloud providers use. For each channel: whether the customer can disable it, what it needs inside the guest, security implications for the customer and for the company, whether it works on non-Linux guests, and whether the same design works on Hetzner Cloud and on the company's own hosts.

Evidence rules: Cite official documentation and source at exact versions. Distinguish provider-level actions from agents inside the guest. State the conditions under which each channel fails. Do not assume that a feature available on one platform exists on another.

---

## Turn 2: ChatGPT

_2026-09-14T22:02:02.938Z_

I’ll separate hard provider controls from guest-cooperative mechanisms, then compare portability to self-hosted hypervisors. I’m also going to verify the exact failure modes—especially Hetzner rebuild/user-data and password reset—because those are easy to overgeneralize.

---

## Turn 3: ChatGPT

_2026-09-14T22:02:30.752Z_

One key distinction is emerging: a “hypervisor channel” is not automatically an out-of-band command channel. QEMU/libvirt/Proxmox can expose devices or a console, but arbitrary in-guest execution still requires either a cooperative guest agent or offline disk/boot intervention.

---

## Turn 4: ChatGPT

_2026-09-14T22:05:13.146Z_

The public clouds follow the same split: AWS Systems Manager and Azure Run Command are agent-dependent, not hypervisor magic; GCP startup scripts likewise depend on its guest environment. Serial consoles are genuinely outside guest networking, but still need an OS/bootloader path that accepts input.

---

## Turn 5: ChatGPT

_2026-09-14T22:20:07.632Z_

The clean way to reason about this is to separate **provider/hypervisor authority** from **guest-cooperative mechanisms**. A channel is only truly out-of-band, in the strong sense, if a customer with root inside the guest cannot remove it.

For your situation, the most important conclusion is: **there is no guest agent that can be made undeletable from a customer who has full guest root and can replace the OS**. Your guaranteed recovery mechanisms must therefore live below the guest: boot control, console, disk replacement/attachment, snapshots, or an equivalent rescue environment. Guest agents are useful for convenience, but cannot be your final break-glass mechanism.

I am assuming the customer has administrator/root access **inside the VM but not access to the company's Hetzner project or future hypervisor management plane**.

## Channel matrix

| Channel | What it can actually do | Can guest root disable it? | Guest dependency / failure conditions | Non-Linux | Hetzner today / own hosts later |
|---|---|---|---|---|---|
| **Hard power/reset** | Start, stop, forced reset. Does not itself execute commands or edit files. | **No** | Graceful ACPI shutdown/reboot can be ignored by a broken/malicious guest; hard reset cannot. | Yes | Hetzner exposes power/reset; trivial on libvirt/Proxmox/Firecracker/CH too. hcloud-python 2.24.0 defines graceful ACPI reboot/shutdown and forced reset. ([GitHub](https://github.com/hetznercloud/hcloud-python/blob/main/hcloud/servers/client.py?utm_source=chatgpt.com)) |
| **Provider rescue/netboot** | Boot another trusted OS, mount the VM disk, read/write files, chroot, reset passwords/keys, repair filesystem, copy data. | **No**, assuming no provider credentials | Cannot transparently read tenant-only encrypted storage; may fail on unsupported/corrupt filesystems/storage layouts. | The rescue OS can manipulate raw disks from any guest, but filesystem-aware Windows repair is not guaranteed. | **Strong Hetzner primitive.** Reproduce later with PXE/rescue ISO or detached-disk maintenance. |
| **Virtual console** | Keyboard/display or serial I/O; can drive bootloader, installer, recovery shell or OS login. | Transport: **No**. Useful shell: **Yes** | Customer can remove console getty, disable SAC, lock bootloader, disable accounts, etc. Still useful for installer/rescue boot. | Yes if guest/firmware supports an appropriate console. | Hetzner VNC now; libvirt/Proxmox/QEMU consoles later. |
| **ISO / alternate boot media** | Boot installer/live/recovery image and thereby inspect/replace/edit disk. | **No** | Must be able to boot the media. FDE still protects existing data without key. | Yes, media-dependent | Hetzner permits ISO-based manual OS installation; equivalent is easy on conventional QEMU/Proxmox hosts. |
| **Rebuild / replace root disk** | Guaranteed way to put a known OS and credentials back on the VM. **Destroys current root-disk state.** | **No** | It never guarantees preservation of old data. Bootstrap inside new image must work if relying on cloud-init. | Image-dependent | Strong on Hetzner; straightforward on your storage layer later. |
| **Snapshot / backup / image restore** | Replace disk with earlier state, or create another VM from captured state. It does not execute code in the current VM. | **No** | Snapshot can preserve the same broken credentials/config; live snapshots can be crash-inconsistent; encrypted content remains encrypted. | Yes at block level | Hetzner and self-hosted both. |
| **Offline disk editing** | Directly edit `authorized_keys`, passwords/config, systemd units, registry, etc. | **No**, absent encryption | Fails on FDE without a key and on unsupported/corrupt storage. Never directly mount hostile tenant filesystems in the host kernel. | Linux and Windows with suitable tooling | Hetzner gives an approximation via Rescue; on own hosts use an isolated tool such as libguestfs. |
| **QEMU Guest Agent (QGA)** | `guest-exec`, password changes, file read/write, freeze/thaw, information gathering, shutdown, etc. | **Yes** | `qemu-ga` must be installed, running, have the device/transport, and permit the RPC. Root/SYSTEM can stop/uninstall/reconfigure it. | QGA supports multiple OSes, but RPC availability/build support must be checked individually. | Limited provider use on Hetzner; full control on your QEMU/Proxmox hosts. |
| **Custom virtio-serial agent** | Whatever protocol your daemon implements: command execution, file I/O, health, bootstrap. Avoids guest IP networking. | **Yes** | Requires your privileged daemon and VirtIO serial driver/device. Root can kill or replace daemon. | Driver/agent dependent | No documented generic Hetzner tenant interface; excellent option on own QEMU hosts. |
| **Custom vsock agent** | Same idea over AF_VSOCK rather than guest IP networking. | **Yes** | Requires vsock driver plus listening agent. If no guest listener exists, host has nothing to talk to. | VMM/driver dependent; do not infer Windows support merely because the VMM supports Windows | Firecracker/Cloud Hypervisor/QEMU support transport on own hosts; not exposed as a generic Hetzner tenant facility. |
| **cloud-init / metadata bootstrap** | Create files/users, run commands during defined boot stages. | **Yes** | Requires cloud-init, datasource and enabled boot services. Normal `runcmd` is not a persistent later-boot management channel. | Primarily Unix/Linux cloud images; not a generic Windows mechanism | Useful for create/rebuild on Hetzner; reproducible on own hosts with NoCloud/config-drive/metadata. |
| **Cloud-provider management agent** | AWS SSM, Azure Run Command/VMAccess, GCP guest environment perform privileged guest operations without SSH. | **Yes** | Agent/service/connectivity/config must survive. Tenant admin can stop/remove/alter it. | Usually Linux + Windows where documented | Conceptually portable as *your own agent*, but these specific provider services are not portable to Hetzner/self-hosting. |

That distinction—hard host authority versus a cooperative agent—is more important than whether the transport is SSH, TCP, virtio-serial, or vsock.

## Hetzner Cloud, feature by feature

**Rescue System is the strongest existing data-preserving Hetzner recovery channel.** Enabling it changes the next boot so the VM network-boots Hetzner's rescue environment; “Enable rescue & power cycle” performs the restart immediately. Once in Rescue, you have a separate root environment and can mount the primary disk. Hetzner explicitly documents mounting `/dev/sda1` under `/mnt`, browsing/copying files, and using chroot to reset a password. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/rescue-system/?utm_source=chatgpt.com))

Therefore Rescue can also restore your SSH management key by mounting the customer's root filesystem and editing the appropriate `authorized_keys`, independent of the customer's `sshd`. It can change configuration files, repair filesystems, reinstall a bootloader, or replace large portions of the OS. It does **not** defeat full-disk encryption. If the customer installs LUKS and only the customer possesses the key, Rescue sees encrypted blocks. Nor should you assume Hetzner's Linux Rescue environment understands every Windows or exotic filesystem/storage scheme. Hetzner's filesystem-repair documentation, for example, explicitly discusses ext, XFS and Btrfs. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/how-to-rescue/check-filesystem/?utm_source=chatgpt.com))

**“Reset Root Password” is importantly different from Rescue.** Hetzner's UI documents the button, but its official `hcloud-python` **2.24.0**, published September 11, 2026, says the `reset_password` action “only works for Linux systems that are running the qemu guest agent.” Hetzner also says its supplied images have QGA preinstalled specifically for password reset and that customers are free to uninstall it, at which point that functionality is lost. So this action is **not hard out-of-band access**. ([PyPI](https://pypi.org/project/hcloud/?utm_source=chatgpt.com))

By contrast, using Rescue, mounting the disk, chrooting and running `passwd` is genuinely independent of the customer's running QGA or SSH daemon. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/how-to-rescue/reset-password/?utm_source=chatgpt.com))

**The Hetzner console is VNC**, i.e. provider-delivered virtual keyboard/display. Hetzner describes it as the equivalent of sitting at the machine, and the 2.24.0 SDK calls it “vnc over websocket to keyboard, monitor, and mouse.” ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/vnc-console/?utm_source=chatgpt.com)) A customer cannot disable Hetzner's ability to expose the virtual display/input device merely by deleting your SSH key. But they can make the *installed OS* unusable through it: no console login service, no usable root password, locked bootloader, encrypted root waiting for a key, etc. The console becomes much stronger when combined with Rescue or ISO boot.

**Rebuild is a destructive hard recovery channel.** In hcloud-python 2.24.0 it is explicitly documented as overwriting the server's disk with an image and destroying all data on the target server. Since January 16, 2026, Hetzner's rebuild API also accepts `user_data`, functionally the same as create-time cloud-init user data. ([GitHub](https://github.com/hetznercloud/hcloud-python/blob/main/hcloud/servers/client.py?utm_source=chatgpt.com)) Thus you can always say, in effect, “discard this guest and instantiate our known image plus bootstrap data.” It is a guaranteed path to regain *a manageable machine*, not guaranteed access to the customer's old data.

There is a subtlety when rebuilding from a Snapshot. Hetzner says that if the server originally had an SSH key, that key is injected on first boot via cloud-init after rebuild; without a key it can set a generated root password. But Hetzner explicitly limits this guarantee to snapshots derived from its official images. A snapshot of an OS installed through Rescue or other custom means “will not be fit for reconfiguration via cloud-init” and can behave differently. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))

**Images, Snapshots and Backups are state sources, not command channels.** Hetzner describes Backups and Snapshots as copies of a server's disk. You can rebuild an existing server from one—which overwrites its current disk—or create another server from one. Attached Volumes are excluded. Hetzner also warns that while a snapshot/backup can be taken while running, consistency is not guaranteed; power-off is recommended. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/?utm_source=chatgpt.com))

So a backup cannot “put your SSH key back” into the current guest unless the captured image already contained it or you restore/rebuild and then have a working bootstrap mechanism. A snapshot is nevertheless valuable before invasive Rescue surgery.

**ISO boot** is another useful provider-level primitive. Hetzner supports manually installing operating systems from ISO via the virtual console. That makes ISO/live media a more general form of Rescue—especially useful for Windows—but again it is a boot/recovery path rather than an API for modifying a live guest. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/iso-installation-gateway/?utm_source=chatgpt.com))

## QEMU Guest Agent: powerful but explicitly cooperative

QGA is much more capable than Hetzner exposes to customers through its API. In the QEMU protocol, `guest-exec` executes a process inside the guest and can pass arguments/environment/stdin and capture output; `guest-exec-status` reports completion and output. `guest-file-open`, `guest-file-read`, `guest-file-write`, `guest-file-seek`, and `guest-file-flush` provide direct guest-file operations. The protocol has had file I/O since 0.15 and `guest-exec` since 2.5. These semantics are pinned here to the **QEMU 10.0.3** protocol documentation rather than assuming behavior from an unspecified QEMU release. ([QEMU Documentation](https://qemu.readthedocs.io/en/v10.0.3/interop/qemu-ga-ref.html))

QGA itself is a daemon **inside the VM**. QEMU documents transports including virtio-serial and vsock; its standard virtio-serial path is `/dev/virtio-ports/org.qemu.guest_agent.0`. The daemon can also be configured with allowed or blocked RPC lists. ([QEMU Documentation](https://qemu.readthedocs.io/en/v10.0.3/interop/qemu-ga.html))

That gives you an excellent operational path on your own hosts:

`control plane → libvirt/Proxmox → QGA channel → qemu-ga → guest-exec/file-write`

It avoids SSH, guest IP routing, the customer's `sshd_config`, and firewall rules. But a customer with root can still run `systemctl stop qemu-guest-agent`, delete it, replace its binary, change its allowlist, remove its driver, or install an entirely different OS. Therefore QGA should be treated as a **preferred management path with graceful failure**, not your recovery root of trust.

There is a security cost on both sides. For the customer, giving your control plane `guest-exec` is effectively giving it root/SYSTEM inside their VM. For you, the guest agent is also an untrusted input source toward the host management stack. A very recent example is libvirt's CVE-2026-77158: malformed `guest-get-disks` data from a malicious guest could crash the libvirt daemon; libvirt's security notice explicitly listed “disable guest agent for untrusted guests” as the workaround. ([Libvirt](https://www.libvirt.org/news.html?utm_source=chatgpt.com))

## libvirt and Proxmox

With **libvirt 12.7.0**—released September 1, 2026—`virsh qemu-agent-command` sends an arbitrary command through the QEMU Guest Agent. `qemu-monitor-command`, in contrast, talks to QEMU's **monitor/QMP**. These must not be conflated. QMP controls the virtual machine and emulated hardware; it is not an arbitrary shell inside the guest. Arbitrary *guest* execution comes from QGA's `guest-exec` or another in-guest daemon. ([Libvirt List Archives](https://lists.libvirt.org/archives/list/announce%40lists.libvirt.org/thread/RUTA6YB22ETBW7OKMXEE3U5AVXKOUSRX/?utm_source=chatgpt.com))

That distinction gives you two privilege planes on future hosts:

**QMP/libvirt host authority** can reset, stop, change virtual devices, attach disks/ISOs and alter the boot path, regardless of whether the guest cooperates. **QGA authority** can perform convenient semantic operations *inside* a cooperative OS.

**Proxmox VE 9.2**, released May 21, 2026 and shipping **QEMU 11.0**, exposes this distinction quite nicely in its RBAC model. Its current access-control source has separate `VM.Console`, `VM.PowerMgmt`, `VM.GuestAgent.FileRead`, `VM.GuestAgent.FileWrite`, `VM.GuestAgent.FileSystemMgmt`, and `VM.GuestAgent.Unrestricted` privileges. Proxmox's own development documentation specifically says `VM.GuestAgent.Unrestricted` permits arbitrary commands using `guest-exec`, while the file privileges cover QGA file read/write. ([Proxmox](https://www.proxmox.com/en/about/company-details/press-releases/proxmox-virtual-environment-9-2?utm_source=chatgpt.com))

That is a good model for your own control panel: do not make “VM management” one giant permission. Separate hard reset, console, file write, arbitrary guest execution, snapshot, rebuild, and offline recovery privileges.

None of these libvirt/Proxmox APIs are available to you as a Hetzner Cloud tenant merely because Hetzner itself runs virtualization. Hetzner's documented tenant API exposes selected actions; QMP/libvirt host ownership remains with Hetzner.

## cloud-init is bootstrap, not a durable backdoor

This is another place where designs often fail.

In **cloud-init 26.2**, `bootcmd` is documented as running every boot, whereas normal `runcmd` runs on the first boot. More generally, cloud-init distinguishes per-boot, per-instance and one-time modules. ([Cloud-Init](https://cloudinit.readthedocs.io/topics/examples.html?utm_source=chatgpt.com))

So “change user-data in the provider and reboot” is not a generic substitute for SSH:

1. The provider must actually let you change the data source for the existing instance. On Hetzner, the documented `user_data` inputs are creation and, since January 2026, **rebuild**; rebuild is destructive. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))
2. The guest still needs cloud-init and the correct datasource.
3. The relevant module must be configured to run again. Ordinary `runcmd` is not.
4. Root can stop/disable/uninstall cloud-init, alter its cache or datasource, or replace the OS entirely.

Hetzner explicitly says its system images contain a special cloud-init datasource; it does not promise that arbitrary custom images do. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))

For your future platform, cloud-init remains excellent for **day-zero provisioning**. It is not a suitable break-glass control channel.

## virtio-serial and vsock agents

A custom agent over **virtio-serial** or **virtio-vsock** is often a better design than SSH for routine control because the host/guest communications path does not depend on guest IP addressing, firewalling, DNS, or `sshd`.

But these mechanisms are only transports. A virtio port cannot execute `/bin/sh` by itself. You need something like:

`host socket → virtio/vsock → your guest daemon → authenticated RPC → privileged operation`

The guest daemon then implements `exec`, atomic file replacement, account/key repair, reboot, health reporting, etc.

**Firecracker 1.17.0**, released September 10, 2026, illustrates this perfectly. Its tagged vsock documentation requires `CONFIG_VHOST_VSOCK` on the host side and `CONFIG_VIRTIO_VSOCKETS` in the guest; a host-initiated connection is forwarded to software listening on the requested guest port, and if nobody is listening Firecracker terminates the connection. ([GitHub](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/vsock.md)) Its v1.17.0 API schema contains no `guest-exec` endpoint. ([GitHub](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/src/firecracker/swagger/firecracker.yaml))

Firecracker's `/serial` endpoint should also not be mistaken for a generic interactive recovery console. In v1.17.0 it is described as configuring a serial console **to which the guest writes kernel logs**, and it has no effect unless serial output is enabled on the guest kernel command line. ([GitHub](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/src/firecracker/swagger/firecracker.yaml)) In other words, build your own vsock agent if you need semantic management.

**Cloud Hypervisor 53.0**, released July 12, 2026, similarly documents VSOCK as a stream socket transport. The guest starts a listener and then the host can connect and exchange data. It requires `CONFIG_VHOST_VSOCK` on the host and `CONFIG_VIRTIO_VSOCKETS` in the documented Linux guest configuration. ([GitHub](https://github.com/cloud-hypervisor/cloud-hypervisor/releases?utm_source=chatgpt.com))

Cloud Hypervisor does support Windows guests, but that does **not** imply every vsock arrangement is automatically supported on Windows. Its tagged Windows documentation gives a different useful mechanism: Windows **Special Administration Console (SAC)**. SAC must first be enabled inside Windows using `bcdedit`; once enabled, it provides a text console and can launch a `cmd` channel. Since the customer administrator can later disable SAC, it is again a console facility whose usefulness depends on guest configuration. ([GitHub](https://github.com/cloud-hypervisor/cloud-hypervisor/blob/v53.0/docs/windows.md))

For custom virtio/vsock agents, authenticate at the application layer even though the device is host-local. Give every VM a distinct channel/credential and enforce message size, replay, timeout and operation limits. Most importantly, treat all data coming *from* the guest as attacker-controlled.

## Offline disk editing on your own hosts

For a real break-glass system on self-hosted infrastructure, an excellent architecture is:

`stop/fence VM → snapshot/clone disk → attach to isolated maintenance appliance → modify disk → detach → boot`

That can restore an SSH key, reset an account, remove a bad network config, install/re-enable your guest agent, change Windows registry state, etc., without trusting the running guest.

Do **not** simply `mount` an arbitrary customer's ext4/XFS/NTFS filesystem directly in your management host's kernel. `libguestfs` explicitly says never to directly mount an untrusted guest filesystem on the host because filesystem-parser kernel bugs become a host compromise path. Current stable **libguestfs 1.60.0** was released July 9, 2026; its security guidance uses an isolated appliance specifically to reduce this risk. ([Libguestfs](https://libguestfs.org/guestfs-release-notes-1.60.1.html?utm_source=chatgpt.com))

Encryption is the hard limit. If a customer configures full-disk encryption and retains the only key, the provider can still shut down, reset, snapshot, delete, or overwrite the machine, but cannot guarantee data-preserving file edits. There is no virtualization trick that changes that without obtaining/escrowing the decryption key.

## What AWS, Azure and Google actually do

The major clouds also use a mixture of hard provider mechanisms and removable guest agents; they do not have a magical hypervisor syscall that means “run PowerShell/bash in arbitrary tenant OS.”

**AWS Systems Manager Run Command** relies on **SSM Agent**. AWS explicitly states that the agent runs as root on Linux and SYSTEM on Windows and that anyone authorized to send commands consequently has those privileges. AWS also publishes commands for an administrator/root user to start and manage the agent, demonstrating that it is a guest service rather than an immutable hypervisor channel. If the SSM Agent is absent/broken, Run Command fails. ([AWS Documentation](https://docs.aws.amazon.com/systems-manager/latest/userguide/ssm-agent-restrict-root-level-commands.html?utm_source=chatgpt.com)) AWS separately offers the **EC2 Serial Console**, which is independent of VPC networking and exposes the virtual serial port; on Linux AWS says you need an OS user with a password to log in normally through it. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-serial-console.html?utm_source=chatgpt.com))

**Azure Run Command** likewise explicitly says it uses the **Azure VM Agent** to execute shell scripts on Linux or PowerShell on Windows. Azure's VMAccess extension can add an SSH key, reset passwords and repair SSH configuration, but that is also an extension/agent mechanism. Microsoft documents that Linux password reset through the Azure Linux Agent requires `waagent` to be installed, running and in Ready state. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command?utm_source=chatgpt.com))

**Google Compute Engine startup scripts** rely on Google's **guest environment** being installed and running. Linux startup scripts run as root; Windows is also supported through its guest environment. Google's current guest-agent architecture switched to its plugin design starting at version **20250901.00**, and Google documents a configuration option that can set metadata startup-script execution to `false`. So a tenant administrator can deliberately disable this management path. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/instances/startup-scripts?utm_source=chatgpt.com))

The industry pattern is therefore consistent: **agents for convenient normal operations; console/disk/boot/rebuild primitives for recovery.**

## What I would build

For the migration path you described, I would define two separate management tiers.

The **normal management tier** should use your own privileged guest agent over a host-local transport when you own the hypervisor—preferably virtio-serial or vsock—with a narrowly authenticated RPC API. Give it capabilities such as “install/update management key,” “atomic file write,” “restart service,” “collect diagnostics,” and optionally arbitrary execution under a separately protected permission. QGA is also viable, especially under Proxmox, but a purpose-built protocol lets you expose much less than raw `guest-exec`.

The **recovery tier** should never depend on that agent. It should consist of hard power control, virtual console, controlled alternate/rescue boot, snapshot-before-repair, isolated offline disk manipulation, and destructive rebuild as the final fallback. On Hetzner, Rescue + VNC + rebuild/snapshot are already the closest equivalent. On your own hosts, reproduce those semantics in your orchestration/storage layer rather than trying to make a guest daemon “undeletable.”

A useful contractual guarantee is therefore not “we can always get root back.” It is:

> **If the system disk is accessible to the platform and not protected by tenant-only encryption, the operator can perform offline recovery or modification independent of the installed guest OS. If the disk is inaccessible or cryptographically opaque, the operator can still replace/rebuild the VM but cannot guarantee preservation of tenant data.**

That is a guarantee your architecture can actually enforce.

For version clarity, the software-specific claims above are pinned to **hcloud-python 2.24.0**, **QEMU 10.0.3 guest-agent protocol**, **libvirt 12.7.0**, **Proxmox VE 9.2 / QEMU 11.0**, **cloud-init 26.2**, **Firecracker 1.17.0**, **Cloud Hypervisor 53.0**, and **libguestfs 1.60.0**. AWS/Azure/GCP features are managed services without a single platform release number; I cited their current official documentation as of September 14, 2026, and explicit guest-agent versions where the provider publishes them.
