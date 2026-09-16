# Assess SSH Permissions Design

Source: https://chatgpt.com/share/6aa77527-42d8-83eb-8298-005f55e64edc

---

## Turn 1: User

_2026-09-14T04:08:26.074Z_

We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Assess the consequences of separate ownership and platform memberships with permission checklists, including one initial Manage SSH permission. Ownership transfer is owner-only; grantable permissions default to enabled; members may delegate only authority they hold. The previous owner remains a member after transfer. Do not treat these product choices as Linux security properties.

Define what the blanket SSH permission authorizes. Distinguish reading public entries, modifying authorizations, selecting accounts, removing restrictions, possessing a private key, and administering the OS. Analyze indirect authority: a user who can authorize an unrestricted root key, restore a disk, or access management credentials may have more power than a label suggests.

Evaluate whether any per-person key mapping is needed under live server reads and no automatic SSH deletion on membership removal. Explain what can and cannot be inferred from key comments and fingerprints. Address permission removal while an operation is queued or running, owner transfer races, invitation acceptance, and account deletion.

Return enforceable invariants and a permission-check location for each operation. Keep OS account provisioning and per-key permission delegation outside the design unless a concrete requirement makes them necessary. Identify unresolved policy choices without multiplying permission switches by default.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.

---

## Turn 2: ChatGPT

_2026-09-14T04:08:27.633Z_

I’m grounding this in the actual OpenSSH/Ubuntu behavior and the current Convex/Hetzner control surfaces, then I’ll separate protocol facts from product-policy deductions. I’ll also make the race semantics explicit rather than hiding them behind a generic “check permission” rule.

---

## Turn 3: ChatGPT

_2026-09-14T04:09:22.086Z_

One important finding already affects the model: Ubuntu 24.04 is still on the 9.6p1 codebase, and the current Noble security package is `1:9.6p1-3ubuntu13.19` (published September 3, 2026). That package specifically backports the 10.5 fix making `authorized_keys` `restrict` apply to tunnel forwarding, so “native OpenSSH restriction semantics” must be evaluated against the patched Ubuntu package, not just upstream 9.6p1.

---

## Turn 4: ChatGPT

_2026-09-14T04:13:32.304Z_

The permission label should be treated as a **capability to change who may authenticate as existing Unix accounts**, not as a promise about the resulting Unix privilege. In particular, if it can authorize an unrestricted key for `root`, it is intentionally a path to root for whoever controls that private key; hiding that consequence behind “SSH management” would be misleading.

---

## Turn 5: ChatGPT

_2026-09-14T04:14:11.092Z_

## Recommendation

Keep **ownership** and **membership permissions** separate. Use one initial grantable permission, preferably named **Manage SSH access**, with deliberately broad semantics:

> May view and explicitly change OpenSSH public-key authorizations for supported existing OS accounts on the server, including adding/removing keys and changing/removing native `authorized_keys` restrictions. It does not create OS accounts, reveal or possess private keys, execute commands merely by virtue of the platform permission, or grant Hetzner/VM rescue, rebuild, console, disk, or management-credential access.

The important qualification is that this permission can be **OS-admin-equivalent in effect**. If a holder can authorize a public key whose private half they control for `root`, or for a sufficiently privileged sudo account, and the effective `sshd` configuration permits that authentication, they can obtain those account privileges. That is not a flaw in the permission model; it is the unavoidable consequence of what the operation changes. The UI should say so explicitly.

I would **not add per-person key ownership, per-key delegation, account provisioning, persistent key inventory, or automatic key removal** under the requirements given. Live server state plus explicit edits is enough, provided writes use optimistic concurrency and you fail closed on OpenSSH states you do not safely understand.

---

# 1. Evidence baseline

These distinctions matter because “OpenSSH” is not one moving target.

