# SSH Host Key Trust Methods

Source: https://chatgpt.com/share/6aa8713b-f2e4-83ed-861f-38b66b61bf16

---

**User**

Context: A control panel connects over SSH to customer VPS instances. At creation, the instance generates its host key and reports it over an authenticated channel, and the panel pins that key. Customers have root and can regenerate host keys or reinstall the operating system. IP addresses return to the provider's pool after deletion and can be reused.

Question: How should a control plane establish and maintain trust in host keys of machines it does not fully control, including legitimate host key changes?

Cover: pinning at creation, trust on first use, SSH host certificates signed by a certificate authority, SSHFP records, fingerprints from provider console output or metadata, and any other method. For each: what attack it prevents (for example a man-in-the-middle or IP reuse), what happens when the customer changes the host key legitimately, how trust is re-established, and operational cost. Describe the concrete consequences for the company and its customers when a control plane connects to an impostor. Include what AWS, Google Cloud, Ansible, and other widely used systems do.

Evidence rules: Cite RFCs, OpenSSH documentation at exact versions, and official provider documentation. Separate documented behavior from inference. Give counterexamples for each method.

---

**ChatGPT**

I’ll treat this as a threat-model and design review, not just a catalogue of SSH features. I’ll separate what the standards/providers explicitly document from the security conclusions that follow from them, and I’ll make host-key rotation/reinstallation the central test case for each method.

---

**ChatGPT**

The first important distinction is already clear: **“the IP address” must not be the durable identity**. In a VPS pool, IP reuse makes “same IP ⇒ same machine” false by design; the durable identity has to be an instance/resource identity, a CA principal, or some other authenticated control-plane binding. Google’s current guidance explicitly warns that VM names and IPs can be reassigned/reused for spoofing, and recommends obtaining host keys over a trusted back channel before first SSH use.

---

**ChatGPT**

A second distinction matters for rotation: **continuity is not the same thing as re-enrolment**. OpenSSH’s `UpdateHostKeys` is excellent for a planned rotation while an old trusted key still works; it deliberately learns replacement keys only after successful authentication with an already trusted key. It cannot solve a reinstall where the old private host key is gone.

---

**ChatGPT**

## Conclusion

For a control plane that manages customer-owned VPSs, the safest model is:

**Bind SSH trust to a durable control-plane instance identity, not to an IP address; pin the initial host identity through an authenticated bootstrap path; fail closed on unexplained changes; and provide a separate authenticated re-enrolment mechanism for reinstalls or loss of the old host key.**

That distinction—**rotation with continuity** versus **re-enrolment after continuity is lost**—is fundamental. SSH itself cannot determine whether an unexpected new key means “the customer reinstalled” or “an attacker now owns this IP/path.” RFC 4253 explicitly says the client must verify that the presented host key really belongs to the server, for example using a certificate or local database; accepting it without verification makes SSH insecure against active attacks. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4253.html))

