# SSH Trust Recovery Methods

Source: https://chatgpt.com/share/6aa8b13e-3118-83eb-ab88-f304bba7197d

---

**User**

Context: A control plane connects over SSH to customer machines. At creation, a machine generates its host key and reports it through an authenticated one-time callback, and the control plane pins it against the machine's durable identity rather than its IP address. Customers have root, so they may regenerate host keys, reinstall the operating system, or replace the SSH server. Addresses are recycled between machines. The provider offers no signed instance identity document.

Question: When a machine legitimately presents a new host key, what protocols exist to re-establish trust, and how do they compare?

Cover at least: a fresh one-time enrolment token that a person runs on the machine; re-imaging so that first boot enrols again; OpenSSH host certificates with a certificate authority; UpdateHostKeys and what it can and cannot do; DNS with DNSSEC; provider console or metadata channels; and an operator approving a fingerprint by hand. For each: what an attacker must control to defeat it, what the customer must do, how it behaves when the customer is the attacker, how it degrades when the machine is unreachable, and the operational cost of running it.

Also cover how products present a failed host key check to a non-expert without training them to click through warnings.

Evidence rules: cite RFCs, OpenSSH documentation at exact versions, and provider documentation with dates. Give a concrete counterexample for every method. Say plainly where a method only moves the trust problem somewhere else.

---

**ChatGPT**

I’ll separate the problem into two adversaries: a network/address-reuse attacker versus a customer with root. That distinction is decisive here, because several “recovery” mechanisms only authenticate control of some other channel—they do not prove continuity of the original machine.

---

**ChatGPT**

The central security fact is already visible: once the old host key is gone, an automatic recovery path needs some *other* authenticated binding to the durable machine identity. A token, CA, DNSSEC zone, cloud account, console session, or human approval is therefore not “recovering” the old trust—it is choosing a new root of trust.

---

**ChatGPT**

A useful way to rank the options is by what remains trustworthy after the old host key is gone. Planned rotation can preserve continuity cryptographically; unplanned recovery cannot, unless you deliberately rely on another authenticated channel.

---

**ChatGPT**

The hard part is not SSH; it is **re-establishing the binding between a new key and the durable machine identity after continuity has been lost**. SSH itself assumes the client has some prior basis for trusting the server key. RFC 4251 says the client needs *a priori* knowledge of the server's public host key, and RFC 4253 is explicit that accepting a key without verification makes the protocol insecure against active attacks. ([RFC Editor](https://www.rfc-editor.org/info/rfc4251/?utm_source=chatgpt.com))

Under your stated assumptions—customer has root, IPs recycle, the old host key may disappear completely, and the provider supplies no signed instance-identity document—there is no fully automatic protocol that can cryptographically distinguish “the legitimate owner reinstalled this machine” from “the owner/root intentionally substituted another SSH identity” once the old trust anchor is gone. Every recovery scheme below either preserves continuity before it is lost, or **moves trust to another authority**.

