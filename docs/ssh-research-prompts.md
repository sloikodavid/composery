# OpenSSH research prompts for Composery

These are research requests, not accepted architecture decisions or implementation instructions.

## How to use this pack

Copy one complete fenced prompt into a fresh ChatGPT conversation. Each prompt repeats the relevant context so it can stand alone. Independent reports should not receive previous recommendations before their first analysis.

Start with 01-07 and 10. Run 08 alongside them because enrollment is a distinct boundary. Use 09 and 11 when provisional contracts exist. Supply the proposed design to 12 and 13. Use 14 after enrollment and connection contracts exist. Run 15 last with the reports; it is an evidence audit, not another independent vote.

There is no need to wait for all reports before implementation. Gate each slice on evidence relevant to its behavior and security boundary.

When reports are ready, share their conversation URLs. Import supported sources with `bun run research:import <url>`. If a source is unsupported, extend the importer rather than copying the conversation into docs/research manually. Imported reports remain evidence to verify, not instructions.

## Implementation readiness

- Discovery experiments can run now. They do not establish a production contract by themselves.
- Before production work on a slice, establish its authority model, supported inputs, dependencies, operation semantics, failure outcomes, and acceptance checks.
- Shared application operations must enforce policy for both UI and programmatic clients. Network adapters may differ without duplicating domain behavior.
- Stop a dependent slice when evidence exposes an unresolved product tradeoff or invalidates a trust or correctness assumption. Continue independent work where useful.
- Ask the user only for the unresolved tradeoff and its consequence, not for routine technical choices.
- Write concise durable rationale in docs/decisions.md when decisions are made. Rewrite outdated entries; do not treat existing prose or this pack as proof of implementation.
- Research cannot guarantee zero later refactoring. The aim is to resolve material uncertainty before committing to a boundary, then use small implementations and actual behavior as evidence.
- Code explains mechanisms. Keep non-obvious trust assumptions, supported-environment limits, and external setup requirements documented.

## Prompt index

- 01: Define the native feature boundary (Start now).
- 02: Audit every authorized-key option against source (Start now).
- 03: Safe edits when the server is authoritative (Start now).
- 04: Prove the Convex-to-server control mechanism (Start now).
- 05: Bootstrap trust, networking, and recovery (Start now).
- 06: Membership permissions and SSH authority (Start now).
- 07: One application API for UI and programmatic clients (Start now).
- 08: Agent enrollment without hidden authentication assumptions (Run independently of the server module).
- 09: Ordinary SSH and editor connection experience (After a provisional connection contract exists).
- 10: Select reusable tools and libraries (Start now).
- 11: Live reads, operations, and future enforcement (After the file-operation contract is understood).
- 12: Adversarial review of the trust boundaries (After a candidate architecture exists).
- 13: Failure experiments and implementation acceptance (After a candidate architecture exists).
- 14: Delighter adapters and capability limits (After enrollment and connection contracts exist).
- 15: Reconcile evidence and choose implementation slices (Run last with the reports).

## 01: Define the native feature boundary

When: Start now.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Determine whether OpenSSH offers a coherent bounded resource suitable for structured authorization management. Compare an authorized-key entry, a configured authorized-key file, and the account's configured authorization sources. Define exactly what each boundary includes and excludes, rather than equating any of them with all SSH access.

Investigate multiple files, path expansion, Match conditions, different daemon instances, AuthorizedKeysCommand, certificate authorities, and account discovery. Can a system enumerate all relevant file entries without claiming to enumerate all effective access? What context is needed to interpret a result? Distinguish a visible entry from an effective authorization.

Provide a resource-and-operation vocabulary suitable for a public API and structured forms, without designing layouts. Explain whether entry origin matters and how duplicate lines affect identity. Identify every assumption needed for a first supported server configuration. Do not assume that exposing more configuration is better, or that hiding it is simpler. Deliver a boundary proposal with counterexamples that would invalidate it.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 02: Audit every authorized-key option against source

When: Start now.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Build a complete inventory of authorized_keys entry types and options for a justified supported OpenSSH release, using Ubuntu 24.04's package as a concrete reference and identifying differences from current upstream. Include ordinary keys, FIDO keys, certificate-authority entries, and certificate-related options.

For each option, give syntax, allowed repetitions, defaults, parsing behavior, dependencies on other options and daemon policy, and effect at authentication or session time. Investigate ordering, duplicates, restrictive combinations, forced commands, source patterns, forwarding, expiry and timezone handling, user rc, environment, tunnel devices, and FIDO presence/verification.

Trace the relevant parsing and enforcement functions in source. Explain what sshd -t, sshd -T, ssh-keygen, or other native tools do and do not validate. Separate syntax validation from proof that the intended access works. Identify combinations that look restrictive but still allow arbitrary commands or another route to authority. Provide a versioned support matrix and representative executable probes. Do not invent product permission meanings for native options.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 03: Safe edits when the server is authoritative