| Source | Exact baseline used | Relevant fact |
|---|---|---|
| SSH protocol | **RFC 4252**, January 2006, Standards Track | Public-key authentication proves possession/control of the corresponding private key by a valid signature; the request is for a particular server-side user. ([RFC Editor](https://www.rfc-editor.org/info/rfc4252/?utm_source=chatgpt.com)) |
| OpenSSH Portable 9.6p1 | tag `V_9_6_P1`, target commit **`8241b9c0529228b4b86d88b1a6076fb9f97e4a99`**, signed tag dated **2023-12-18**  | This is the upstream codebase underlying Ubuntu Noble's `9.6p1` packaging. Its authorization parser defaults ordinary key entries to permit forwarding/PTY/etc.; `restrict` turns several of those off.  |
| Upstream/OpenBSD fix | Portable commit **`d322f2ccf7da095ce94d1d99cb563246f61487b0`**, 2026-07-21; corresponding OpenBSD commit ID `5b3cc987a64749c94b20e12755db32a83f8f01e6` | Fixed `authorized_keys` `restrict` not applying to tunnel forwarding. The source change adds `auth_opts->restricted` to the tunnel rejection condition.  |
| OpenSSH Portable 10.5p1 | tag `V_10_5_P1`, target commit **`b3f7344209832eea8ece447d871ea748767c444b`**, released **2026-08-11**  | Upstream release containing that fix. |
| Ubuntu 24.04 LTS Noble | as of **2026-09-14**, `openssh-server 1:9.6p1-3ubuntu13.19` in noble-updates | Ubuntu backported the tunnel/restrict fix rather than moving Noble to 10.5. Ubuntu lists CVE-2026-73283 fixed in `.19`; USN-8721-1 was published **2026-09-03**. ([Ubuntu](https://ubuntu.com/security/CVE-2026-73283?utm_source=chatgpt.com)) |
| OpenBSD-current | current manual retrieved 2026-09-14; **not the Ubuntu configuration** | Current defaults include `PermitRootLogin prohibit-password`, `AllowTcpForwarding yes`, `PermitTunnel no`; public-key root login is therefore not inherently prohibited by `prohibit-password`. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config)) |

Do not infer the effective configuration of a Composery Ubuntu VM merely from an upstream or distro default. `Match` rules, image customization and customer changes matter. Query the live configuration.

A further OpenSSH fact is decisive for structured controls: an `authorized_keys` entry is not merely a key. Its line has options, key type, encoded public key and comment; restrictions such as forced commands, forwarding limits, source-address conditions and `restrict` can alter what successful authentication permits. OpenSSH says the trailing comment is **not used for authentication**. ([GitHub](https://github.com/openssh/openssh-portable/blob/master/sshd.8?utm_source=chatgpt.com))

The 9.6p1 source specifically initializes ordinary key authorization with port forwarding, agent forwarding, X11 forwarding, PTY, and user RC enabled, while parsing `restrict` clears those permissions.  This makes **removing restrictions an authority-increasing modification**, not cosmetic editing.

---

# 2. What `Manage SSH access` should mean

| Capability | Included? | Consequence |
|---|---:|---|
| Read supported accounts' public authorization entries, including options/comments/fingerprints | **Yes** | A public key is not a private credential, but comments/account names are still server information. No need for a second read permission yet. |
| Add/remove a public-key authorization | **Yes** | Can grant or revoke future SSH authentication for that account. |
| Change authorization options/restrictions | **Yes** | Includes potentially privilege-increasing changes such as removing `restrict`, `command=`, `from=`, or forwarding restrictions. |
| Select among already-existing supported OS accounts | **Yes** | Account selection is part of the authorization operation, not a separate platform permission. |
| Create/delete/change Unix accounts, groups or sudo policy | **No** | That would be OS provisioning/administration, which is outside the stated requirement. |
| Possess, upload, recover or download the customer's private key | **No** | SSH authentication requires the corresponding private key to make a valid signature; the server-side public entry does not confer possession. ([RFC Editor](https://www.rfc-editor.org/info/rfc4252/?utm_source=chatgpt.com)) |
| Start a shell/execute arbitrary commands merely because the platform bit is held | **No, directly** | But the holder may first authorize a key they control, then authenticate normally. |
| Hetzner rescue/rebuild/root-password reset/console | **No** | Those are independent control-plane capabilities with stronger consequences. |
| Obtain Composery's Hetzner/management credential | **No** | Never make credential disclosure a consequence of a user permission. |

**Deduction:** if `root` is a selectable account and the effective configuration permits root public-key authentication, `Manage SSH access` lets its holder mint themselves root access by adding a public key they control. OpenSSH runs a successful session with the privileges of the selected account; its 9.6p1 manual describes changing to that user's normal privileges and running their shell/command. 

So I would use UI copy along the lines of: **“Can view and change SSH access to supported server accounts. This may allow granting full administrator/root access.”**

That is materially more accurate than implying `Manage SSH` is a low-level housekeeping permission.

---

# 3. Indirect authority is part of the threat model

The same principle applies outside SSH.

Hetzner Rescue boots a separate environment and provides root access; Hetzner documents mounting the installed disk and editing `/root/.ssh/authorized_keys` from Rescue. It also exposes rebuild, root-password reset and console functionality. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/rescue-system/?utm_source=chatgpt.com)) Its FAQ explicitly describes Rescue as giving administrative access to the server and its drives, and Rebuild as replacing server state. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))

