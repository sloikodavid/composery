# Designing Collaborator Permissions

Source: https://chatgpt.com/share/6aa8b144-9aa0-83eb-ae86-6348d75c5e50

---

## Turn 1: User

_2026-09-15T02:39:50.901Z_

Context: A web control panel lets several people collaborate on one Linux server. The panel can start and stop the machine, rename and delete it, manage who collaborates, and edit the SSH authorized_keys files on the machine. Anyone whose key is authorized can sign in and change those same files directly, with no panel involved. Customers are a mix of non-technical people and experts.

Question: How should collaborator permissions be designed for a system in which some actions are enforceable by the control plane and others can be undone by anyone who can sign in to the machine?

Cover: which permission boundaries are enforceable and which are only conventions; how existing products draw this line (server management panels, infrastructure consoles, access proxies, and team-based SSH products); whether a permission that can be bypassed is still worth having and how such products describe it; ordered permission levels compared with independent flags; permissions that imply others, and the failure modes of automatic dependencies; how removal of a person is handled when their access no longer depends on the product; and how these systems word what a permission does and does not guarantee.

Give examples of wording and models that were later found misleading, and what replaced them.

Evidence rules: cite product documentation and, where available, source, with dates. Separate evidence from opinion. State which designs are common because they are correct and which are common because they are easy.

---

## Turn 2: ChatGPT

_2026-09-15T02:39:50.996Z_

I’ll treat this as a product-design research question rather than just an RBAC taxonomy. I’ll compare several product families, distinguish hard enforcement from advisory UX, and call out where historical models changed because the old abstraction did not match the underlying access path.

---

## Turn 3: ChatGPT

_2026-09-15T02:40:27.407Z_

A useful pattern is already emerging: products that truly want revocation to mean “cannot SSH anymore” move authentication into a path they mediate on every connection (OS Login, SSH CAs, proxies). Products that merely copy keys into `authorized_keys` generally describe their control as provisioning or dashboard access—not as an irrevocable security boundary.

---

## Turn 4: ChatGPT

_2026-09-15T02:41:34.755Z_

There is also a concrete warning sign in server-panel documentation: RunCloud says removing a person from a team revokes access to associated workspace resources “in one step,” yet its separate offboarding guide tells administrators to delete that person’s SSH key from every server/user account. That is exactly the scope distinction your product should make explicit.

---

## Turn 5: ChatGPT

_2026-09-15T02:41:48.859Z_

The cleanest design is to treat collaborator permissions as **authorizations over specific control paths**, not as promises about the eventual state of the Linux machine. If somebody has sufficient privilege inside the guest, many guest-level restrictions cease to be security boundaries.

The important distinction is therefore not “read vs write” or even “admin vs user.” It is **control-plane authority, mediated machine access, and mutable guest state**.

## Evidence from existing products

I checked the cited documentation on 15 September 2026. Where vendors publish a “last updated/verified” date, I include it below.