The current upstream release as of September 2026 is OpenSSH **10.5/10.5p1, released August 11, 2026**; the OpenSSH behavior below refers specifically to its 10.5p1 documentation. ([OpenSSH](https://www.openssh.com/releasenotes.html))

### Threat model first

A host key authenticates an SSH endpoint. It does **not** establish that the operating system is trustworthy. In your scenario the customer legitimately has root, so they can replace `sshd`, replace every host key, modify any agent you installed, or deliberately run a hostile SSH service. Your control plane therefore needs to answer a narrower question:

> “Is this SSH endpoint the endpoint currently authorized to represent control-plane resource X?”

The IP address is unsuitable for that purpose. Google Cloud's security documentation makes exactly the relevant point: VM names and IP addresses can be reassigned or reused, and attackers can exploit such reassignment to impersonate a VM. It recommends obtaining host keys through a trusted side channel before the first SSH connection. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/credentials?authuser=6))

I would make the authoritative identifier something like:

`provider / account / resource_id / incarnation`

where `incarnation` changes when a deleted resource is recreated, and perhaps on a destructive reinstall depending on your semantics. IP addresses are merely current routing attributes of that identity.

## Methods compared

| Method | What it prevents | Legitimate host-key change | How trust returns | Operational cost | Important counterexample |
|---|---|---|---|---|---|
| **Authenticated pinning at creation** | First-connection MITM and IP-reuse attacks, provided the registration channel really identifies the new instance | Unexpected SSH connection fails | New key must be authenticated through old trusted state or independent re-enrolment | **Low–medium** | If pins are indexed only by IP, deleting A and assigning its IP to B breaks the identity model |
| **TOFU / `accept-new`** | MITM *after* an uncompromised first connection | Changed key is rejected | Human/admin removes old pin and accepts a new one | **Low initially; high incident toil** | Attacker present at the first connection gets permanently pinned |
| **OpenSSH host certificates / CA** | MITM and IP reuse without storing every host key, if CA issues correct principals | New host key simply gets another valid host certificate | Sign new key after authenticated enrolment | **Medium/high setup; low steady-state** | Compromised CA, or an enrolment service allowing a VM to request somebody else's principal, compromises the model |
| **DNSSEC + SSHFP** | First-use MITM when DNSSEC validation is trustworthy | Securely replace/add SSHFP | Secure DNS update; overlap old/new during planned rotation | **Medium–high** | Unsigned SSHFP is not a trust anchor; RFC 4255 explicitly says not to trust it |
| **Provider console/API fingerprint** | Network MITM and IP reuse, assuming lookup is against expected provider instance identity | Obtain new fingerprint from same authenticated provider channel | Operator or automation approves provider-observed replacement | **Low–medium, provider-specific** | Comparing the SSH prompt with `ssh-keyscan` over the same attacked network gives no independent evidence |
| **Guest metadata / guest attributes** | External network attacker if provider API associates data with expected resource | Guest republishes new key | Query provider API again | **Low, cloud-specific** | On GCP, *any process in the VM* can write guest attributes; therefore it does not protect against a malicious/compromised guest |
| **Signed cloud instance identity + enrolment protocol** | Strongly binds re-enrolment to a provider resource | New key submitted during authenticated enrolment | Verify cloud identity plus challenge and bind that proof to the key | **Medium engineering effort; strong option** | Verifying an instance token and receiving a host key in separate, unbound transactions allows substitution/replay |
| **`UpdateHostKeys`** | Safe *planned* key transition while an existing trusted key remains | Old server advertises replacements over authenticated SSH | Automatic | **Very low** | Does not solve a reinstall where every old private key vanished |
| **`ssh-keyscan` alone** | Essentially nothing against an on-path adversary | Re-scan obtains whatever answers | None securely | **Very low** | OpenSSH explicitly warns an interceptor can substitute its own key |

### 1. Pinning at creation: the right baseline

Your existing creation procedure is already a strong foundation. If the freshly booted instance generates its host key and sends its public key or fingerprint to the panel over a channel that the panel has independently authenticated as belonging to *that exact resource*, store that binding.

For automated SSH, use `StrictHostKeyChecking=yes`. OpenSSH 10.5p1 documents that this mode never automatically adds a new host key and refuses hosts whose key changed; OpenSSH describes it as providing its maximum MITM protection. By contrast, `accept-new` automatically records previously unseen hosts but still rejects changed keys, while `no`/`off` can permit changed keys subject to restrictions. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

Do not key that database as:

`203.0.113.12 → key K`

Use something conceptually closer to:

`instance-7f32, generation 4 → {K1, K2}`

and separately:

`instance-7f32 → current IP 203.0.113.12`.

OpenSSH's `HostKeyAlias` is useful here: 10.5p1 explicitly lets an alias replace the real hostname when looking up/saving host keys and when validating host certificates. Thus the panel can connect to a changing or reusable IP while verifying a stable synthetic identity such as `vps-7f32-g4.internal.example`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

For a centrally managed registry, either generate an ephemeral `known_hosts` file for each job, or use `KnownHostsCommand`. OpenSSH 10.5p1 permits that command to emit normal known-host lines dynamically, and terminates the connection if the command fails abnormally. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

**Counterexample:** if a machine is deleted, its IP returns to the pool, and your software deletes the corresponding known-host entry and then uses TOFU on the next machine at that IP, you have discarded the main security property your authenticated creation channel gave you.

### 2. TOFU is useful for humans, weak for a control plane

TOFU solves a different problem: “I don't currently know the server key, but remember the first one I see.”

It protects subsequent connections if the first connection was genuine. It does not authenticate the first connection. Google explicitly calls out that a MITM on first use can cause the client to trust the wrong VM. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/credentials?authuser=6))