Therefore:

**Verified fact:** the Hetzner control plane can bypass guest OpenSSH authorization state.

**Deduction:** a Composery actor who can invoke sufficiently powerful rescue/rebuild/console/disk functions has at least OS-admin-equivalent authority regardless of what their permission is named.

**Recommendation:** `Manage SSH access` must not imply those operations. If Composery later exposes them, treat them as a separate allocation/control-plane capability—or owner-only initially—rather than pretending they are a variant of SSH management.

The same dependency applies to a later self-hosted VM backend: hypervisor console, writable disk/snapshot restore, or equivalent management credentials are trust roots above guest SSH.

---

# 4. Ownership and membership model

The clean model is:

```text
platform.ownerPrincipalId = exactly one principal reference

membership(platformId, principalId) {
    permissions: { manageSsh: boolean, ...future grantable bits }
}
```

The owner does **not** derive authority from their membership checklist. Ownership should imply all current Composery platform authority plus owner-only actions such as transfer. Membership permissions govern non-owners.

For a non-owner delegation operation, enforce this algebraically:

```text
changedPermissionBits ⊆ actor.currentPermissionBits
```

That should apply to **both granting and revoking bits**. Otherwise someone lacking permission X could indirectly administer X by stripping it from another member.

“Grantable permissions default enabled” should mean **enabled from the set the delegator is currently entitled to grant**. A member without `manageSsh` must never get a default invitation that grants it.

With one permission, this is simple rather than a general RBAC system.

### Ownership transfer

Transfer should be one serializable Convex mutation that:

1. verifies the caller is still the current owner;
2. verifies the recipient is an eligible accepted principal;
3. changes `ownerPrincipalId`;
4. converts the old owner into a membership;
5. records that old owner's post-transfer permission set;
6. removes/normalizes the new owner's former membership if necessary.