When: Start now.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Design and challenge the smallest reliable mechanism for reading and editing selected authorized-key entries while the owner may edit files directly. Compare targeted edits with whole-file replacement using an expected revision; account for preservation of comments, formatting, unrecognized entries, and identical key material with different options.

Investigate symlinks, hard links, ownership, modes, ACLs, security labels, special files, read-only filesystems, size limits, encoding, path substitution, atomic rename, fsync and crash durability. Explain which risks matter in supported environments and what must be rejected rather than automatically repaired.

Analyze races with our own workers and independent writers. State exactly what locks, content hashes, and rechecks guarantee and cannot guarantee; do not describe a check followed by a rename as an atomic compare-and-swap without evidence. Analyze crash before/after a write, lost response, retry after a later external edit, and deletion of one duplicate entry.

Return an operation contract, minimal durable state if needed, recovery behavior, and fault-injection tests. No generic configuration-management engine unless the concrete requirements require it.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 04: Prove the Convex-to-server control mechanism

When: Start now.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Compare practical mechanisms for Composery to inspect and change the server's authorized-key configuration: backend-initiated SSH, a narrow server-side helper using outbound HTTPS, and any substantially simpler viable alternative. Evaluate the entire lifecycle under the same requirements, not just the file-write step.

Verify current Convex Node runtime support and constraints: outbound networking, execution duration, dependencies, connection setup, concurrency, scheduling, workpool behavior, retries, logging, and secrets. The repo currently uses Convex 1.45.0 and @convex-dev/workpool 0.4.11; distinguish package behavior from hosted platform constraints.

Cover initial bootstrap, network/firewall changes, per-server management authority, customer removal of the integration, replacement machines, and recovery. Establish whether any executable must remain on the VPS and what it can do. Compare least privilege with an explicitly administrative integration without assuming either is automatically appropriate.

Give a minimal deployment experiment proving a trusted remote read and one verified edit from the actual Convex environment. Mark anything requiring real credentials as an unexecuted deployment check. Do not assume local Node success proves hosted Convex success.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 05: Bootstrap trust, networking, and recovery

When: Start now.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Trace a complete trusted bootstrap for a fresh Hetzner Cloud Ubuntu VPS, from an authorized create request to independent customer SSH and authenticated backend management. Inspect Hetzner API documentation, image/cloud-init behavior, and OpenSSH source where useful.

Identify where management keys, customer keys, host keys, and any one-time bootstrap authority originate, travel, persist, and disappear. Compare concrete host-trust acquisition methods. Explain why each proves machine identity, rather than merely observing a network response. Account for cloud-init status, unavailable callbacks, duplicated delivery, provider action completion versus OS readiness, firewall rules, IPv4/IPv6, and secret exposure through metadata or logs.

Handle rebuilds, OS replacement, address reuse, restored disks, cloned snapshots, host-key rotation, and broken SSH. Separate provider recovery from ordinary key edits. Specify safe behavior if a machine or disk is not the expected identity. Do not assume host keys identify a unique allocation after cloning.

Give the minimum bootstrap and recovery protocol, dependencies on provider capabilities, and pass/fail experiments. Do not require customer SSH connections to depend on an online platform service afterward.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 06: Membership permissions and SSH authority

When: Start now.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Assess the consequences of separate ownership and platform memberships with permission checklists, including one initial Manage SSH permission. Ownership transfer is owner-only; grantable permissions default to enabled; members may delegate only authority they hold. The previous owner remains a member after transfer. Do not treat these product choices as Linux security properties.

Define what the blanket SSH permission authorizes. Distinguish reading public entries, modifying authorizations, selecting accounts, removing restrictions, possessing a private key, and administering the OS. Analyze indirect authority: a user who can authorize an unrestricted root key, restore a disk, or access management credentials may have more power than a label suggests.

Evaluate whether any per-person key mapping is needed under live server reads and no automatic SSH deletion on membership removal. Explain what can and cannot be inferred from key comments and fingerprints. Address permission removal while an operation is queued or running, owner transfer races, invitation acceptance, and account deletion.

Return enforceable invariants and a permission-check location for each operation. Keep OS account provisioning and per-key permission delegation outside the design unless a concrete requirement makes them necessary. Identify unresolved policy choices without multiplying permission switches by default.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 07: One application API for UI and programmatic clients

When: Start now.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Design a concrete application boundary for server operations and SSH authorization management that a Next.js UI, agent-assisted setup, and future external client can all use without duplicated policy or write paths.

The backend currently uses Convex functions, Clerk authentication, and durable server operations. Compare native Convex clients and HTTP endpoints where relevant. Do not assume that publicly callable Convex functions are automatically a suitable authenticated developer API. Distinguish shared application logic from identical network transports.