As version grounding: the current OpenSSH release is 10.5/10.5p1, released August 11, 2026. Its tagged `ssh-keygen(1)` source describes host certificates, and its protocol file still documents the `hostkeys-00@openssh.com` / `hostkeys-prove-00@openssh.com` rotation mechanism. ([OpenBSD](https://www.openbsd.org/openssh/releasenotes.html?utm_source=chatgpt.com))

| Recovery mechanism | What an attacker must control | Customer work | If the customer/root is malicious | If machine is unreachable | Operating cost |
|---|---|---|---|---|---|
| Fresh one-time enrolment token | Token, account that can mint it, or enrolment service | Run a command on the intended machine | Customer can enrol whatever key they choose | Needs some shell/console path | Medium |
| Re-image + first-boot enrolment | Provisioning account/pipeline, bootstrap secret/channel | Initiate destructive rebuild | Customer can generally cause a newly chosen key to enrol | Often works despite broken guest networking; not if provider cannot boot/reimage it | High |
| OpenSSH host certificate | CA key or authorization to obtain a cert for that machine principal | Usually little after issuance is automated | Root cannot forge CA signature, but can obtain a cert if issuance policy authorizes the customer/root | CA can sign offline only if it already has a trustworthy CSR/key binding | Medium–high |
| `UpdateHostKeys` | Existing trusted host private key / currently trusted server | Usually none for planned rotations | Root normally controls the old host key and can authorize arbitrary successors | Fails: it needs a successful trusted connection before old key disappears | Low |
| SSHFP + DNSSEC | DNSSEC signing/update authority, or secure host→DNS update path | Possibly none | If customer controls DNS/update credential, they choose the new key | DNS can distribute a key already known elsewhere; cannot discover an unknown key on a dead host | Medium–high |
| Provider console / metadata | Provider-account IAM or provider channel; for metadata, ability to obtain the per-instance challenge | Console command or agent action | Root can consume/exfiltrate unsigned metadata and choose the host key | Console may still work with no network; metadata needs enough guest execution | Medium, provider-specific |
| Human fingerprint approval | Independent source of the fingerprint, or the approving operator | Compare/approve manually | A malicious customer can simply supply their chosen fingerprint unless operator has an independent source | Impossible without some other channel to obtain the fingerprint | High |

### A fresh one-time enrolment token

This is the cleanest general-purpose **recovery** mechanism under your constraints. The control plane issues a high-entropy, short-lived, single-use token scoped to one durable machine ID. A customer logs in through whatever access they still possess, runs something like `vendor re-enrol <token>`, and the enrolment agent generates or reads the new host key and sends `{machine-ID, host-key, token}` over authenticated TLS. The backend atomically consumes the token and replaces the pin.

An IP-address attacker cannot defeat this merely by inheriting the old address: they need the token, the account/session able to mint it, or the enrolment service itself. The customer has a modest explicit action, which is useful because an unexpected host-key change is exactly the event where silent automation is dangerous.

It does **not** defend against the customer as adversary. Someone with root and a valid token can point the token at any SSH key they want, run a substitute SSH server, or proxy the enrolment transaction. The token proves “someone authorized by the customer account deliberately re-enrolled machine X”; it does not prove “this key belongs to the same physical/virtual execution instance as before.”

When the guest is completely unreachable, the token cannot help unless there is a console or rescue environment through which the command can be run. Operationally it requires token issuance, expiry, one-time consumption, replay/race protection, auditing, and recovery UX, but none of that is unusually expensive.

**Concrete counterexample:** an attacker compromises the customer's web session, mints a token for machine `M123`, and enrols their own SSH server key. SSH cryptography works perfectly; the compromised customer authorization became the new trust root. This method therefore **moves trust from the old host key to the customer-account/enrolment-token system**.

### Re-image and enrol again on first boot

Treating reinstall as a new lifecycle event is often safer than trying to guess whether a changed key is benign. The provisioning system installs a fresh OS and supplies a one-shot bootstrap credential or per-instance challenge; first boot generates a new host key and performs essentially the same authenticated callback as original creation.

Against address recycling this is strong because the enrolment is keyed to the provider's durable instance object rather than the address. An attacker must compromise the imaging/provisioning account, first-boot secret, provider bootstrap channel, or enrolment backend.

But this is fundamentally an **automated form of one-time enrolment**, not magic continuity. If the customer with root is considered hostile and may legitimately initiate a reimage, then the customer can cause whatever new key the supported reimage flow produces to become trusted. If the first-boot secret is exposed through ordinary guest metadata, root can usually read it too.

Its main availability advantage is that the provider may be able to re-image a guest whose network and SSH stack are completely broken. The downside is obvious: it is destructive and imposes image management, state-restoration, support, and provisioning costs.

**Concrete counterexample:** a customer intentionally installs a modified image whose “SSH server” is a proxy to another machine; first boot correctly enrols that proxy's host key. The bootstrap process proved that the provider launched the customer's requested image, not that the customer behaved honestly.

### OpenSSH host certificates and a CA

Host certificates are the best way to stop treating every host-key change as an exceptional client-side pin update. In OpenSSH 10.5p1, `ssh-keygen` host certificates contain a public key, identities/principals and validity information signed by a CA; clients can trust the CA rather than every individual host key. The 10.5p1 documentation specifically describes host certificates and host-name principals. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh-keygen.1))

