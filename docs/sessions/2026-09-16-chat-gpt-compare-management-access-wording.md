# Compare management access wording

Source: https://chatgpt.com/share/6aab164d-1aa8-83eb-b0e0-cec80684d0c2

---

## Turn 1: User

_2026-09-16T22:14:56.151Z_

A hosting product gives customers root on a virtual machine and manages it over SSH with a key it installed. Survey what comparable products surface to customers when their own management access is broken but the machine is fine: the wording used, whether the customer is told at all, whether an action is offered, and how the distinction between "your server is down" and "we cannot reach your server" is communicated. Cover managed-server panels and cloud consoles. Report where the wording is criticised as misleading.

---

## Turn 2: ChatGPT

_2026-09-16T22:14:56.716Z_

I’ll separate products that actively manage the guest over SSH/agent from cloud consoles that only know hypervisor state. I’ll look for exact UI/docs wording, fallback actions, and complaints where “offline/down” actually meant “our control plane can’t get in.”

---

## Turn 3: ChatGPT

_2026-09-16T22:15:33.110Z_

A useful pattern is already emerging: cloud providers usually preserve a “Running”/power-state label and treat SSH failure as a separate connection problem; server-management panels are more likely to collapse their control-channel failure into an “unreachable/offline/down” server state. I’m checking whether users have explicitly objected to that wording, rather than inferring criticism myself.

---

## Turn 4: ChatGPT

_2026-09-16T22:16:17.342Z_

The strongest examples now split into three UX patterns: **“Not connected”** (precise control-plane wording), **“Server unreachable/offline”** (ambiguous and prone to false alarms), and **cloud-style dual state** where the VM remains “Running” while SSH/agent access is shown separately. I also found concrete false-positive complaints for Ploi and Coolify, not just hypothetical concerns.

---

## Turn 5: ChatGPT

_2026-09-16T22:17:41.471Z_

I found a fairly sharp divide. **Managed-server panels tend to promote loss of their SSH/agent control channel into a customer-visible server state**; some use language broad enough to imply the machine itself is down. **Cloud consoles generally keep VM power/host health separate from guest access**, and only report the SSH/agent problem when the customer tries to connect or inspects a separate status field.

I checked current documentation and product material as of **16 September 2026**, using user reports/issues mainly to establish where wording has produced false positives or been called misleading.

### Managed-server panels