`StrictHostKeyChecking=accept-new` is a reasonable OpenSSH implementation of automatic TOFU: new destinations are added, changed keys are rejected. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

For your service, it is inferior to creation-time pinning because you already possess a better trust source.

**Counterexample:** attacker controls routing during the first management connection. The control plane TOFUs the attacker's key. Thereafter it will faithfully reject the real server.

A subtler VPS-pool counterexample is IP reuse: removing the old IP's pin because “the old VPS no longer exists” and then automatically TOFUing the new occupant turns every reassignment into another vulnerable first-use event.

### 3. Host certificates are the cleanest solution at fleet scale

OpenSSH host certificates replace a large collection of individually trusted host keys with trust in one or more host CAs. In OpenSSH 10.5p1 a certificate contains a public key, identity information, principals and options, signed by a CA; clients can trust the CA instead of every host key individually. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh-keygen.1))

The control plane can place an `@cert-authority` entry in its trusted-host database; OpenSSH's known-host format explicitly supports this marker. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

The critical design point is the **principal**. Do not issue a certificate merely saying “this key is valid somewhere in the VPS fleet.” Give it a principal such as:

`vps-7f32-g4.hosts.example`

OpenSSH host certificates encode hostnames as principals, and `HostKeyAlias` can supply the name against which the certificate is validated. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh-keygen.1))

When the customer regenerates a host key, there is no client-side pin update: the new key gets a new host certificate for the same authorized principal.

But certificates do **not eliminate enrolment**. They move it to the signer. The CA/signing service must establish that the requester is entitled to `vps-7f32-g4` before signing its new key.

**Counterexample:** suppose any VPS can call `POST /sign-host-key` with `principal=vps-1234`. Then compromising one customer's VPS lets it obtain a certificate for another customer's machine. Cryptography is working perfectly; authorization is broken.

The operational trade-off is favorable at scale but increases blast radius. Protect host-CA private keys in an HSM/KMS or isolated signing service, issue short-lived certificates where feasible, log issuance, and tightly constrain principal issuance. A CA compromise can impersonate every principal in its scope.

Teleport provides a useful production example of the lifecycle. Its documented CA rotation is phased: create a new CA, move clients into a state trusting the transition, update servers/certificates, and eventually retire the old CA; its current documentation exposes an `update_clients` phase specifically for that dual-trust transition. ([Teleport](https://goteleport.com/docs/zero-trust-access/management/security/ca-rotation/))

### 4. SSHFP works, but only with authenticated DNS

RFC 4255 defines publishing SSH host-key fingerprints as DNS `SSHFP` records. Its security requirement is unusually explicit: a host key verified by SSHFP **must not be trusted if the SSHFP record was not authenticated by a trusted DNSSEC signature**. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4255.html))

RFC 6594 defines fingerprint type 2 as SHA-256 and says SSHFP implementations supporting SHA-256 must prefer it to SHA-1. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc6594.html))

With DNSSEC and a stable machine name, this can provide secure first-use discovery. For a planned rotation, publish fingerprints for both old and new keys, deploy the new key, wait through DNS caches as necessary, then withdraw the old record.

For an unplanned reinstall, however, something still has to authorize the DNS update. You've simply moved the re-enrolment problem into your DNS-management path.

RFC 4255 also says that without comparison against a fingerprint obtained over a secured channel, the connection remains MITM-vulnerable; overall SSHFP security depends in part on the SSH and DNS administrators transferring the fingerprint securely. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4255.html))

**Counterexample:** publish an unsigned SSHFP record and configure clients to accept it. An attacker who can spoof DNS can spoof the fingerprint and SSH endpoint together.

Operationally, SSHFP is attractive if you already operate signed DNS correctly. Introducing DNSSEC solely for internal VPS host-key management is often more complex than a direct registry or CA.

### 5. Provider console output and metadata make good independent channels

A provider's authenticated control plane is a natural second trust root because it knows the cloud resource independently of SSH routing.

AWS documents retrieving an EC2 instance's SSH host-key fingerprint from its console output and comparing that value with the SSH client's prompt; AWS says a mismatch may indicate MITM. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connection-prereqs-general.html))

The useful security property is not “console text” itself. It is:

**authenticated AWS account → exact EC2 instance ID → that instance's console output → fingerprint.**