Specify authentication/authorization boundaries, request and result shapes, pagination or bounded live reads, idempotency, expected revisions, operation status, cancellation semantics, timeouts, rate limits, and errors. Distinguish authorization entry identity from key identity. Address member permission changes before remote dispatch and uncertain remote outcomes.

Determine the minimum external authentication design needed now and what can remain an adapter later without changing domain operations. Do not invent a broad token-scope system unless needed. Provide two concrete journeys, one through the UI and one through a programmatic client, demonstrating the same authorization and edit logic. Explain a simple module layout within one Convex-backed repository.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 08: Agent enrollment without hidden authentication assumptions

When: Run independently of the server module.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Investigate the browser-to-agent handoff for SSH setup. A person is authenticated on our website. Their local agent can normally execute commands and access the network, but may not control an authenticated browser, possess an API token, or have a preinstalled helper. Private keys and bearer enrollment authority should not be inserted into model-visible prompts or output. Minimal user interaction is a preference; expose any conflict with those requirements instead of silently dropping one.

Compare feasible handoffs on equal terms: explicit browser approval of a request, existing authenticated clients when available, separate delivery of authority, and any simpler mechanism you can justify. Distinguish an identifier from a bearer capability. Do not assume a public URL can authorize retrieval just because its response is not printed.

Cover request substitution, binding to the exact public key/account/options/server, replay, phishing, expiration, cancellation, retries, duplicate execution, cleanup, and failure after authorization but before installation. Distinguish avoiding accidental model disclosure from isolating secrets from an agent with filesystem access.

Return minimum user steps and prerequisites for each viable flow, then recommend one baseline with its tradeoffs. Reuse the ordinary authorization API; do not create a second SSH credential mechanism.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 09: Ordinary SSH and editor connection experience

When: After a provisional connection contract exists.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Derive a portable connection contract for ordinary OpenSSH, scp, sftp, rsync, Git over SSH, and VS Code Remote-SSH, using primary client documentation. Target Windows, macOS, and Linux. Separate guaranteed protocol behavior from tool requirements.

Investigate local key availability, ssh-agent, encrypted and hardware keys, IdentityFile, IdentitiesOnly, host verification, aliases, nondefault ports, IPv6, multiple accounts and keys, multiplexing, and preserving existing local configuration. Explain what a website can know and what must be resolved on the client's computer.

Assess server-level Connect actions and entry-level connection instructions without assuming either location exclusively. Verify documented mechanisms for opening VS Code and their extension/configuration prerequisites. Distinguish an authorized entry from a usable local connection. Identify native restrictions that prevent editor setup, shell use, forwarding, or file transfer.

Return machine-readable connection information, minimal setup steps, and executable cross-platform acceptance journeys. Do not claim a generated command works for every authorization or that a key's fingerprint locates its private file. Evaluate native expiry separately from terminating existing sessions; do not invent a temporary-key service.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 10: Select reusable tools and libraries

When: Start now.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Find and evaluate existing tools that remove real implementation work for this feature. Investigate native OpenSSH, Node SSH libraries such as ssh2, authorized-key parsers/editors, and configuration-management modules such as Ansible authorized_key. These names are starting points, not preferred winners; identify stronger candidates if supported by evidence.

Separate transport, key-material parsing, authorized_keys option parsing, sshd_config evaluation, safe filesystem mutation, and application orchestration. Do not count a library as covering a layer merely because it can execute arbitrary shell commands.

Inspect actual code and tests for option coverage, duplicate/repeated options, malformed input, preservation behavior, host verification defaults, certificates/FIDO, dependency footprint, license, and maintenance. Verify version and compatibility with Node 24, the target OpenSSH package, and hosted Convex where applicable. A recent release is not by itself evidence of correctness.

Return an adopt/adapt/write decision for each concrete responsibility, with the strongest simpler alternative. Supply small conformance probes that could disqualify a candidate. Do not recommend implementing cryptography or certificate encoding merely to avoid a dependency.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 11: Live reads, operations, and future enforcement

When: After the file-operation contract is understood.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Determine the smallest shared mechanism justified by current SSH management and plausible future server features. Current direction: live reads of authorized-key files, explicit edits, server state authoritative, no automatic restoration after an owner edits a key. Future features may explicitly maintain their own files while enabled, but their exact requirements are not yet known.

Distinguish observation, requested action, initial provisioning, and ongoing enforcement. Compare action-triggered work, on-demand refresh, scheduled checks, server events, and a helper. Explain what each adds and avoid building all of them by default.

Define which results are current observations, historical successes, pending work, uncertain outcomes, unsupported environments, or unavailable observations. Explain how an edit returns verification immediately and how an older read cannot overwrite a newer result. Consider independent capability degradation.

