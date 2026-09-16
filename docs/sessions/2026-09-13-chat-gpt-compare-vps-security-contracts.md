# Compare VPS Security Contracts

Source: https://chatgpt.com/share/6aa6f504-a1ec-83eb-bf21-21f37138f7a0

---

## Turn 1: User

_2026-09-13T19:03:55.097Z_

Research the product/security boundary for a service that provisions Hetzner Cloud VPSs for end users, with a future move to VMs on dedicated hosts. We want substantial Linux freedom, perhaps full root. Later features may include direct SSH and authenticated app URLs on a customer-workload domain separate from the marketing/control domain. Clerk and Convex control membership. There is no chosen network topology yet.

Compare full root with direct public ingress, full root with gateway-only ingress, and managed workloads without root. Explain what each can actually enforce against a malicious guest administrator, including alternate access paths and outbound tunnels. Use current official Hetzner firewall/network documentation and applicable provider terms. Distinguish provider requirements from engineering choices and matters requiring provider confirmation. Cover IPv4 and IPv6, outbound abuse, mail restrictions, existing connections during suspension, tenant isolation, private-network reachability, blast radius, resource quotas, and emergency response. Do not claim a firewall prevents abuse or gives unrestricted networking.

Return a concrete small first topology for each viable contract, its limitations, and the few product decisions that must precede code. Identify exactly which account-level questions need a Hetzner support response. Avoid building a generic enterprise security program. Cite primary sources and mark uncertainty.

---

## Turn 2: ChatGPT

_2026-09-13T19:03:56.660Z_

I’ll separate three layers throughout: what Hetzner actually commits to or prohibits, what the platform can technically enforce against a root-equivalent guest, and what remains an architecture choice. I’ll also flag any point where the public docs are insufficient and turn that into a precise support question rather than guessing.

---

## Turn 3: ChatGPT

_2026-09-13T19:04:16.873Z_

One important boundary is already clear from Hetzner’s own docs: Cloud Firewalls do **not** filter traffic on Hetzner Cloud private Networks, and private subnets are **not isolated from one another**. So a shared private Network is not a tenant-security boundary for root-capable guests; isolation must come from separate Networks or another enforced layer.

---

## Turn 4: ChatGPT

_2026-09-13T19:05:06.901Z_

A second key finding is that “no root” is not, by itself, an outbound-abuse control. Any arbitrary unprivileged process can still make network connections and build reverse tunnels if egress permits them. The meaningful distinction is whether networking is enforced outside the customer-controlled workload (provider firewall, gateway, or hypervisor/host firewall), not merely whether the user has UID 0.

---

## Turn 5: ChatGPT

_2026-09-13T19:05:06.901Z_

## Bottom line

There are three coherent product contracts here, but they make materially different promises.

**Full root + direct public networking** is a VPS product. Hetzner can enforce an outer IP/port policy, but the customer administrator controls essentially everything above it. If outbound internet is broad, you cannot prevent alternate exposure through reverse tunnels, VPNs, relays, or permitted ports. You should not promise that Clerk/Convex authentication governs access to the machine or its apps.

**Full root + gateway-only networking** is the strongest way to combine real root with a platform-controlled ingress boundary. A VM with no Hetzner Primary IP has no public network at all; all customer ingress and internet egress can be forced through infrastructure you control. The important caveat is that unrestricted egress still lets root create outbound tunnels, so “all inbound goes through our authenticated gateway” is only strictly true if the egress contract prevents or accepts that bypass.

**Managed workloads without root** gives you substantially stronger control of the OS and networking, but removing UID 0 does not stop malicious application code from scanning, tunnelling, spamming through permitted services, or attacking reachable private services. The real enforcement gain comes from keeping the host/network namespace outside customer control.

For an initial product that wants authenticated app URLs and perhaps SSH later, I would make **gateway-only root the root-capable contract**, and keep direct-public root as an explicitly different “raw VPS” tier if you need it.

All provider statements below are based on Hetzner's current public documentation and terms as of **13 September 2026**.

---

# 1. What Hetzner requires, versus what you choose