This defeats the IP-reuse problem because the query identifies the expected resource, not merely whoever owns the current IP.

**Counterexample:** run `ssh-keyscan 203.0.113.12`, see key X, then compare it with the SSH prompt from `203.0.113.12`. Both observations traversed the same attackable path, so they are not independent. OpenSSH 10.5p1 expressly warns that `ssh-keyscan` cannot verify authenticity and that an interceptor can substitute keys; its output should be verified out of band or used directly only on a trusted network. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh-keyscan.1))

### 6. AWS demonstrates explicit re-enrolment rather than auto-accept

AWS's EC2 Instance Connect browser client has a particularly relevant behavior. AWS says that if you rotate an instance's host keys, **the new keys are not automatically uploaded to the AWS trusted-host-key database**, causing host-key validation to fail. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/TroubleshootingInstancesConnecting.html))

AWS's documented recovery is to run `eic_harvest_hostkeys` on the instance to upload the new host keys, after which browser-based Instance Connect works again. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/TroubleshootingInstancesConnecting.html))

That is a valuable design precedent: unexpected replacement produces failure, followed by an explicit mechanism that re-establishes the binding. AWS does not solve legitimate rotation by saying “host keys change sometimes, so accept whatever appears.”

### 7. Google Cloud uses a provider back channel—but note its trust boundary

Google's documentation goes further and explicitly recommends obtaining a host key through a trusted side channel. Compute Engine can expose host keys through guest attributes so tooling can obtain them through Google's API before opening SSH. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/credentials?authuser=6))