Recommend what belongs in an SSH-specific module, a shared remote-operation module, Convex storage/scheduling, or server-side code. Apply a deletion test to each proposed abstraction. Do not create a separate package, resource registry, generic desired-state engine, or file-block framework solely for unspecified future features. State the concrete future pressure that would justify extracting each one.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 12: Adversarial review of the trust boundaries

When: After a candidate architecture exists.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Review a candidate Composery SSH architecture that I will supply. If no candidate is supplied, identify the required inputs and review only the general boundaries; do not fabricate a design to approve.

Model separately an unauthenticated attacker, a member without SSH permission, a member with SSH administration permission, a malicious root-controlled VPS, a compromised client key, and a compromised management credential. Consider cross-server isolation, server identity substitution, restored/cloned disks, network access, and secrets retained by models or logs.

Inspect how root-controlled filenames, usernames, authorized-key options, comments, command output, and connection addresses reach privileged local or backend operations. Consider shell injection, terminal escape sequences, oversized input, symlink/path races, SSRF, and remote output treated as instructions. Distinguish changes the owner is entitled to make from attacks on Composery or another tenant.

Return concrete attack traces tied to operations and the smallest controls that stop them. Do not treat readback from an owner-controlled machine as attestation. Do not propose controls that require trusted in-guest enforcement against root. Separate release blockers from issues outside the explicit product promise.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 13: Failure experiments and implementation acceptance

When: After a candidate architecture exists.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Given a candidate architecture and supported feature matrix that I will supply, design a small high-value acceptance suite. If these inputs are missing, provide a parameterized plan and list the missing facts rather than selecting the architecture yourself.

Cover one successful journey through provisioning, manual key setup, live listing, option changes, independent customer SSH, and removal. Then prioritize experiments for lost responses, retry after external changes, overlapping edits, interrupted writes, malformed options, missing accounts, permission changes while queued, stopped servers, changed daemon configuration, unsupported environments, and replacement or restored machines.

For each experiment, identify the user-visible invariant, injected failure, observable pass/fail result, and which design decision failure would reopen. Separate tests possible with local OpenSSH from those requiring hosted Convex, Hetzner, or real desktop clients. Include resource cleanup and secret-safe outputs. Do not suggest billable or destructive experiments be executed without explicit task authorization.

Keep tests at truthful public boundaries; avoid an elaborate mock framework that proves only its own assumptions. State what each passing experiment does not prove. Define an evidence threshold for beginning each implementation slice and for calling the supported feature complete.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 14: Delighter adapters and capability limits

When: After enrollment and connection contracts exist.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Given the authorization API, enrollment handoff, and connection contract that I will supply, design the smallest agent-assisted setup experience that composes them. If those contracts are absent, identify dependencies and do not invent replacements.

Compare a local coding agent with shell access, an agent with an authenticated connector/browser, and a cloud conversation without access to the user's machine. Do not assume any named product has tools or permissions without current official evidence. Distinguish research instructions, executable setup, and ongoing remote work.

Define what belongs in tool-neutral instructions versus a tool-specific adapter. The manual user and the agent must register keys through the same application operation. Explain whether setup instructions are generated at server level or for a selected authorization, how existing keys and repeat setup work, and how completion is verified without exposing secrets. Do not create a credential on every click or connection.

Give concise example instructions for each supported capability class, required user interactions, and unsupported cases. Show how an editor action consumes established SSH configuration rather than creating another access system. Avoid adding product-specific plugins, downloadable helpers, or accounts unless their concrete benefit exceeds the extra lifecycle they introduce.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

## 15: Reconcile evidence and choose implementation slices

When: Run last with the reports.

```text
We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: I will provide independent research reports about Composery SSH management. Audit their evidence before synthesizing them. If the reports are not supplied, ask for them rather than inventing conclusions.

Build a claim ledger: claim, primary evidence and exact version, confidence, contradictory evidence, and design consequence. Do not vote by how many reports agree. Trace disagreement to different requirements, environments, versions, or unsupported assumptions. Recheck the decisive primary sources.

Separate product requirements from architecture preferences and distinguish choices actually made by the user from suggestions inside reports. Identify any impossible combination of requirements. Propose the smallest coherent design that satisfies the supported contract, and challenge it with its strongest simpler alternative.

Produce a sequenced implementation plan. For each slice list the behavior delivered, prerequisites already established, remaining blockers, module ownership, operation contract, pass/fail experiment, and stopping condition. Distinguish required user judgments from technical questions the implementation agent should resolve. Preserve a shared application path for UI and programmatic clients.

Do not require all conceivable future research before coding. Do not begin a slice whose unresolved assumption could invalidate that slice. Clearly state which production slice can start now, which work is only an experiment, and what evidence would require revisiting a decision. Finish with a short list of explicit exclusions and their reasons.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