For your system, give each durable machine identity a stable logical SSH name—possibly an internal synthetic hostname—and issue host certificates for that principal. Do not make the IP the principal. OpenSSH also has `HostKeyAlias`, which lets the validation identity differ from the network destination, useful when transport addresses move. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.7/ssh_config.5?utm_source=chatgpt.com))

A network attacker now needs either the CA private key or a legitimately issued certificate for the victim machine's principal. Merely getting the IP is worthless. Normal SSH-key regeneration also becomes painless: generate a new key, obtain a new host certificate, and clients continue trusting the CA.

The catch is decisive: **how does the CA decide to sign the replacement key?** The certificate format solves distribution and client verification; it does not solve enrolment. If issuance authenticates a replacement CSR using a one-time token, the token is the real recovery trust anchor. If it relies on provider metadata, metadata is the anchor. If a human approves it, the human process is the anchor.

With a hostile customer, root cannot forge the provider CA signature. That is genuinely useful. But if your product promises that the machine owner may request a replacement certificate merely because they control the customer account or the guest, then a malicious owner can make the CA sign their chosen key. Preventing that requires an independent identity signal the owner cannot counterfeit—hardware attestation, provider-signed instance identity, or provider-controlled intervention. Your premise explicitly removes the signed-provider-identity option.

**Concrete counterexample:** the CA API says “authenticated account owner of M123 may submit a replacement host key.” A malicious owner submits an attacker's key. The certificate is perfectly valid. The PKI has moved trust to **CA issuance policy and authorization**, not eliminated the problem.

### `UpdateHostKeys`: excellent rotation, not recovery

This is frequently misunderstood. It is for **continuity-preserving, planned rotation**.

OpenSSH's current protocol source documents the `hostkeys-00@openssh.com` and `hostkeys-prove-00@openssh.com` extension. The server advertises additional keys after authentication, and the client may require proofs of possession for the new private keys. The IETF's April 2026 working-group draft describes the intended procedure: publish new keys while the old trusted key is still active; clients learn them; only later remove the old key. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/PROTOCOL))

OpenSSH's own specifications summarize it as allowing clients to learn additional host keys “where one or more keys is already known”; support dates to OpenSSH 6.8. ([OpenSSH](https://www.openssh.org/specs.html?utm_source=chatgpt.com))