That helps significantly against an external MITM or recycled IP. But its internal threat model is weaker than a hardware/provider-generated attestation: Google documents that **any process running in the VM can write guest attributes, even without sudo**, although outside users cannot write them. ([Google Cloud](https://cloud.google.com/compute/docs/metadata/manage-guest-attributes))

So guest attributes answer:

> “What host key is software inside this particular Google VM advertising?”

They do not answer:

> “Has the customer-controlled OS remained trustworthy?”

For your customer-root model that may be perfectly acceptable—you already allow the customer to control the guest—but you should document the boundary.

Interestingly, the `gcloud compute ssh` command itself documents a default of `StrictHostKeyChecking=no` on the first connection and `yes` on subsequent ones. ([Google Cloud Documentation](https://docs.cloud.google.com/sdk/gcloud/reference/compute/ssh)) That default should not be copied blindly into an unattended high-privilege control plane, particularly when you possess a stronger authenticated registration path.

### 8. Signed provider identity is an excellent re-enrolment primitive

A robust approach after reinstall is to make the fresh guest prove its cloud-resource identity independently of its SSH key.

Google Compute Engine can issue a Google-signed VM identity JWT. Google documents that the token confirms instance identity, expires within an hour, can be treated as single-use by the receiver, and contains fields including project, zone, instance ID and creation timestamp. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/instances/verifying-instance-identity?authuser=0&hl=en))

AWS likewise supplies an EC2 instance identity document, and AWS documents verifying its signatures using AWS public certificates to establish the document's origin and authenticity. ([AWS Documentation](https://docs.aws.amazon.com/us_en/AWSEC2/latest/UserGuide/instance-identity-documents.html?utm_source=chatgpt.com))

**Inference:** these provider identity mechanisms can serve as building blocks for your own SSH-key re-enrolment protocol, but neither cited mechanism by itself signs an arbitrary SSH host key. You need to cryptographically or transactionally bind the proof to the submitted key.

For example, issue a one-time challenge for resource X, and require the reinstall/bootstrap agent to return:

`resource ID + challenge + new SSH public key + provider identity proof`

over authenticated TLS. Verify all of them in one enrolment transaction and atomically authorize that key—or issue a host certificate for it.

**Counterexample:** endpoint A submits a valid provider identity token while, in a separate unauthenticated request, endpoint B submits the SSH key. Checking both independently does not establish that the authenticated resource requested *that particular key*. Nonces, audience restrictions, expiry and atomic binding matter.

### 9. `UpdateHostKeys` is ideal for planned rotation, not reinstall

OpenSSH 10.5p1's `UpdateHostKeys` lets a server send additional host keys **after authentication**, enabling replacement keys to be learned before old keys disappear. OpenSSH explicitly describes this as supporting graceful key rotation. Critically, additional keys are accepted only after authentication using a key that was already trusted or explicitly accepted. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

This is exactly what you want for:

`K_old trusted → advertise K_new → trust K_old+K_new → remove K_old`.

It is not a recovery mechanism for:

`disk reinstalled → K_old gone → only unrelated K_new exists`.

There is no continuity proof in the second case.

There is also an OpenSSH-specific limitation: 10.5p1's automatic `UpdateHostKeys` behavior is associated with authentication by a plain trusted host key rather than a host certificate, and its default is disabled when `VerifyHostKeyDNS` is enabled or the normal known-host-file conditions are changed. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

**Counterexample:** if `K_old` itself has been stolen, continuity proves only possession of the stolen old credential. An attacker authenticated with it may participate in the rotation. Rotation is not revocation magic.

## A concrete lifecycle I would deploy

1. **Creation.** Give every machine an immutable provider/control-plane resource ID and an incarnation/generation. During authenticated bootstrap, accept one or more freshly generated SSH host public keys and record their exact provenance. Never derive identity from the assigned IP.

2. **Normal SSH.** Resolve the resource's current address through your provider/control-plane state, but verify SSH against its resource identity. With ordinary pins, use an ephemeral `known_hosts` or `KnownHostsCommand`, `HostKeyAlias=<stable-resource-principal>` and `StrictHostKeyChecking=yes`. With host certificates, trust your host CA and validate the resource-specific principal. OpenSSH directly supports both the alias and central known-host lookup mechanisms. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

3. **Planned key rotation.** While the old trust path remains alive, register the replacement key over your existing authenticated bootstrap channel, or use `UpdateHostKeys` for plain OpenSSH host keys. Allow an `active` and `next` key for a bounded overlap, then retire the old key. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

4. **OS reinstall / all keys lost.** Mark SSH identity as *untrusted/pending re-enrolment*. Do not infer legitimacy from the fact that the IP and customer account are unchanged. Require a fresh authenticated bootstrap proof tied to the expected resource and reinstall generation—provider metadata/token, console-mediated challenge, provider-signed instance identity, or authenticated customer action. Only then replace the pin or issue a new host certificate.

5. **Deletion and IP reuse.** Destroy the old resource-to-address association. Never transfer its trust record to the next occupant of the IP. If a new provider instance has a new instance ID/incarnation, it is a completely new SSH identity even if customer, hostname and IP happen to match.

6. **Manual recovery.** Allow a customer/operator to confirm a fingerprint only if they obtained it through an independent authenticated path—for example the provider's serial/console interface. Merely copying the value from the SSH warning dialog is not verification.

7. **Defense in depth.** Run SSH management jobs in isolated workers, scope each customer's credentials separately, avoid forwarding your SSH agent, and avoid exposing broad control-plane secrets to the remote host. OpenSSH 10.5p1 warns that a remote user able to reach a forwarded agent can use its loaded identities for authentication even though they cannot extract the raw private-key material. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

For a modest fleet, I would keep **per-instance pins + authenticated re-enrolment**. At larger scale, I would move to **short-lived host certificates + an authenticated certificate-enrolment service**, because this separates the stable authorization decision (“resource X may use principal X”) from ephemeral host-key material.

## What Ansible and other widely used systems actually do

**Ansible:** the current `ansible.builtin.ssh` connection plugin delegates to the native SSH client and documents `host_key_checking=true` as the default. ([Ansible Documentation](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/ssh_connection.html)) Ansible Core 2.19's connection documentation explicitly explains that host-key checking protects against server spoofing and MITM and requires maintenance. ([Ansible Documentation](https://docs.ansible.com/projects/ansible-core/2.19/inventory_guide/connection_details.html)) The important architectural point is that Ansible does **not** solve the host-key re-enrolment problem for you: when a known host legitimately changes keys, its trust database must be repaired through an independently justified administrative process. Disabling checking removes the protection rather than solving rotation.

**AWS:** conventional EC2 guidance provides an out-of-band fingerprint via instance console output, while EC2 Instance Connect's browser client maintains trusted host-key state and deliberately fails after customer rotation until replacement keys are explicitly harvested. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connection-prereqs-general.html))

**Google Cloud:** Google explicitly describes the IP/name-reuse attack, recommends a trusted side channel, and supports host-key discovery through its control-plane/guest-attribute mechanism. It also provides signed VM identity JWTs that are useful for stronger custom re-enrolment protocols. ([Google Cloud Documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-best-practices/credentials?authuser=6))

**Teleport:** uses SSH certificate authorities and documents phased CA rotation, a good example of avoiding per-host pin churn while retaining explicit trust transitions. ([Teleport](https://goteleport.com/docs/zero-trust-access/management/security/ca-rotation/))

**Tailscale SSH:** its CLI documentation says it automatically compares the destination's SSH host key with the node host key advertised through Tailscale's coordination server. This is another implementation of the “authenticated central registry” model rather than raw TOFU against an IP. ([Tailscale](https://tailscale.com/docs/reference/tailscale-cli))

**GitHub:** for a service whose identity is centrally controlled and public, GitHub publishes its SSH fingerprints so users can validate the first connection against an independently delivered value. ([GitHub Docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)) That works because the HTTPS documentation is the independent trust path. Copying a fingerprint from the potentially spoofed SSH endpoint itself would not provide the same property.

## The concrete failure if your panel connects to an impostor

This is much worse than a cosmetic “host-key warning.”

Once the panel has authenticated the wrong SSH server, SSH gives it a strongly encrypted channel **to the attacker**. Encryption does not help because the impostor is one endpoint of the encrypted session. This is precisely why RFC 4253 says accepting an unverified server key leaves SSH insecure against active attack. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4253.html))

What the attacker obtains depends on your authentication and automation:

- With **password authentication**, RFC 4252's SSH user-authentication message contains the plaintext password *inside the already encrypted SSH transport*. The legitimate network eavesdropper cannot read it, but the impostor SSH server can, because it terminates that transport. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4252.html))
- With normal **public-key authentication**, do not overstate the damage: the client does not hand the server its private key. SSH authentication is built over a server-authenticated transport with a per-session identifier, and the client signs session-bound authentication material. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4252.html)) The malicious server can nevertheless accept the authentication and then receive everything your automation sends.
- With **agent forwarding**, the private key still is not exported, but OpenSSH warns that someone controlling the remote host can invoke the forwarded agent to perform authentication operations with its loaded identities. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/ssh_config.5))