Convex mutations provide consistent transactional reads and commit all writes together, so the ownership check and state transition can be atomic. ([Convex Developer Hub](https://docs.convex.dev/functions/mutation-functions?utm_source=chatgpt.com))

The unresolved product question is the **former owner's resulting checklist**. Evidence cannot determine it. Given your stated “permissions default enabled” rule, the least surprising default is all currently grantable permissions enabled, but this has a sharp consequence: after transfer the former owner still has `Manage SSH access` and can potentially grant themselves root SSH access. If that is undesirable, the transfer UI must explicitly set their post-transfer permissions in the same transaction.

Also, losing platform ownership does **not** remove any SSH key that person may already possess/use. That follows directly from your decision not to tie server authorizations to membership.

---

# 5. No per-person SSH-key mapping is required

Under the stated model, I see no authorization requirement for `key ↔ person`.

OpenSSH itself does not provide that identity binding:

- OpenSSH's `authorized_keys` comment is ignored for authentication. ([GitHub](https://github.com/openssh/openssh-portable/blob/master/sshd.8?utm_source=chatgpt.com))
- RFC 4716 likewise defines a comment as **user-specified** and even suggests `user@hostname` merely as a default convention. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4716.html?utm_source=chatgpt.com))
- A fingerprint identifies public-key material under a selected fingerprint algorithm; it does **not** prove which human owns it, whether the corresponding private key still exists, whether it is shared, or who currently controls it.
- RFC 4252 says proof of private-key possession occurs through a valid signature during authentication. Even that proves control of the private key for that authentication, not civil/person identity. ([RFC Editor](https://www.rfc-editor.org/info/rfc4252/?utm_source=chatgpt.com))

Therefore never infer:

```text
comment == platform member
fingerprint == platform member
fingerprint == one authorization entry
```

The same public key may legitimately occur for multiple accounts or multiple times with different authorization options. Consequently **fingerprint alone must not be your CRUD identity**.

For a live read, an entry can instead carry transient operational identity such as:

```text
server
OS account
authorization source/path
raw/canonical entry
public-key fingerprint
options
comment
source revision/hash
occurrence identity
```

The revision/hash matters more than a persistent key ID.

A per-person mapping becomes justified only if you later require things such as “remove all Alice's SSH access”, automatic deprovisioning on membership removal, a trustworthy “my keys” model, compliance attribution, or targeted member key rotation. Those requirements do not exist here.

Audit history can still record **“principal P requested creation/modification/removal of this entry”** without claiming that P owns the key.

---

# 6. Server-authoritative reads require conflict-safe writes

“Server state is authoritative” has one important consequence: a UI read cannot become a blind overwrite.

Use:

```text
read -> parsed state + revision/hash
edit request -> expected revision/hash
remote side -> compare expected live revision
               if mismatch: conflict, reread
               if match: apply explicit edit
```

Otherwise a customer can edit `authorized_keys` out of band between Composery's read and write and have Composery silently destroy that edit.

A second invariant is even more important for structured editing: **unknown native authorization semantics must survive round trips**. An edit to a comment must not accidentally drop an option the parser does not understand. Either preserve unsupported syntax losslessly or refuse that edit.

OpenSSH can also obtain keys from multiple `AuthorizedKeysFile` paths or an `AuthorizedKeysCommand`, and current OpenSSH documents both behaviors. ([GitHub](https://github.com/openssh/openssh-portable/blob/master/sshd_config.5?utm_source=chatgpt.com)) If Composery initially supports only the known configuration installed on its Ubuntu image, that is reasonable—but if an OS administrator changes the effective SSH configuration, Composery must detect the unsupported case and say so rather than present an incomplete list as authoritative.

This does **not** require Composery to provision accounts.

---

# 7. Authorization timing and races

Convex is a good fit if you distinguish the transaction that records intent from the action that affects the server. Mutations are transactional and cannot perform arbitrary third-party effects; Actions are the mechanism for external effects and are not transactional. Convex itself recommends having a client mutation capture intent and schedule the action. ([Convex Developer Hub](https://docs.convex.dev/functions/actions?utm_source=chatgpt.com))

The key rule is:

> **Never let enqueue-time authorization be the sole authorization for a later external effect.**

For a queued SSH write:

```text
public operation
  authenticate actor
  Convex mutation:
      read current ownership/membership
      require Manage SSH
      create job + immutable actorPrincipalId
      schedule worker atomically

worker
  immediately before remote read/write:
      reload actor/platform state
      require actor not deleted
      require current owner OR current Manage SSH
      perform one external side effect
```

For a multi-step workflow, recheck before each privilege-bearing external side effect.

There is an unavoidable distributed race after the final check: if authorization is revoked **after the worker has begun the external operation**, Convex cannot retroactively make bytes already sent to another system disappear. Therefore the enforceable semantic should be:

> Revocation prevents external effects **not yet initiated**. It does not roll back an atomic external effect already initiated.

Do not auto-undo a finished key write; that would itself be a new server mutation and could destroy subsequent customer edits.

The same rule resolves owner-transfer races: a queued owner-only operation rechecks immediately before effect. If transfer committed first, it fails. If the external effect already started first, it may complete. If the product requires “ownership transfer invalidates even an operation already in flight”, that is a materially stronger distributed-fencing requirement and should be treated as a new requirement.

---

# 8. Invitation and deletion semantics

An invitation should contain the intended permission set, but it should **not be a durable authority token**.

At creation:

```text
requestedPermissions ⊆ inviter.currentPermissions
```

At acceptance, re-check the grantor's current authority. Otherwise a member could issue a `Manage SSH` invitation, lose that permission, and have the invitation later resurrect authority they no longer hold.

I recommend failing an invite whose requested permissions are no longer grantable and requiring reissue, rather than silently accepting a reduced permission set. That is simpler to explain and audit.

For account deletion, distinguish Composery from Clerk. Clerk's current docs allow users to be deleted through the application, Dashboard, or Backend API; `user.deleted` webhooks exist, but Clerk explicitly says webhook delivery is asynchronous/eventually consistent and not suitable as the synchronous gate for a critical flow. ([Clerk](https://clerk.com/docs/guides/development/webhooks/syncing?utm_source=chatgpt.com))

Therefore:

- Composery's own account-delete operation must synchronously reject deletion while the principal owns a platform, unless ownership/platform deletion is resolved in the same controlled workflow.
- A Clerk `user.deleted` event should tombstone/disable the Composery principal and cause all future/queued-at-pre-effect operations to fail authorization.
- Do **not** automatically modify server SSH keys merely because that platform user disappeared.
- Existing ordinary SSH access remains possible if an existing server authorization and corresponding private key still work.
- An out-of-band Clerk deletion of the sole owner creates an ownership-recovery case that your application cannot prevent purely through its normal delete endpoint.

For that last case, I recommend **freeze owner-only control and require an explicit recovery/support process**, rather than automatically promoting some member. The precise recovery policy is a product decision.

Also avoid treating Clerk custom permission claims as authoritative for these checks: Clerk documents that custom session claims may be stale for roughly 60 seconds between token refreshes. Read current platform authority from Convex after authenticating the principal. ([Clerk](https://clerk.com/docs/guides/sessions/customize-session-tokens?utm_source=chatgpt.com))

For the non-browser agent, authentication may use a different Clerk-supported token mechanism; Clerk's backend authenticator currently supports API-key, OAuth-token and M2M-token forms. ([Clerk](https://clerk.com/docs/reference/backend/authenticate-request?utm_source=chatgpt.com)) Whichever mechanism you choose, it should resolve to an application actor/credential and enter the **same Composery operations and Convex authorization rules** as the UI. Do not create an “agent bypass”.

---

# 9. Enforceable invariants and check locations

| Invariant / operation | Enforcement location |
|---|---|
| Exactly one owner reference exists per platform | Convex schema/domain mutation invariant |
| Ownership itself is never a grantable permission | Central authorization helper + transfer mutation |
| Owner has implicit platform authority; member bits apply only to non-owner | Every server-side domain authorization check |
| Only current owner can transfer ownership | Transfer mutation, checked in same transaction as update |
| Former owner becomes a member atomically with transfer | Same transfer mutation |
| Non-owner may change only permission bits they currently hold | Invite/member-permission mutation, compare old/new bit delta |
| Default-enabled invitation bits never exceed delegator's current grantable bits | Invitation-creation mutation |
| Invitation cannot grant authority the inviter no longer holds at acceptance | Invitation-acceptance mutation |
| `Manage SSH` required to live-read SSH authorization state | Server-side application operation; repeat immediately before queued remote read |
| `Manage SSH` required to add/remove/edit entries, remove restrictions or select a supported target account | Intent mutation **and** worker pre-effect authorization |
| No OS account creation/deletion through the SSH operation | Server-side argument/domain validation |
| No private key accepted, stored or returned by SSH-management APIs | Request schema + client/server implementation |
| Fingerprint/comment never participates in platform authorization or person identity | Domain model; no ownership inference |
| Server writes require expected live revision/hash | Remote edit implementation |
| Unsupported/unknown key options are preserved losslessly or edit is rejected | Parser/serializer boundary |
| Permission/membership/account removal does not automatically mutate SSH server state | Membership/account mutation contains no SSH cleanup side effect |
| Queued jobs store actor identity, not an authoritative “wasAllowed=true” snapshot | Job schema + worker |
| Revoked/deleted actor cannot start a new external effect | Worker immediately pre-effect |
| `Manage SSH` cannot request Rescue/Rebuild/console/password reset or reveal provider credentials | Allocation-backend operation authorization |
| UI and non-UI callers reach the same domain operations | Public Convex/HTTP handlers delegate to shared operation/authz code |

Convex's own authorization guidance is to check authorization in public backend functions, and `ctx.auth.getUserIdentity()` is available to queries, mutations, actions and HTTP actions. ([Convex Developer Hub](https://docs.convex.dev/auth/functions-auth?utm_source=chatgpt.com)) Internal workers should use internal functions, but still validate the stored actor and current application state rather than trusting their caller merely because it is internal. ([Convex Developer Hub](https://docs.convex.dev/functions/internal-functions?utm_source=chatgpt.com))

---

# 10. Unresolved policy choices

These are real product decisions; more OpenSSH research will not answer them.

1. **Which accounts are “supported/manageable”?** If that set includes `root`, `Manage SSH` is explicitly a root-minting capability where root pubkey login is effective. If you do not want that consequence, define a server-level manageable-account boundary. I would do this before inventing another permission bit.

2. **What permissions does the old owner receive after transfer?** My default would be all currently grantable permissions enabled, consistent with your stated default, with the transfer screen making that consequence visible.

3. **What happens to stale invitations?** Recommendation: if the grantor can no longer grant every requested permission at acceptance time, reject and require reissue.

4. **What happens when the current owner is deleted outside Composery through Clerk administration/API?** Recommendation: tombstone the principal, freeze owner-only operations, and use an explicit recovery process. Do not automatically choose a successor.

5. **How far does “native OpenSSH authorization support” extend after a customer changes `AuthorizedKeysFile`, `AuthorizedKeysCommand`, certificates, or related configuration?** Recommendation for v1: detect the effective configuration and refuse unsupported cases rather than pretending your view is complete.

None of these requires another checklist permission today.

---

# 11. Strongest simpler alternative

Because you currently have exactly one grantable bit, the strongest simpler governance model is:

> **Owner + Member**, where every member automatically has the full `Manage SSH access` capability; no permission checklist exists until a second genuinely independent platform capability appears.

That is preferable if there is **no concrete need for members who belong to a platform but may not manage SSH**. It eliminates disabled-member states, subset-delegation logic, and a class of invitation races.

Keep the checklist now only if “member without SSH administration” is already a real product state. A checkbox that always defaults on but can legitimately be turned off supplies exactly that state.

There is also a simpler SSH implementation alternative: lossless raw `authorized_keys` line editing. It avoids building a semantic parser but gives substantially worse UX and makes unsafe edits easier. It is preferable only if the product is deliberately expert-facing and preserving arbitrary native syntax is more important than structured controls.

---

# 12. Explicit pass/fail checks

| Test | PASS condition |
|---|---|
| Queue SSH edit, then remove `Manage SSH` before worker starts | Worker performs **no server write** |
| Revoke permission after final pre-effect check while atomic remote write is already under way | Started write may complete; no later privileged step proceeds without another check |
| Queue owner-only operation, then transfer ownership before its pre-effect check | Old owner's operation is denied |
| Run two concurrent transfers from owner A to B and A to C | Exactly one commits |
| Transfer A → B | A immediately loses owner-only transfer power and becomes member with precisely the recorded post-transfer checklist |
| Invite with `Manage SSH`, then remove inviter's `Manage SSH` before acceptance | Invite cannot confer `Manage SSH` |
| Put the same public key in `root` and another account with different options | UI treats them as distinct authorization occurrences; deleting one does not delete by fingerprint globally |
| Change a key comment to another member's name | No identity, ownership or authorization result changes |
| Customer edits `authorized_keys` after Composery read but before write | Write reports conflict/requires refresh instead of overwriting customer edit |
| Entry contains an unsupported restriction; user edits only its comment | Restriction survives byte/semantic round-trip, or operation is refused |
| Remove member/account from Composery | Future Composery SSH operations fail; server SSH entry is **not** silently deleted |
| Existing removed member still has private key for an unchanged server authorization | Composery does not claim they have been revoked from Linux SSH |
| `Manage SSH` holder adds their own unrestricted key to root where effective config permits root pubkey login | Product documentation/UI recognizes this can yield root; a claim that the permission cannot confer OS admin would **FAIL** |
| `Manage SSH` caller requests Hetzner Rescue, Rebuild, reset-password or console | Denied by that permission |
| API sends private-key material to an SSH-management operation | Rejected/not represented by the API |
| Effective SSH configuration uses unsupported `AuthorizedKeysCommand`/file layout | Composery reports unsupported/incomplete rather than presenting a falsely authoritative list |

---

## Reproducibility note

I did **not** run a live SSH experiment against Ubuntu/Hetzner. I inspected the tagged OpenSSH source, the exact upstream fix, and primary Ubuntu/Hetzner/Convex/Clerk documentation. Direct repository cloning from the execution environment was unavailable, so I did not build or execute OpenSSH.

On an actual Ubuntu 24.04 Composery VM, these non-secret checks would establish the deployed facts:

```bash
dpkg-query -W -f='${Version}\n' openssh-server

sudo sshd -T -C user=root,host=localhost,addr=127.0.0.1 \
  | grep -E '^(authorizedkeysfile|authorizedkeyscommand|permitrootlogin|pubkeyauthentication|disableforwarding|permittunnel|allowtcpforwarding) '

ssh -V
```

For the source-level fix, reproduce against OpenSSH Portable with:

```bash
git checkout 8241b9c0529228b4b86d88b1a6076fb9f97e4a99   # 9.6p1
git show d322f2ccf7da095ce94d1d99cb563246f61487b0
```

The upstream change is directly inspectable here: [OpenSSH `restrict` tunnel-forwarding fix](https://github.com/openssh/openssh-portable/commit/d322f2ccf7da095ce94d1d99cb563246f61487b0?utm_source=chatgpt.com).

**Bottom line:** the working direction is sound without a person↔key ownership layer. The two architectural details I would make non-negotiable are **current-state authorization immediately before external effects** and **conflict-safe/lossless editing of live OpenSSH state**. The main product consequence to expose clearly is that a blanket SSH-management permission can be a route to full OS administration even though ownership, membership, and Linux privileges remain formally separate.