| Product/family | What the product actually controls | What it does **not** necessarily control |
|---|---|---|
| **DigitalOcean Teams** | Control-plane resources use roles and fine-grained permissions. DigitalOcean now has six predefined roles plus custom roles. Its custom-role model explicitly distinguishes **required permissions** from merely **associated permissions**; e.g. non-read actions generally require the corresponding read action. Docs verified Jul/Aug 2026. ([DigitalOcean](https://docs.digitalocean.com/platform/teams/roles/predefined/?utm_source=chatgpt.com)) | DigitalOcean team SSH keys are primarily provisioning inputs. Its docs explicitly say uploading/importing a key does not add it to existing Droplets, and keys on an existing Droplet are managed from inside the machine rather than by deleting the team-side object. ([DigitalOcean](https://docs.digitalocean.com/products/droplets/how-to/add-ssh-keys/to-existing-droplet/?utm_source=chatgpt.com)) |
| **RunCloud** | Workspace teams select **which resources** a user sees; roles select **what actions** they can perform. Docs last updated 1 Aug 2025. ([RunCloud Website](https://runcloud.io/docs/create-and-manage-workspace-roles?utm_source=chatgpt.com)) | Its SSH-key UI installs/removes keys on the actual server. RunCloud separately documents deleting a departing person's key from every system user on every server. That is materially different from merely removing the person from a RunCloud team. ([RunCloud Website](https://runcloud.io/docs/deleting-ssh-key-runcloud-api?utm_source=chatgpt.com)) |
| **Ploi** | Granular per-user/per-server/per-site permissions cover panel operations including SSH-related functions. Current team docs were created/updated in 2026. ([Ploi](https://ploi.io/documentation/introduction/how-do-teams-and-permissions-work?utm_source=chatgpt.com)) | The underlying system remains a normal Linux server. Ploi's own documentation discusses changing `sshd_config` directly and adding SSH keys from inside the machine; Ploi itself depends on root SSH for some management. ([Ploi](https://ploi.io/documentation/ssh/disable-public-key-authentication-in-ssh?utm_source=chatgpt.com)) |
| **AWS EC2** | IAM can enforce whether a principal may use EC2 Instance Connect. The key supplied through Instance Connect exists in instance metadata for only 60 seconds and requires `SendSSHPublicKey`. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-tutorial.html?utm_source=chatgpt.com)) | Ordinary EC2 key pairs illustrate the opposite model: AWS explicitly warns that deleting a key pair in EC2 **does not remove the key from any instance**; the holder of the private key can still connect. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/delete-key-pair.html?utm_source=chatgpt.com)) |
| **Google Compute Engine** | OS Login moves SSH authorization into IAM and evaluates authorization on every connection. Google recommends it specifically for reliable revocation. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/login-access?utm_source=chatgpt.com)) | Metadata SSH keys are evaluated only when uploaded; suspending/deleting the user does not invalidate them. Google calls out persistence risk, especially with root access. Even with OS Login, local accounts can still have `authorized_keys`, so root privilege remains a persistence problem. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/login-access?utm_source=chatgpt.com)) |
| **Azure** | Azure deliberately separates VM control from VM login. An Owner or Contributor does **not** automatically get Microsoft Entra SSH login; separate VM User Login / VM Administrator Login roles use data-plane permissions. ([Microsoft Learn](https://learn.microsoft.com/sr-cyrl-rs/entra/identity/devices/howto-vm-sign-in-azure-ad-linux?utm_source=chatgpt.com)) | Normal Linux SSH keys remain Linux credentials unless Entra certificate-based login is adopted. Azure promotes Entra login partly to avoid stale public-key sprawl. ([Microsoft Learn](https://learn.microsoft.com/sr-cyrl-rs/entra/identity/devices/howto-vm-sign-in-azure-ad-linux?utm_source=chatgpt.com)) |
| **Tailscale SSH** | Tailscale can mediate authentication/authorization for SSH arriving over the tailnet. Current docs require both network access and an SSH-specific rule. ([Tailscale](https://tailscale.com/docs/features/tailscale-ssh?utm_source=chatgpt.com)) | Tailscale explicitly says it does **not** alter `sshd_config` or `authorized_keys`; ordinary SSH arriving by another route continues to work. Thus “denied by Tailscale SSH” is not equivalent to “cannot SSH to this box.” ([Tailscale](https://tailscale.com/docs/features/tailscale-ssh?utm_source=chatgpt.com)) |
| **Teleport** | Teleport roles control allowed nodes and Unix logins, can issue short-lived access, and Enterprise identity locks can reject new requests **and terminate active connections**. ([Teleport](https://goteleport.com/docs/zero-trust-access/rbac-get-started/users/?utm_source=chatgpt.com)) | Teleport explicitly warns that a privileged/root user can manipulate Teleport agents/configuration and potentially bypass authorization or auditing. That is unusually clear documentation of the trust boundary. ([Teleport](https://goteleport.com/docs/zero-trust-access/management/security/restrict-privileges/?utm_source=chatgpt.com)) |
| **Boundary** | With SSH credential injection, the user never possesses the target credential. Authorization is checked before a session; deleting related users/credentials/resources can cancel sessions, and session cancellation revokes associated credentials. ([HashiCorp Developer](https://developer.hashicorp.com/boundary/docs/concepts/credential-management?utm_source=chatgpt.com)) | Its weaker “credential brokering” mode hands credentials to the user; after that the credential itself becomes another access path. Boundary documents injection as the more secure model. ([HashiCorp Developer](https://developer.hashicorp.com/boundary/docs/concepts/credential-management?utm_source=chatgpt.com)) |
| **StrongDM** | StrongDM separates **permission level**—administration of the StrongDM organization—from **roles**, which determine resource access. Suspension is described as revoking infrastructure access; temporary grants can automatically close active connections when they expire. ([StrongDM](https://www.strongdm.com/docs/admin/users/?utm_source=chatgpt.com)) | This guarantee applies to access that actually flows through StrongDM. A separately provisioned host credential would be outside that authorization path. |
| **Cloudflare Access for Infrastructure** | Current SSH product uses short-lived SSH certificates, per-target/per-Unix-user policy and command logging. Docs updated 9 Sep 2026. ([Cloudflare Docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/ssh/ssh-infrastructure-access/?utm_source=chatgpt.com)) | The server still ultimately trusts an SSH CA, and Cloudflare notes that target Unix users already have to exist. Any separate directly reachable SSH authentication path remains conceptually separate. |
| **Termius** | Team vault permissions govern who can access shared host information and credentials. ([Termius](https://termius.com/?utm_source=chatgpt.com)) | It is fundamentally credential sharing/storage rather than an authoritative server-side login gate. Its newer SSH ID deliberately uses ordinary `authorized_keys`, and recommends external automation to update those files. ([Termius](https://termius.com/blog/ssh-id-passkeys-for-ssh?utm_source=chatgpt.com)) |

Two recurring architecture patterns are visible. Infrastructure consoles generally distinguish **cloud/control-plane authority from guest access**; access products get stronger revocation semantics by putting themselves **in the connection path** or issuing short-lived credentials. Server-management panels commonly manipulate normal Linux state and therefore cannot make the same guarantee.

## Which boundaries are real in your system

For the system in the question, I would describe permissions approximately this way:

| Permission | Security character |
|---|---|
| **View server / panel metadata** | Hard control-plane boundary. |
| **Rename server in the panel** | Hard if it means the panel's resource name. If it means Linux `hostname`, it becomes mutable guest state. |
| **Start server** | Hard control-plane authorization: a guest user cannot start a powered-off VM through your service without the corresponding control-plane authority. |
| **Stop/reboot server** | Hard as an authorization to use the panel action, but **not** an exclusive power-state boundary if a privileged Linux user can run `shutdown` or `reboot`. |
| **Delete server resource** | Hard control-plane boundary. But it must not be described as the only “destructive” capability: root SSH can erase the filesystem or destroy the workload without possessing this permission. |
| **Manage panel collaborators** | Hard for membership in your control plane. |
| **Remove collaborator** | Hard for panel membership; not necessarily hard for SSH access already materialized on the guest. |
| **Add/remove SSH key using panel** | Hard as an authorization to invoke your key-management function; **not** an exclusive authority over `authorized_keys`. |
| **SSH access using a static key you installed** | The panel can provision it. It cannot reliably revoke it if the user could have copied it, added another key/account, modified `sshd`, or installed another persistence mechanism. |
| **SSH access through a mandatory proxy/CA that cannot be bypassed** | Can become a real authorization boundary for new connections. Active connections and privileged tampering still require explicit treatment. |

That distinction matters particularly for **Delete**. A UI that says “Alice cannot delete this server” may be technically true and operationally misleading if Alice has root and can run `rm -rf`, overwrite the filesystem, exfiltrate secrets, or make the system unbootable. The real statement is “Alice cannot invoke the control-plane delete operation.”

## Ordered levels versus independent permissions

A single ladder such as:

> Viewer → Operator → Manager → Administrator → Owner

is attractive for non-technical customers, but it is not a faithful model of your authority structure.

Azure provides a good counterexample: controlling the VM and logging into the VM are intentionally separate. StrongDM similarly separates administrative “permission level” from resource-access roles. ([Microsoft Learn](https://learn.microsoft.com/sr-cyrl-rs/entra/identity/devices/howto-vm-sign-in-azure-ad-linux?utm_source=chatgpt.com)) Google recommends combining multiple narrow predefined roles rather than assuming one giant role should contain every kind of authority, and specifically discourages its old broad Owner/Editor/Viewer basic roles for production. ([Google Cloud Documentation](https://docs.cloud.google.com/iam/docs/choose-predefined-roles?utm_source=chatgpt.com))

My recommendation is therefore:

**Store independent capabilities internally, present sensible bundles externally.**

For example, the product might offer easy presets called **Viewer**, **Operator**, **Server manager**, and **Owner**, but the actual permission set should contain separate capabilities for power operations, metadata changes, deletion, collaborator administration, panel SSH-key management and perhaps mediated SSH access.

SSH access should not simply be “the next rung above Operator.” Nor should “manage collaborators” naturally sit above “delete.” They are different kinds of authority.

This gives non-technical users a simple default experience while letting experts inspect and customize the exact permissions. It is also how many mature systems evolve: broad roles for convenience, granular policy underneath.

## Permissions that imply other permissions

Some implications are genuine. If an interface lets somebody modify an object, the implementation often needs to let them read enough of the object to modify it safely.

DigitalOcean makes a useful distinction here. Its custom-role editor labels one set as **Required Permissions** and another as **Associated Permissions**. For example, selecting a non-read permission can automatically require the corresponding read permission, while related actions such as tagging are suggestions rather than hidden prerequisites. ([DigitalOcean](https://docs.digitalocean.com/platform/teams/roles/permissions/ssh_key/create/?utm_source=chatgpt.com)) Google makes a similar implementation observation: setting an IAM policy practically requires reading the current policy first. ([Google Cloud Documentation](https://docs.cloud.google.com/iam/docs/roles-overview?utm_source=chatgpt.com))

That is the right pattern.

Do **not** make every conceptual implication an automatic authorization implication. “Can add SSH keys” does not logically require “can remove other people's SSH keys.” “Can manage collaborators” should not silently mean “can grant any permission whatsoever.” “Can reboot” does not require “can delete.” And “can SSH” certainly should not cause the UI to grant unrelated control-plane administration simply because root could achieve similar effects from inside Linux.

Automatic dependencies fail in three ways. They cause privilege explosions as dependencies become transitive; they create silent permission drift when the product grows; and they produce apparent security distinctions that aren't real. DigitalOcean and Google both document another important trade-off: vendor-managed/predefined roles can gain new permissions automatically as products evolve, while custom roles remain fixed. ([DigitalOcean](https://docs.digitalocean.com/platform/teams/roles/custom/?utm_source=chatgpt.com))

That behavior is convenient, but for a high-assurance custom role, **silently gaining a future destructive capability is usually the wrong behavior**.

## Is a bypassable permission still worth having?

Yes—provided you name its scope correctly.

There is substantial value in preventing accidental or routine use of an action even when a sufficiently privileged server administrator could reproduce its effect another way. Unix itself contains many such layers. A control panel is also a workflow, audit and safety surface, not merely a cryptographic reference monitor.

For example, “cannot delete the server from the dashboard” is worthwhile even though root can trash the workload. It prevents accidental cloud-resource deletion, preserves auditability, may preserve billing/backup relationships, and stops a person from invoking that particular irreversible control-plane operation.

Likewise, “cannot modify SSH keys **through the panel**” can be useful. It lets an organization say that junior operators should not normally administer team SSH access. What it must not say is “cannot change who can SSH to this server.”

Products tend to handle this in one of three ways:

**Good wording scopes the verb to the product.** AWS now says deleting an EC2 key pair removes the public key “stored in Amazon EC2” and explicitly warns that it does not remove the key from instances. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/delete-key-pair.html?utm_source=chatgpt.com))

**Stronger products change the architecture so the claim becomes enforceable.** Google recommends OS Login instead of metadata-based static keys precisely because IAM can then be checked on each login. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/login-access?utm_source=chatgpt.com)) Cloudflare, Teleport, Boundary and StrongDM similarly rely on short-lived identity, proxying or credential injection. ([Cloudflare Docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/ssh/ssh-infrastructure-access/?utm_source=chatgpt.com))

**Weaker products sometimes overgeneralize panel permissions.** RunCloud says removing a user from a team “revokes their access to all associated resources in one step,” but its own separate SSH offboarding document instructs customers to remove the person's key from all server accounts. Read literally, the first sentence is too broad; it is accurate only for RunCloud-mediated/workspace access. ([runcloud.io](https://runcloud.io/docs/create-and-manage-workspace-teams?utm_source=chatgpt.com))

## Offboarding when the machine has escaped the product's authority

“Remove collaborator” should be modeled as a multi-part operation, not one Boolean transition.

When Bob is removed, the system can make **panel revocation immediate and authoritative**. Bob should immediately lose control-plane API/UI access.

It should then perform a **guest-access reconciliation**: remove every Bob key the product knows it installed, from every account it knows it installed it into; revoke product-issued certificates/tokens; remove product-managed local accounts where appropriate; and, if your architecture lets you do so, terminate product-mediated active sessions.

But the resulting status should distinguish:

> **Control-panel access revoked**

from

> **Managed SSH credentials removed**

from

> **No remaining direct machine access**

The last statement cannot generally be proved in your present architecture.

AWS's key-pair warning and Google's metadata-key guidance demonstrate why. A credential already copied into the machine has its own lifecycle. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/delete-key-pair.html?utm_source=chatgpt.com)) Google goes further and warns that privileged users can create accounts or backdoors to retain access. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/login-access?utm_source=chatgpt.com)) Teleport similarly warns that root can modify the access-control agent/configuration itself. ([Teleport](https://goteleport.com/docs/zero-trust-access/management/security/restrict-privileges/?utm_source=chatgpt.com))

An offline machine creates another state: **revocation pending**. Do not report success merely because your database says Bob is gone if the machine has not acknowledged key removal.

For serious offboarding after somebody had root, the truthful high-assurance remedies are credential rotation, removal of all alternate authentication paths, verification of local accounts/configuration, or ultimately rebuilding from a trusted image. Removing one known public key is not proof that root access has been extinguished.

Existing mediated products show what stronger semantics look like. Boundary automatically cancels sessions when related resources are removed and revokes session credentials; Teleport identity locks terminate matching active connections; StrongDM says temporary grants close active connections on expiry. ([HashiCorp Developer](https://developer.hashicorp.com/boundary/docs/targets/sessions/cancel-sessions?utm_source=chatgpt.com))

## Wording I would use

For a mixed technical/non-technical audience, the shortest safe wording is to state both the capability and its boundary.

**Manage SSH keys**

> Add or remove SSH keys through this control panel.  
> People with sufficient access to the server can also change SSH keys directly on the server.

**SSH access**

> Connect to the server using SSH access managed by this panel.  
> This does not block credentials, accounts, or SSH access configured directly on the server.

If you do not actually mediate the connection, I would avoid a naked permission named simply **“SSH access.”** “Install my SSH key” or “Panel-managed SSH access” is more accurate.

**Remove collaborator**

> Removes this person's access to the control panel immediately. We also remove SSH keys previously installed for them where possible. Access created directly on the server, shared credentials, and existing server sessions may remain.

**Delete server**

> Permanently delete this server from the account.  
> A server administrator may still modify or erase data from inside the server without this permission.

**Rename**

> Change the server's name in the control panel.

If it also touches `/etc/hostname`, say that separately.

**Start and stop**

> Power the server on or off from the control panel.  
> Server administrators may also reboot or shut down Linux from inside the server.

Those second sentences are not legalistic caveats. They define the actual security boundary.

## Models and wording that changed

There are several instructive examples.

In January 2025, a Tailscale user filed an issue specifically saying the new **Grants** documentation appeared to imply that Grants replaced both ACL and SSH rules; removing the `ssh` section caused Tailscale SSH to stop working. The reporter called the wording “wrong/misleading.” By 10 June 2025 they closed the issue because the documentation had been clarified. Current documentation explicitly says a Tailscale SSH connection requires **both** a network access rule and an SSH access rule. ([GitHub](https://github.com/tailscale/tailscale/issues/14694?utm_source=chatgpt.com))

Tailscale also retains legacy ACL fields named `users` and `ports`, but now recommends `src` and `dst`; the current source still supports either pair. That is a good example of terminology becoming too narrow as the authorization model expanded beyond literal users and ports. This is my interpretation of the naming change, not an official Tailscale statement about why it changed. ([Tailscale](https://tailscale.com/kb/1337/policy-syntax?utm_source=chatgpt.com))

Google's older/default **metadata SSH key** model is an architectural example rather than a wording correction. Current security guidance explicitly explains that metadata-key authorization is evaluated only when the key is uploaded and that deleting the employee's identity does not revoke it. Google recommends **OS Login**, where IAM is evaluated at every login, specifically to avoid that persistence problem. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/login-access?utm_source=chatgpt.com))

Cloudflare now labels its older SSH short-lived-certificate workflow **legacy** and says it is not recommended for new deployments; its replacement is Access for Infrastructure, with target/user policies and more integrated control and logging. The legacy page was updated 24 Aug 2026 and the replacement docs 9 Sep 2026. ([Cloudflare Docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/short-lived-certificates-legacy/?utm_source=chatgpt.com))

AWS's current “Delete your key pair” documentation is another example of how wording has to compensate for a split control plane: it explicitly says deletion affects the key stored in EC2 and **does not remove the public key from instances**. The naïve “delete key = revoke login” model is therefore rejected in the documentation itself. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/delete-key-pair.html?utm_source=chatgpt.com))

Termius shows a different evolution in collaboration modeling. Its 2019/2021 sharing model began with shared groups and later added editor rights and shared credentials; in 2023 it explicitly replaced the “shared entities” concept with **Vaults**, anticipating multiple vaults for more granular access. ([Termius](https://www.termius.com/blog/termius-for-teams-game-changer-introducing-group-sharing-2-0?utm_source=chatgpt.com)) That is mostly an information/credential-sharing boundary, not a server-side authorization boundary—an important distinction for products in this space.

## What is common because it is correct, and what is common because it is easy

Some recurring designs are common because they match the underlying security model.

Separating **resource administration from machine login** is correct. Azure does it explicitly; StrongDM has separate administrative permission levels and resource-access roles. ([Microsoft Learn](https://learn.microsoft.com/sr-cyrl-rs/entra/identity/devices/howto-vm-sign-in-azure-ad-linux?utm_source=chatgpt.com))

Using short-lived credentials or checking identity on every connection is correct when dependable revocation matters. Google OS Login, EC2 Instance Connect, Cloudflare, Boundary and Teleport all move in this direction. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/login-access?utm_source=chatgpt.com))

Treating root as a qualitatively different trust level is correct. Google and Teleport both explicitly describe persistence/bypass risks from privileged access. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/login-access?utm_source=chatgpt.com))

Conversely, several common patterns exist mainly because they are easy and understandable: copying static keys into `authorized_keys`; a single Owner/Admin/Member ladder; treating “delete key” as if key inventory were the authorization database; automatically expanding broad vendor roles when new features ship; and saying “removed from team” when what actually happened was “removed from this application's database.” Static OpenSSH keys are wonderfully interoperable and operationally simple, but that simplicity is precisely why the control plane does not retain exclusive authority over them.

## Recommended model for this product

I would make the product's conceptual model:

> **Panel permissions control what a collaborator may do through this service. Server access is a separate trust domain. Actions performed directly on the server may bypass panel permissions.**

Internally, use independent capabilities. Externally, offer simple predefined bundles for customers who do not want to think about RBAC. Mark permissions that operate purely on control-plane resources differently from permissions that merely manage guest state.

For SSH specifically, offer two clearly distinct modes if stronger access control is commercially important:

**Standard SSH / unmanaged host mode** uses ordinary `authorized_keys`. The panel provisions and cleans up known keys on a best-effort basis. The UI never promises exclusive revocation.

**Managed access mode** routes login through an identity-aware SSH proxy/CA, closes or firewalls ordinary SSH paths, uses short-lived credentials, provides session termination, and makes privileged users' ability to disable/bypass the agent an explicit trust assumption. That is the point at which a permission such as **“May SSH to this server”** can become a genuine security boundary rather than a convention.

That distinction is more important than the exact names of your roles. A beautifully granular RBAC interface cannot make a control plane authoritative over a file that the same user can edit as root.