| Product | What the customer sees | Told automatically? | Action offered | Does it distinguish “server down” from “we can’t manage it”? |
|---|---|---|---|---|
| **Ploi** | **“Server Unreachable.”** Its new unreachable-server page shows the last SSH error, allowlist IPs, and, notably, **“how long it has been down.”** Its debugger separately tests DNS → TCP → SSH banner → actual key login. Ploi manages servers through a root SSH key it installs, making this especially close to your case. ([Ploi](https://ploi.io/news/the-server-import-update)) | **Yes**, visibly on the server page; Ploi also has server monitoring notifications. | Connection debugger; inspect last SSH error and Ploi IPs to allow through firewall. | **Only partially.** The diagnostics are precise, but the headline “Server Unreachable” and especially “how long it has been down” turn an SSH-management failure into language about server availability. |
| **Coolify** | **“Server Unreachable”** notification when Coolify cannot reach a server after two consecutive checks. Coolify manages remote servers through SSH and describes successful validation as the server being **“reachable and validated.”** ([Coolify](https://coolify.io/docs/core/notifications/events?utm_source=chatgpt.com)) | **Yes, optionally via notifications**: email, Slack, Discord, Telegram, Pushover or webhook can carry the event. ([Coolify](https://coolify.io/docs/core/notifications/events?utm_source=chatgpt.com)) | Re-run server validation; inspect/change IP, SSH user, port, private key and connection timeout. ([Coolify](https://coolify.io/docs/core/infrastructure/servers/manage-server?utm_source=chatgpt.com)) | **Weak distinction.** “Unreachable” is being derived from the management SSH check, not an independent service or VM-health probe. |
| **Laravel Forge** | A user-captured Forge message says **“Server Disconnected”**, followed by the much better explanation: **“We had trouble connecting to your server”** and then points specifically to SSH keys/root authentication. ([Laracasts](https://laracasts.com/discuss/channels/laravel/laravel-forge-server-disconnected)) | **Yes**, when Forge loses its connection; exact present-day UI wording is not documented publicly enough for me to confirm that the old wording is unchanged. | Forge has current API flows to **revoke access**, **reconnect**—which returns a public key for the customer to install—and then **reactivate** the server. ([Laravel](https://forge.laravel.com/api-documentation?utm_source=chatgpt.com)) | **Better than Ploi/Coolify.** “Server Disconnected” is still broad, but the explanatory sentence immediately makes the subject Forge's connection rather than server uptime. |
| **ServerPilot** | **“Not connected.”** Its documentation explicitly defines that as the server **not initiating connections to ServerPilot**. ServerPilot's management channel is an outbound agent connection rather than ongoing inbound SSH. ([ServerPilot](https://serverpilot.io/docs/guides/troubleshooting/server-not-connected/)) | **Yes**, as a connection state in ServerPilot. | Docs recommend checking monitoring and, as their first recovery step, rebooting at the cloud provider; then contact support if it remains disconnected. ([ServerPilot](https://serverpilot.io/docs/guides/troubleshooting/server-not-connected/)) | **Good wording, less-good diagnosis.** “Not connected” correctly describes the known fact. The cause might still be a truly dead server, DNS, firewall, overload, OOM or full disk, and ServerPilot doesn't claim to know which from the connection state alone. |
| **RunCloud** | RunCloud's current architecture uses a management agent on TCP 34210; SSH can actually be closed after initial connection. Public docs document component-specific warnings such as **“Server not running latest agent”**, rather than clearly documenting a single full-disconnect status label. ([RunCloud Website](https://runcloud.io/docs/getting-started?utm_source=chatgpt.com)) | It surfaces agent/health warnings and configurable notifications, but I did **not** find authoritative current documentation giving the exact UI label for total agent-channel loss. | Repair firewall/agent connectivity; RunCloud publishes the management IPs that must be allowed and provides agent-oriented troubleshooting. ([RunCloud Website](https://runcloud.io/docs/whitelist-runcloud-ip-addresses?utm_source=chatgpt.com)) | Public documentation is **not clear enough to establish the wording** used for the exact failure in your scenario. I would not infer “offline” from screenshots or old reports without stronger evidence. |

The two closest analogues to your SSH-key model are therefore **Ploi and Coolify**. They also provide the clearest warning about a UX trap: they call the *server* unreachable even though their actual observation is that a particular management SSH attempt failed.

### Cloud consoles

| Console | What happens if VM is fine but SSH/guest management is broken? | Told automatically? | Recovery action | How the distinction is communicated |
|---|---|---|---|---|
| **Google Compute Engine** | When SSH is attempted, the console can say **“Connection Failed — We are unable to connect to the VM on port 22.”** Causes documented include sshd, firewall, port configuration, keys and disk problems. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/troubleshooting/troubleshooting-ssh-errors?authuser=7)) | Usually **on attempted connection**, rather than turning the VM itself into “down.” | SSH troubleshooting and root access through the serial console. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/troubleshooting/troubleshooting-ssh-errors?authuser=7)) | **Very explicit:** the thing that failed is a connection to port 22. It does not assert that the VM stopped. |
| **AWS EC2** | EC2's normal VM status remains based on **system/instance checks**, not whether your SSH key works. Instance checks test guest/network health using an ARP request to the NIC; an instance can therefore be `running`/status-check OK while SSH authentication is unusable. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html)) | **No automatic “SSH broken” state** from ordinary EC2 health checks. | EC2 Serial Console provides an out-of-band recovery path; CloudWatch alarms can separately alert on actual EC2 status-check failures. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html)) | **Strong layer separation:** infrastructure health, instance health and application health are explicitly distinct concepts. SSH credentials are another layer again. |
| **Azure VM** | Azure exposes a separate **Guest Agent status: `Ready` / `Not ready`**. A VM can be running while its agent is `Not ready`; Microsoft's troubleshooting material explicitly treats “is the VM started?” and “is the Guest Agent ready?” as separate checks. ([Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/windows/windows-azure-guest-agent?utm_source=chatgpt.com)) | **Yes** for agent failure, independently of VM power state. | Troubleshoot/reinstall the guest agent; serial/offline repair paths exist where ordinary management is unavailable. | **Excellent state separation conceptually:** e.g. `powerState: VM running` + `agentStatus: Not Ready` means exactly “VM is running but agent is unhealthy.” ([Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/azure/bastion/troubleshoot-session-fails-target-vm-unhealthy?utm_source=chatgpt.com)) |
| **DigitalOcean Droplets** | Droplet state is infrastructure/power-oriented (`active`, `off`, etc.); failure of sshd or networking does not itself mean the Droplet becomes “off.” | Generally **no proactive SSH-health warning** from the ordinary Droplet state. | **Recovery Console**, which DigitalOcean explicitly says remains available even if the Droplet loses network access or `sshd` fails. ([DigitalOcean](https://docs.digitalocean.com/products/droplets/how-to/recovery/recovery-console/)) | Distinction is architectural: an `active` machine and its ability to accept SSH are separate things; an out-of-band console handles the latter. |
| **Hetzner Cloud** | A normal SSH failure isn't represented as the server itself being down. Hetzner tells users who cannot log in that console access remains available. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/)) | **Not as a generic management-channel alarm.** | Browser/VNC Console; Rescue System for access/key recovery. | Again, **power state and access method are separate**. The console is explicitly the fallback when normal login/networking is wrong. |
| **Akamai/Linode** | Cloud Manager can still list a Linode as **running** while SSH/network access is unavailable. Its Lish console is specifically intended to work independently of normal network/SSH access. ([Akamai TechDocs](https://techdocs.akamai.com/cloud-computing/docs/access-your-system-console-using-lish?utm_source=chatgpt.com)) | Usually **no generic “SSH down” server state**. | Launch Lish, inspect networking/sshd/firewall from the console. | Clear conceptual separation: “running” is a VM state; “can I SSH into it?” is a different question. |

### Where the wording has actually caused trouble

There are two unusually good real-world false-positive cases.

In **Coolify**, a June 2026 bug report is almost exactly your failure mode: users received **“Server unreachable”** notifications for VPSs that were in fact reachable; manual SSH from the Coolify server worked, and the remote authentication logs showed accepted SSH connections. The reporter traced the problem to Coolify's periodic SSH connection check timing out intermittently. ([GitHub](https://github.com/coollabsio/coolify/issues/10732)) That makes “Server unreachable” materially broader than what the check has established.

**Ploi** has an even cleaner semantic counterexample. A July 2026 roadmap report says Ploi showed **“Server Unreachable”** because its health check still authenticated as `root`, while deployments, terminal functionality and the Connection Debugger could successfully authenticate as the `ploi` management user. In other words, the server was reachable and Ploi itself could perform management operations, but one particular probe failed. ([Ploi Roadmap](https://roadmap.ploi.io/projects/1-server-level-requests/items/1550-allow-server-health-checks-to-authenticate-as-the-ploi-user-instead-of-root)) Ploi's very recent product copy compounds that ambiguity by saying the unreachable-server page shows **“how long it has been down”** even though the newly described debugger is measuring DNS/TCP/SSH/key-login reachability. ([Ploi](https://ploi.io/news/the-server-import-update))

Azure has a related, though not identical, terminology complaint. A Microsoft Q&A moderator explains that an intentionally agentless VM will still get **“Virtual machine agent status is not ready”**, while another portal field may **“misleadingly”** display the VM Agent as **“Provisioned.”** That is a status-consistency problem rather than conflating the whole VM with agent reachability, but it illustrates why naming the *component* matters. ([Microsoft Learn](https://learn.microsoft.com/en-us/answers/questions/5490504/cant-make-the-error-message-go-away-virtual-machin))

### The product-design pattern this points to

For a product whose actual evidence is “our installed key can no longer SSH as root,” the cloud-console model is considerably more precise than a single red **Server down/offline/unreachable** badge. The observable fact is **management connectivity**, not host availability.

A clean presentation would keep two independent states visible:

**VM / server state:** `Running`, `Stopped`, or `Unknown` — only claim this if you have a provider API, hypervisor signal, external service probe, or equivalent evidence.

**Management access:** `Connected` or **`SSH management connection lost`**. Supporting copy could say: *“We can’t currently connect to this server over SSH using our management key. Your server may still be running and serving traffic.”*

Then expose **last successful management connection**, **last error** (`timeout`, `connection refused`, `host key changed`, `permission denied (publickey)`), and the stage that failed. Ploi's DNS → TCP → SSH banner → key-login debugger is a particularly useful diagnostic decomposition, even though its top-level wording is less precise. ([Ploi](https://ploi.io/news/the-server-import-update))

For actions, the least-destructive primary choices suggested by the survey are **Test connection**, **View diagnostics**, and **Repair/reinstall management key**. An out-of-band console or provider-console link is the natural next escape hatch. A reboot should not be the leading action merely because the management SSH probe failed: several cloud consoles deliberately preserve the distinction precisely because a perfectly healthy workload can coexist with broken SSH authentication.

So the core wording lesson is: **“We cannot reach/manage your server” describes evidence; “your server is down” describes a conclusion.** The products getting into trouble are the ones that turn the former into the latter without an independent host/service-health signal.

---

If you want, I can:

- Suggest precise UI wording for SSH management loss vs server down distinction
- Outline recovery action flows for addressing SSH key management failures
- Compare pros and cons of managed-server panels versus cloud consoles handling SSH loss