Hetzner expressly permits a customer to let third parties use Hetzner services, but **you remain Hetzner's sole contractual counterparty and are fully responsible for those third parties' compliance**. The general terms also say the customer has sole administrator rights over root/cloud servers and is responsible for managing and securing them. ([Hetzner](https://www.hetzner.com/legal/terms-and-conditions/))

The important provider prohibitions are outcome-based rather than architecture-based. Hetzner prohibits compromising the integrity/availability of third-party networks or systems, DDoS activity and open mail relays; spam is prohibited; cryptocurrency mining is prohibited. The Cloud service terms additionally prohibit scanning foreign networks/IP addresses and use of fake source IPs. ([Hetzner](https://www.hetzner.com/legal/terms-and-conditions/))

So **Hetzner does not publicly require you to use a gateway, deny root, or use a particular firewall architecture**. Those are engineering/product choices for meeting your obligations and controlling your own risk.

The contractual blast radius is larger than a single VM. Hetzner's general terms permit locking a server or account in relevant circumstances, and its system-policy page says violations can result in suspension of access to **all products**. For illegal-content cases, its published DSA process describes a more targeted IP lock after notice/deadline/manual review, but that process should not be assumed to describe every network-abuse incident. ([Hetzner](https://www.hetzner.com/legal/terms-and-conditions/))

That last point is one of the matters I would get clarified by Hetzner support before launch.

---

# 2. What each contract can actually enforce

| Property | Root + direct public ingress | Root + gateway-only | Managed workload, no root |
|---|---|---|---|
| Customer has Linux root | Yes | Yes | No |
| Customer can reconfigure guest firewall, sshd, routing, agents | Yes | Yes | No |
| Customer can create arbitrary listening sockets | Yes | Yes, but private only | Usually yes at app level |
| Provider/platform can prevent arbitrary **direct Internet ingress** | Only to the extent of the external Hetzner Firewall rules | **Yes**, because workload has no public interface | Yes |
| Authenticated app URL can be an enforced ingress path | **No**, if the VM also has reachable direct ingress | Yes, subject to egress-tunnel caveat | Yes, subject to egress-tunnel caveat |
| Direct SSH can be platform-controlled | Weakly: outer port/source rules only | Yes, through bastion/TCP gateway | Yes/no according to product |
| Can guest bypass guest-local firewall/agent? | Yes | Yes | Normally no |
| Can guest disable Hetzner Cloud Firewall? | Not with guest root alone; only if it obtains your Hetzner control-plane credentials | Workload has no Cloud Firewall because private-only servers do not support one | Same |
| Can malicious workload make outbound tunnels if general Internet egress exists? | Yes | Yes | Yes |
| Can you reliably attribute/control egress per tenant | One public VM/IP makes this relatively straightforward | Yes at your gateway, if designed per tenant | Yes at platform egress layer |
| Private-network tenant isolation | Only if you design it; Cloud Firewall does not cover private Networks | Must be explicit | Must be explicit |

The critical root boundary is therefore **outside the guest**. A Hetzner Cloud Firewall is outside the VM and root cannot simply `iptables -F` it. But it is still just a stateful L3/L4 allowlist: when no outbound rules exist, all outbound traffic is permitted; when rules do exist, non-matching traffic is dropped. It does not decide whether permitted HTTPS is a legitimate package download, malware C2, a reverse SSH tunnel, or an application proxy. ([Hetzner Docs](https://docs.hetzner.com/cloud/firewalls/faq/))

And a Cloud Firewall is expressly **not applied to Hetzner private Networks**. ([Hetzner Docs](https://docs.hetzner.com/cloud/firewalls/faq/))

---

# 3. Alternate paths a malicious root user gets

For a direct-public Cloud VM, consider all of these part of the customer attack surface: Primary IPv4; Primary IPv6 if provisioned; any Floating IP you assign; every inbound port your external firewall permits; every other workload on an attached private Network; and outbound-created connectivity.

IPv6 deserves particular attention. Hetzner assigns Cloud servers a `/64`, not merely a single conceptual IPv6 address. The default configuration uses the first address, and Hetzner documentation treats the `/64` as the server's IPv6 network. Do not build a policy around “the user only knows `…::1`.” ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/getting-started/connecting-to-the-server/?utm_source=chatgpt.com))

**Uncertainty:** the public documentation I found does not state as explicitly as I would like how Cloud Firewall matching is implemented across every address a guest configures from that assigned `/64`. I would confirm this with Hetzner before offering customer-controlled IPv6.

Hetzner Cloud Firewalls also deliberately always permit certain Hetzner infrastructure traffic, currently including resolver traffic, Rescue-system traffic, the metadata server and DHCP-related traffic. Those exceptions are not reasons to avoid the firewall, but they mean “no rule = literally no packets” is not its contract. ([Hetzner Docs](https://docs.hetzner.com/cloud/firewalls/faq/))

Private-only Cloud servers are different: Hetzner documents that they have **no public IPv4 or IPv6 connectivity, cannot have Floating IPs, cannot use Cloud Firewalls, and cannot use the Rescue system**. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))

That is a useful hard boundary for gateway-only root.

---

# 4. Private Networks are not tenant segments

Hetzner Networks are IPv4-only private L3 networks. Traffic in one Network is private/isolated from the public Internet, but **subnets within the same Network are not isolated from each other**. A server can be attached to up to three Networks. ([Hetzner Docs](https://docs.hetzner.com/networking/networks/faq/))

Consequently this is unsafe for hostile-root tenants:

`tenant A VM ─┐`
`tenant B VM ─┼── one shared Hetzner Network`
`gateway ─────┘`

Putting A in `10.0.1.0/24` and B in `10.0.2.0/24` does not fix it. Hetzner explicitly says traffic between subnets is possible, and its Cloud Firewall cannot protect that traffic. ([Hetzner Docs](https://docs.hetzner.com/networking/networks/faq/))

Hetzner does perform uRPF-style source validation on private Networks: packets whose source is not associated with that server/prefix are dropped, subject to the routes you create. That is useful anti-spoofing, but it is not east-west access control. Be particularly careful with broad routes because Hetzner notes that routes can expand which source prefixes a router is permitted to send. ([Hetzner Docs](https://docs.hetzner.com/networking/networks/faq/))

---

# 5. Concrete first topology: full root + direct public

A small sane version is:

```text
Clerk / Convex
     │
control API + provisioner
     │ Hetzner API
     ▼
Customer VM
  ├─ Primary IPv4
  ├─ optional Primary IPv6 /64
  └─ Hetzner Cloud Firewall
       ingress: only product-supported ports
       egress: explicit policy or unrestricted by contract
```

Do **not** attach these customer VMs to a shared management/tenant Hetzner Network. Manage them using the Hetzner API/control plane; if operator SSH is needed, permit a dedicated operator source through the external firewall.

For example, you can enforce externally that new public connections only reach TCP 22/80/443. Root cannot open public UDP 12345 if the Hetzner Firewall does not allow it.

But root can run anything whatsoever on those permitted ports. “Port 443” can be HTTPS, SSH-over-TLS, a VPN or an arbitrary encrypted protocol. With open egress it can also connect outward and expose services through third-party tunnelling infrastructure.

This contract therefore supports a promise like **“root VPS with a provider-enforced port policy.”** It does *not* support promises like “apps can only be reached through our authenticated URL” or “the firewall prevents network abuse.”

If you later point `customer.workloads.example` directly at the VM, Clerk/Convex cannot enforce access once packets reach the customer's server. Root can replace your auth agent, web server or TLS handling.

### Suspension

Do not implement emergency suspension by merely replacing the Hetzner Firewall with a deny-all rule. Hetzner states that Firewall changes apply only to **new connection attempts; established connections remain alive** until they end. ([Hetzner Docs](https://docs.hetzner.com/cloud/firewalls/faq/))

For this contract, a reliable emergency stop should therefore include **powering the VM off**. Removing/reassigning a Primary IP itself requires the server to be powered off. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/faq/?utm_source=chatgpt.com))

---

# 6. Concrete first topology: full root + gateway-only

For the first few tenants, use actual network separation rather than trying to make one shared Network safe:

```text
                    Internet
                       │
                 Gateway VM
                 public v4/v6
                /      |      \
       tenant Network A B       C
              │         │       │
          root VM A  root B  root C
          no public   no public no public
             IP          IP       IP
```

One gateway Cloud server can attach to at most **three** Hetzner Networks, so this deliberately small topology supports three isolated tenant Networks per gateway. Each customer VM has no Primary IP at all. ([Hetzner Docs](https://docs.hetzner.com/networking/networks/faq/))

The gateway is platform-controlled and performs three functions: TLS/application ingress, SSH/bastion ingress, and egress routing/NAT. Each customer-facing private interface gets its own forwarding and rate/policy rules. Do not expose management services on those tenant-facing interfaces.

For authenticated app URLs:

```text
*.customer-workload-domain
          ↓
gateway TLS
          ↓
Clerk/Convex membership check
          ↓
private tenant IPv4:port
```

This makes authentication an actual network-path control because the tenant has no alternative public NIC.

For SSH, the same principle works with a bastion or authenticated TCP/session gateway. Clerk/Convex membership should authorize the control-plane action/session; do not hand tenants Hetzner project credentials.

### The unavoidable egress qualification

If that gateway then provides arbitrary `0.0.0.0/0` NAT, root can initiate a tunnel to the Internet and regain externally reachable services.

So there are two honest variants:

**Gateway ingress + open Internet egress:** you enforce that there is no *provider-assigned direct public ingress*, but you explicitly accept that customers can create outbound tunnels.

**Gateway ingress + controlled egress:** destination/protocol restrictions, an HTTP(S) proxy, approved package mirrors/services, or another policy strong enough to constrain alternate tunnels. That materially reduces Linux/network freedom.

There is no combination that gives malicious root **unrestricted arbitrary Internet networking** while also guaranteeing that it cannot establish an alternate path. That is a fundamental product tradeoff, not a missing firewall rule.

A gateway model also concentrates blast radius. One egress IPv4 may represent several tenants; an IP reputation problem, block, DDoS or gateway failure can affect all of them. Keeping the initial gateway fan-out at the natural three-Network limit makes that risk comprehensible.

Private Hetzner Networks are currently IPv4-only, so these private root VMs do not natively receive private IPv6. The gateway itself can be dual-stack externally, but offering transparent arbitrary IPv6 networking through this design requires additional routing/tunnelling design rather than merely turning on IPv6. ([Hetzner Docs](https://docs.hetzner.com/networking/networks/faq/))

---

# 7. Concrete first topology: managed workloads without root

Start even more simply:

```text
Internet
   │
platform gateway
   │
one isolated private Network / customer
   │
platform-managed worker VM
   └─ customer processes, no SSH/root
```

Initially I would still use **one VM per customer**, rather than betting the business boundary on container isolation. The platform owns root, systemd/network configuration, kernel parameters, firewall and any workload supervisor. Customers can deploy applications but cannot modify those controls.

You can then enforce CPU/RAM/process/disk limits, application ports and egress on a trusted host/network layer. This is a real improvement over customer root.

But arbitrary customer application code remains capable of malicious network activity *within whatever egress you permit*. A Python process does not require root to open 10,000 TCP connections or connect to a tunnelling service. Accordingly, managed-without-root can enforce **configuration**, not magically make unrestricted egress safe.

This contract fits authenticated workload URLs best because there is no customer-controlled alternate ingress path.

---

# 8. Outbound abuse and mail

Hetzner blocks outgoing Cloud traffic on TCP **25 and 465 by default**. After the account has existed for a month and the first invoice has been paid, an unblock can be requested for a valid use case and is reviewed case-by-case. Port 587 remains available for authenticated external mail services. Most importantly for your architecture, Hetzner states that the 25/465 blocking is **account-level**. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))

This is a useful default but is not an anti-abuse system. Spam remains prohibited regardless of which port or relay is used. ([Hetzner](https://www.hetzner.com/legal/terms-and-conditions/))

For this service I would keep direct SMTP delivery disabled unless outbound mail is actually a product requirement. If customers need application email, route them toward external authenticated mail providers rather than getting account-wide port 25 opened.

Hetzner also monitors network metadata for behaviour associated with scans/DDoS and sends abuse notices; its dedicated-server locking documentation describes attacks, scans and incorrect network configuration as reasons products can be locked. ([Hetzner](https://www.hetzner.com/legal/digital-services-act/?utm_source=chatgpt.com))

That is provider detection/remediation, not permission to rely on Hetzner to police your tenants for you.

---

# 9. Quotas and blast radius

Hetzner's current Cloud defaults include **5 servers per account**, 8 dedicated-resource servers, 20 projects per account, up to 50 Cloud Firewalls across projects, and resource-specific limits. Limit increases are manually reviewed case-by-case. Hetzner explicitly says these limits exist partly to prevent abuse. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/overview/?utm_source=chatgpt.com))

Traffic warnings also are not hard quotas: Hetzner says its 75% and 100% traffic notifications do not cap usage; overage continues and is billed. ([Hetzner Docs](https://docs.hetzner.com/cloud/billing/faq/?utm_source=chatgpt.com))

So your customer quota system must live above Hetzner: number/type of VMs, storage, public IP eligibility, bandwidth/billing policy, concurrent sessions and perhaps egress ceilings. Clerk/Convex is suitable for deciding **who belongs to a tenant and what they purchased**, but those records need to drive provider/hypervisor enforcement; they are not themselves a security boundary.

---

# 10. Future move to VMs on dedicated hosts

This actually gives you a better security boundary if designed correctly.

Hetzner explicitly documents a **routed virtualization model** for dedicated servers in which VM traffic passes through the host, noting that this is useful/necessary when the host firewall must filter VM traffic. IPv4 subnets are routed to the dedicated server, and its `/64` IPv6 subnet can likewise be subdivided and routed onward. ([Hetzner Docs](https://docs.hetzner.com/robot/dedicated-server/ip/additional-ip-adresses/?utm_source=chatgpt.com))

That leads naturally to:

```text
Hetzner uplink
      │
 dedicated host
 [hypervisor root: platform only]
      │
 host routing + firewall + quotas
   ┌──┴────┬──────┐
 VM A     VM B    VM C
 root     root    managed
```

For customer-root VMs, use routed interfaces/tap devices so every packet crosses platform-controlled host routing/firewalling. Do not give customer VM root any hypervisor/host control.

Hetzner's Robot firewall is not a replacement for that host layer. It is a **stateless switch-port firewall**, applies to the entire dedicated-server port including vSwitch traffic, allows only ten rules per direction, and has significant IPv6 filtering limitations. Treat it as a coarse outer control. ([Hetzner Docs](https://docs.hetzner.com/robot/dedicated-server/firewall/?utm_source=chatgpt.com))

The routed approach is also preferable to casually bridging arbitrary VM MAC addresses. Hetzner's dedicated-server terms prohibit manually changing hardware addresses; bridged VMs require provider-issued virtual MACs for eligible single IPs, while routed subnets avoid exposing guest MACs upstream. ([Hetzner](https://www.hetzner.com/legal/dedicated-server/))

The main new blast radius is physical: a hypervisor outage or compromise now affects every tenant VM on that host. Conversely, host-level networking lets you enforce per-VM policy much more precisely than Cloud's private-Network model.

---

# 11. Decisions that must precede code

| Decision | Why it cannot be deferred |
|---|---|
| **Is customer root a raw-VPS contract or an authenticated-platform contract?** | Direct public root and mandatory platform-authenticated ingress are incompatible guarantees. |
| **What exactly is the egress promise?** Open Internet, port-restricted Internet, destination allowlist, or proxy-only fundamentally determines whether outbound tunnels and most abuse can be prevented. |
| **Does every root tenant get a public IP?** | Determines architecture, IPv4 cost/availability, attribution, IPv6 exposure and emergency suspension. |
| **What is the IPv6 product contract?** | Direct Cloud root gets a `/64`; gateway-only Cloud Networks are IPv4-only. This affects both security and customer expectations. |
| **What does “suspend” mean?** | If it means “no packets now,” public-root suspension must power off or otherwise tear down connectivity; a Cloud Firewall change alone leaves established sessions alive. |
| **Is one tenant = one VM/security domain?** | It should be for the first version, especially for root. This establishes the tenant-isolation boundary and future dedicated-host migration model. |
| **Will app URLs and SSH always traverse platform infrastructure?** | Determines whether Clerk/Convex membership can have enforcement significance rather than being merely control-plane bookkeeping. |

The marketing/control domain and customer-workload domain should indeed be separate registrable security origins if possible, but that is browser/application isolation. It does not substitute for the network decisions above.

---

# 12. Exactly what I would ask Hetzner support before launch

These are the questions for which the public material is either insufficient or where you need an answer specific to **your account/business model**:

1. **Third-party VPS product:** “We will programmatically provision Cloud Servers under our Hetzner account and grant unrelated paying end users administrator/root access. Later we may run their VMs on our Hetzner dedicated root servers. Please confirm this exact hosting/resale model is permitted under our account and whether any additional reseller, abuse-contact, verification, or contractual requirements apply beyond §§5/7/8 of the Terms.”

2. **Abuse blast radius:** “For an account operating many independent customer workloads, what resources may be suspended in response to one tenant's network abuse: offending IP only, one Cloud Server, one project, or the whole account? Can our account be handled operationally as a hosting-provider account with per-resource containment?”

3. **Abuse-response expectations:** “What response deadlines and escalation channel should we expect for phishing, malware, scans, DDoS or spam reports on an account hosting third-party workloads, and is there a recommended abuse contact/process for hosting providers?”

4. **SMTP status/scoping:** “Please confirm ports 25/465 will remain blocked for our account unless we explicitly request otherwise. If ever unblocked, can that exception be scoped to one project/server, or is it necessarily account-wide for all present and future Cloud Servers?”

5. **Cloud IPv6 enforcement:** “For a Cloud Primary IPv6 `/64`, may the guest use arbitrary addresses from the assigned `/64`, and does an attached Cloud Firewall identically enforce its ingress/egress policy for every usable address in that `/64`? Are there any relevant IPv6 traffic paths not covered by the Cloud Firewall?”

6. **NAT/gateway hosting:** “Is it acceptable to place several independent customer workloads behind a platform-operated Cloud NAT/egress gateway, and are there any abuse-handling or source-attribution requirements you expect us to meet when multiple customers share one public source IP?”

7. **Expected Cloud scale:** “Our service will create large numbers of short/medium-lived customer VMs, Primary IPs, private Networks and Firewalls through the API. What account limits are you prepared to approve for this use case, and is there a preferred project/resource layout for a hosting platform?”

8. **Dedicated-host IP plan:** “For our later model of running customer VMs on dedicated servers using routed networking, what quantities/prefix sizes of additional IPv4 and IPv6 addressing can be approved for this use case, what justification is required, and are there additional restrictions specific to assigning those routed addresses to third-party VMs?”

Until those answers arrive, I would mark **account-wide abuse containment, large-scale quota approval, Cloud `/64` firewall semantics, NAT-hosting expectations, and future dedicated IP allocation as provider-confirmation items**, not architecture facts.

### Recommendation

For the first product, the cleanest boundary is **one customer = one Cloud VM + full guest root + no Primary IP + one isolated Hetzner Network + platform-owned gateway**. A gateway can serve three such isolated Networks, making a three-tenant gateway cell a small, understandable starting unit. Let Clerk/Convex authorize gateway routing, SSH sessions and app-hostname access, not guest configuration.

Then make the egress choice explicit. If customers get arbitrary Internet egress, state that outbound tunnels are part of the power you are giving them and build rapid power-off/containment around that fact. If authenticated ingress must be non-bypassable, you cannot simultaneously promise root plus unrestricted networking.

The dedicated-host migration can preserve exactly the same logical contract by replacing the Hetzner private Network/gateway boundary with **platform-owned hypervisor routing/firewalling around one VM per tenant**. That is a much cleaner migration path than starting with shared private Networks or assuming guest-local agents remain trustworthy under root.