That last phrase is the limitation. If the old key has already vanished because `/etc/ssh` was regenerated, the disk was replaced, or another SSH implementation took over, `UpdateHostKeys` has nothing trusted from which to bootstrap. The 2026 draft calls an uncoordinated change a hard break in trust, effectively indistinguishable from an on-path hijack. ([IETF Datatracker](https://datatracker.ietf.org/doc/draft-miller-sshm-hostkey-update/00/?utm_source=chatgpt.com))

OpenBSD 7.8 ships OpenSSH 10.2; its `ssh_config(5)` says additional keys are accepted only after authentication with an already trusted key, and—in that implementation—only when the original authentication came from `UserKnownHostsFile` and used a plain key rather than a host certificate. It is also disabled in some configurations including `VerifyHostKeyDNS`. ([OpenBSD](https://www.openbsd.org/78.html?utm_source=chatgpt.com))

A root customer is also outside its threat model. Root can ordinarily read or use the existing host private key and can therefore authenticate a session from which arbitrary successor keys are introduced.

**Concrete counterexample:** the customer deletes all `/etc/ssh/ssh_host_*` files and restarts sshd. The server immediately presents a brand-new Ed25519 key. `UpdateHostKeys` cannot authenticate the connection that would be needed to tell the client about that very key.

So: deploy it. It will eliminate many planned key-rotation incidents. But it is not your host-key-reset protocol.

### SSHFP in DNS protected by DNSSEC

RFC 4255 defines SSHFP precisely for this problem class: publish a host-key fingerprint in DNS and authenticate the DNS result with DNSSEC. An authenticated SSHFP match may establish the host key; an SSHFP RR that was not authenticated by a trusted DNSSEC signature must not be treated as trusted. ([RFC Editor](https://www.rfc-editor.org/info/rfc4255/?utm_source=chatgpt.com)) SHA-256 SSHFP fingerprints are standardized by RFC 6594, and Ed25519 SSHFP records by RFC 7479. ([RFC Editor](https://www.rfc-editor.org/info/rfc6594/?utm_source=chatgpt.com))

DNSSEC can therefore distribute a replacement key without touching every SSH client's known-hosts database. It is particularly attractive if every durable machine identity already has a stable provider-controlled DNS name.

But RFC 4255 itself says exactly where the trust goes: DNSSEC protects the fingerprint **after it has been signed by the DNS administrator**; the fingerprint must first be transferred securely from the host administrator to the DNS administrator. The RFC explicitly compares this to sending a certificate request to a CA. ([RFC Editor](https://www.rfc-editor.org/info/rfc4255/?utm_source=chatgpt.com))

Thus an attacker needs control of the DNSSEC signing/update authority or the authenticated path by which you update SSHFP. A mere IP hijacker cannot substitute the record.

A malicious customer wins if they control the relevant zone or dynamic-update credential. If *you* operate the zone and customers cannot modify SSHFP, DNSSEC protects clients from the customer—but now you face the original question again: how does your DNS service decide that the newly submitted fingerprint belongs to M123? DNSSEC does not answer it.

Also run a modern OpenSSH if using `VerifyHostKeyDNS`: OpenSSH 6.8p1 through 9.9p1 had CVE-2025-26465, where an on-path attacker could impersonate a server when this option was enabled; 9.9p2, released February 18, 2025, fixed it. ([OpenBSD](https://www.openbsd.org/openssh/releasenotes.html?utm_source=chatgpt.com))

**Concrete counterexample:** a dynamic-DNS API token stored on the guest is readable by root. The customer changes `M123.example SSHFP` to their attacker's key. DNSSEC subsequently authenticates that malicious record flawlessly.

DNSSEC therefore **moves trust to the DNSSEC zone and its update mechanism**.

### Provider console or metadata channels

These can be very good out-of-band roots because they identify a provider resource by durable instance ID rather than by its current IP.

AWS EC2 Instance Connect is a concrete example: its API accepts an EC2 `InstanceId` and pushes an SSH public key into that instance's metadata for 60 seconds; IAM controls who may do so. AWS launched Instance Connect on June 27, 2019. ([AWS Documentation](https://docs.aws.amazon.com/ec2-instance-connect/latest/APIReference/API_SendSSHPublicKey.html?utm_source=chatgpt.com)) A product could invert that pattern for host-key recovery: put a short-lived challenge into per-instance metadata and accept the new host key only when the challenge is returned.

AWS's EC2 Serial Console is even more useful for broken guests because it does not require instance networking; AWS documents it as direct serial-port access controlled through IAM, and introduced it on March 30, 2021. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-serial-console.html?utm_source=chatgpt.com)) From there an operator/customer could invoke the normal re-enrolment command.

This is much stronger against recycled IPs. An attacker needs the cloud-account/provider authorization or access to the target instance's provider channel.

But ordinary unsigned metadata is still a **capability channel**, not portable cryptographic proof of instance identity. A root customer can read a per-instance challenge and use it in whatever program they choose. They can also proxy an enrolment exchange elsewhere. It proves “the holder could obtain data exposed to this instance,” which is enough against an unrelated address-recycling attacker but not enough against hostile root.

There is a qualitatively different design when the provider cryptographically signs instance identity. Azure IMDS demonstrates the distinction: its documentation, last updated July 29, 2025, says ordinary IMDS is host-local, while the attested-data endpoint returns a PKCS#7-signed document containing VM-specific data such as `vmId`, so a verifier can confirm the data originated from Azure. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service)) That is precisely the capability your premise says the provider does **not** offer.

**Concrete counterexample:** your backend writes nonce `N` into M123's unsigned metadata. Malicious root reads `N`, starts a substitute host key or proxies to another SSH endpoint, and submits `{M123, N, attacker-key}`. The metadata channel defeated the IP recycler, but not root.

This method therefore **moves trust to cloud IAM plus the provider's console/metadata isolation**.

### Operator approval of a fingerprint

Manual verification is sound only if the fingerprint comes from an **independent authenticated channel**. An operator who merely sees the new fingerprint produced by the failed SSH connection and clicks “approve” has added essentially no authentication; the attacker can print their own fingerprint just as easily.

A valid manual process would obtain the fingerprint from a provider serial console, physical console, trusted rescue environment, or another authenticated control channel and compare it to the SSH-presented SHA-256 fingerprint. A customer reading a fingerprint aloud or pasting it into a support ticket is only an independent channel if the customer identity itself is the authority you intend to trust.

A network/address attacker must compromise that independent channel or deceive the operator. A malicious root customer can simply arrange for their malicious SSH implementation to display the chosen fingerprint, so this again does not protect you from the owner unless the operator independently observes machine state through something the owner cannot forge.

It works poorly at scale and has high human-error and social-engineering cost. If the box is completely inaccessible and has no console, there is no fingerprint to verify.

**Concrete counterexample:** support receives “I reinstalled server M123; please approve `SHA256:abc...`” from a compromised customer account and copies that value into the control plane. The human step has merely recreated the one-time-token model with a weaker, error-prone interface.

### How the product should handle a failed host-key check

Do not present changed host keys as a warning with **Continue anyway** next to **Cancel**. RFC 4255 noted twenty years ago that many users simply accept fingerprints without actually verifying them. ([RFC Editor](https://www.rfc-editor.org/info/rfc4255/?utm_source=chatgpt.com)) OpenSSH's safer distinction is instructive: `StrictHostKeyChecking=accept-new` automatically accepts genuinely new hosts but still refuses changed keys; the normal `ask` behavior likewise refuses changed keys rather than treating them as an ordinary first-use confirmation. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.7/ssh_config.5?utm_source=chatgpt.com))

For a non-expert, I would make a changed key a **blocked state**, with wording along these lines:

> **Connection blocked — this machine's identity changed.**  
> This can happen after reinstalling the operating system or replacing SSH, but it can also mean the address now points to a different machine. No connection was made.

The primary button should be **Re-establish trust**, not **Accept key**. That opens the appropriate authenticated workflow: generate a fresh enrolment token, use the provider console, or rebuild/re-enrol. A secondary **Technical details** view can show the durable machine ID, old fingerprint, new fingerprint, first/last-seen times and current address, explicitly noting that the address is not the identity.

Manual fingerprint approval should live behind an advanced action such as **I verified this fingerprint through an independent channel**, preferably requiring entry or confirmation of the independently obtained value. Do not make users click through the warning merely to keep working; otherwise you teach them that identity failures are routine obstacles.

Every successful recovery should audit the old key, new key or certificate serial, durable machine ID, recovery mechanism, actor/account, timestamp, and—for manual paths—the independent channel used.

### What I would deploy in this design

For **planned rotation**, use `UpdateHostKeys` for plain-key installations, or move to OpenSSH host certificates so clients trust a stable CA and machine principal instead of individual keys. Keep old and new keys overlapping long enough for all control-plane clients to learn them. The 2026 host-key-update draft is expressly designed around that overlap. ([IETF Datatracker](https://datatracker.ietf.org/doc/draft-ietf-sshm-hostkey-update/?utm_source=chatgpt.com))

For **unplanned loss of all old SSH identity**, make a fresh, short-lived, one-use enrolment token the universal recovery primitive. When a provider offers a trustworthy per-instance console or metadata channel, let that channel deliver or execute the same enrolment operation, because it avoids dependence on the recycled network address. Re-imaging is the destructive variant of the same process and is a good recovery fallback.

Host certificates are then valuable **after** recovery because they drastically reduce pin-management complexity, but CA issuance must call one of those real recovery mechanisms. DNSSEC can be a useful distribution layer, particularly for fleets, but likewise should consume already-authenticated key material rather than becoming the thing that decides which key is legitimate.

Manual fingerprints should be the last resort, and only with an independent source.

And if **“the customer with root is itself the attacker” is genuinely inside the security boundary**, the answer is narrower: none of the customer-driven recovery mechanisms can both permit legitimate root-controlled reinstall/replacement and prevent that same root principal from substituting an SSH identity. You need an authority root cannot impersonate—provider-signed instance attestation, TPM/HSM-backed device identity enrolled before compromise, or provider/operator intervention. Without one of those, a successful recovery protocol can authenticate the **customer's authorization to change the machine identity**, but not continuity of the machine independently of that customer.
