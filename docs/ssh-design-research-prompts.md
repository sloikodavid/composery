# SSH design research prompts

Paste one complete prompt into a fresh conversation. Each one stands alone and states facts and questions, never a preferred answer. Import each finished conversation with `bun run research:import <url>`. Delete this file when every report is imported.

## 01: What a control panel can honestly manage about SSH access

```text
Context: A company sells Linux VPS instances. Each customer has root on their instance and may change or replace anything, including the SSH server and the operating system. A web control panel reaches each instance over SSH with its own key, installed at creation through the provider's first-boot mechanism. The company wants the panel to manage SSH access, and it wants the instance to stay the authority: no copy of access state in the panel's database.

Question: What are the possible resources a control panel could manage for SSH access, where exactly does each boundary lie, and which boundaries can be stated to a customer without overstating what the panel controls?

Compare at least: an entry in an authorized_keys file; a whole authorized_keys file; every authorized key source that applies to one account, including AuthorizedKeysCommand and certificate authorities; the SSH server configuration; an account on the machine; and an external access service that authenticates at login instead. For each: what a panel can enumerate, what it can change, what it can promise, what it cannot see, what happens when the customer changes the same thing by hand, and how it fails when the machine is unreachable or no longer runs OpenSSH.

Also examine whether managing more than one of these together creates claims that are false in combination, for example presenting a per-key restriction as a limit on what the account can do.

Evidence rules: cite OpenSSH source and man pages at exact versions, and product documentation with dates. Separate what is verified from what is inferred. Give counterexamples that would invalidate each boundary. Do not assume that a larger surface is better, or that a smaller one is safer.
```

## 02: Permissions for shared machines where the machine's owner can bypass the panel

```text
Context: A web control panel lets several people collaborate on one Linux server. The panel can start and stop the machine, rename and delete it, manage who collaborates, and edit the SSH authorized_keys files on the machine. Anyone whose key is authorized can sign in and change those same files directly, with no panel involved. Customers are a mix of non-technical people and experts.

Question: How should collaborator permissions be designed for a system in which some actions are enforceable by the control plane and others can be undone by anyone who can sign in to the machine?

Cover: which permission boundaries are enforceable and which are only conventions; how existing products draw this line (server management panels, infrastructure consoles, access proxies, and team-based SSH products); whether a permission that can be bypassed is still worth having and how such products describe it; ordered permission levels compared with independent flags; permissions that imply others, and the failure modes of automatic dependencies; how removal of a person is handled when their access no longer depends on the product; and how these systems word what a permission does and does not guarantee.

Give examples of wording and models that were later found misleading, and what replaced them.

Evidence rules: cite product documentation and, where available, source, with dates. Separate evidence from opinion. State which designs are common because they are correct and which are common because they are easy.
```

## 03: Re-establishing trust in a machine's identity after a legitimate change

```text
Context: A control plane connects over SSH to customer machines. At creation, a machine generates its host key and reports it through an authenticated one-time callback, and the control plane pins it against the machine's durable identity rather than its IP address. Customers have root, so they may regenerate host keys, reinstall the operating system, or replace the SSH server. Addresses are recycled between machines. The provider offers no signed instance identity document.

Question: When a machine legitimately presents a new host key, what protocols exist to re-establish trust, and how do they compare?

Cover at least: a fresh one-time enrolment token that a person runs on the machine; re-imaging so that first boot enrols again; OpenSSH host certificates with a certificate authority; UpdateHostKeys and what it can and cannot do; DNS with DNSSEC; provider console or metadata channels; and an operator approving a fingerprint by hand. For each: what an attacker must control to defeat it, what the customer must do, how it behaves when the customer is the attacker, how it degrades when the machine is unreachable, and the operational cost of running it.

Also cover how products present a failed host key check to a non-expert without training them to click through warnings.

Evidence rules: cite RFCs, OpenSSH documentation at exact versions, and provider documentation with dates. Give a concrete counterexample for every method. Say plainly where a method only moves the trust problem somewhere else.
```

## 04: Changing a file on a machine you do not exclusively control

```text
Context: A control plane edits small configuration files on customer Linux machines over SSH. The customer has root and may edit the same file by hand, with any editor, at any moment. The control plane reads the file and its metadata, computes new content from what it read, and writes the file back. It must never lose an edit silently, never report success when the result is unknown, and never leave the file in a partial state. It cannot install a daemon on the machine, and it cannot expect other tools to cooperate with a locking convention.

Question: What are the established techniques for changing a file safely under these conditions, and what does each one actually guarantee?

Cover: read, modify, write with a comparison of the observed bytes and metadata; advisory locking and why other writers may ignore it; the atomic rename pattern and what it does and does not prevent; file descriptor based checks against path substitution; detecting a change between the last check and the rename; preserving ownership, permissions, extended attributes, ACLs and security labels; behaviour on unusual filesystems and with hard links or symlinks; and how to classify an outcome as unknown rather than as success or failure.

Include the conventions that widely deployed tools follow when editing shared files such as authorized_keys, sudoers, or /etc/passwd, and what those tools do about concurrent editors.

Evidence rules: cite manual pages, source, and standards with versions. Give a reproducible demonstration for each guarantee and each gap. State clearly which risks cannot be removed and are therefore a matter of disclosure rather than engineering.
```

## 05: Giving an automated agent access without a human step

```text
Context: A customer of a VPS control panel wants an AI coding agent, running on their own computer, to connect to their server over SSH. The customer is signed in to the panel and copies a prepared prompt into the agent. The agent has a terminal and can generate its own key pair. The panel wants the flow to need no further human action, while the customer keeps a clear way to see and revoke what the agent obtained.

Question: What protocols exist for granting a program access on a person's behalf with no interactive approval step, and what are their real security properties?

Compare at least: a short-lived single-use bearer token carried in the prompt; a device or code flow where the program shows a code and the person approves in a browser; the program submitting its own public key for later approval; a downloaded credential file; a local helper the person installs; and any protocol used by current developer tooling for the same purpose. For each: what an attacker who reads the prompt obtains, what an attacker who intercepts the network obtains, what the person must do, and what a log or an AI provider retains.

Also cover how a prompt can carry a secret so that a cooperating program does not print it and does not send it to a model, and whether such conventions can be relied on.

Evidence rules: cite specifications, product documentation, and source with dates. Distinguish what a protocol guarantees from what it merely encourages. Give the failure case for each option, including where the person is careless.
```