For a hosting control panel, the likely business impact is broader than the SSH credential itself. The impostor could receive root provisioning commands, scripts, configuration files, repository credentials, database passwords, backup credentials, customer API tokens, certificates or any secret normally transmitted to the VPS. It can return fabricated stdout/stderr so the panel records “upgrade successful” or “backup complete” while the real customer VPS was never touched. If your workflow downloads logs, backups or configuration, the attacker controls those bytes as well.

The most dangerous IP-reuse scenario is straightforward: customer A deletes a VPS; customer B—or an attacker—gets its IP; the panel has host checking disabled or automatically accepts changes; later a scheduled job for A connects to that address. The malicious SSH server does **not need the panel's private client key**. It can choose to accept the client's authentication and then observe A's management commands and any credentials/configuration sent during the session.

For the company, that can mean cross-tenant disclosure, emergency revocation and rotation of every secret exposed to affected sessions, investigation of all control-plane jobs executed against the impostor, potential customer/contractual or regulatory notifications depending on the data involved, suspension of automation while integrity is established, support costs and reputational damage. For the customer, it can mean leaked code/configuration/secrets, false backups and monitoring, silently missed security updates, credential reuse against downstream systems, and potentially compromise beyond the VPS itself.

One final limitation is important: **even perfect host-key verification does not make a customer-controlled VPS safe to trust with control-plane secrets.** A customer with root can operate the correctly pinned private host key while running a deliberately malicious SSH server. Host authentication protects you from connecting to the *wrong identity*; isolation and least privilege protect the control plane from the *right identity behaving maliciously*.

### Decision in one sentence

For this exact product, I would use **authenticated creation-time pinning today, keyed by immutable resource ID/incarnation rather than IP; `StrictHostKeyChecking=yes`; continuity-based rotation where possible; mandatory independent re-enrolment after reinstall; and, as fleet complexity grows, replace individual pins with short-lived OpenSSH host certificates whose resource-specific principals are issued only after the same authenticated enrolment proof.** TOFU, unsigned SSHFP, `ssh-keyscan`, or “the IP is still the same” should never be accepted as recovery evidence.
