# SSH research audit

Status: evidence review and proposed implementation gates, 14 September 2026. This document does not change product decisions or claim that production SSH management exists.

## Reports received

All nine conversations were imported with `bun run research:import`. Eight contain substantive answers. The option inventory contains only the prompt and progress messages.

| Prompt | Imported report | Assessment |
| --- | --- | --- |
| 01 | [Resource boundaries](research/2026-09-14-openssh-resource-boundaries.md) | Useful distinction between a file entry and all effective SSH access. Proposed resource schemas are recommendations. |
| 02 | [Option inventory](research/2026-09-14-new-chat.md) | Incomplete. No final inventory to audit. |
| 03 | [File editing](research/2026-09-14-design-authorized-keys-editing.md) | Useful preservation and failure analysis. Hashes do not provide operation identity or exclude independent writers. |
| 04 | [Management transport](research/2026-09-14-compare-ssh-management-mechanisms.md) | Repository findings refer to another repository state. Hosted transport and bootstrap remain untested here. |
| 05 | [Bootstrap trust](research/2026-09-14-bootstrap-ssh-trust.md) | Identifies trust requirements. Its custom bootstrap protocol is an untested proposal. |
| 06 | [Membership permissions](research/2026-09-14-assess-ssh-permissions-design.md) | Supports separating platform permission from SSH authority. Some lifecycle proposals conflict with existing choices. |
| 07 | [Application API](research/2026-09-14-design-ssh-api-boundary.md) | Shared operations are useful. Dedicated files, persisted snapshots, timeouts, and grant mechanisms are optional design proposals. |
| 08 | [Agent handoff](research/2026-09-14-ssh-handoff-comparison.md) | Browser approval of an immutable public-key proposal is a candidate. It still needs a product choice and an end-to-end proof. |
| 10 | [Libraries](research/2026-09-14-evaluate-ssh-tools.md) | Transport candidates are useful. Its claim about Ansible losing repeated options is incorrect. |

These answers are not independent votes: they share a supplied product framing. Agreement is not a substitute for source evidence or executable checks.

## Findings that affect implementation

### An entry is an occurrence, not a fingerprint

The same public key can occur more than once with different restrictions. A local authentication experiment succeeded through a later duplicate when an earlier entry's source restriction failed. An edit must identify the intended occurrence within an observed file revision. A fingerprint identifies key material; it cannot identify which occurrence to remove.

Option order also matters: the local server permitted a terminal for `restrict,pty` and denied it for `pty,restrict`. Two `command` clauses rejected authentication. Preserve ordered options and untouched bytes; do not reduce the file to a set of keys or an unordered options object. The parsing order is visible in [OpenSSH 9.6p1 auth-options.c](https://raw.githubusercontent.com/openssh/openssh-portable/V_9_6_P1/auth-options.c).

### Configuration inspection has a narrower meaning than live daemon inspection

The experiment changed the configuration file to `AuthorizedKeysFile none`. A new `sshd -T` process reported that value while the already running daemon continued to accept the key under its original configuration. Therefore, output from that command is evidence about the supplied on-disk configuration and context, not proof of every running daemon's loaded settings.

The experiment also showed that `sshd -t` accepted a server configuration whose authorized-key file contained an invalid option. Actual authentication rejected that entry. Configuration validation, entry validation, successful authentication, and permitted session behavior need separate checks.

### Atomic replacement is not conditional replacement

A content hash can detect a changed snapshot. An advisory lock can coordinate Composery operations. Atomic rename prevents readers from seeing a partially replaced file. None of these stops an independent writer from changing the target between a final check and replacement. Linux [rename semantics](https://man7.org/linux/man-pages/man2/rename.2.html) do not offer replacement conditional on an expected content hash.

The file-edit report recognizes this limit. Other reports use "CAS" too loosely. We must not promise that arbitrary simultaneous external edits can never be overwritten. Moving to a dedicated file reduces normal contention but changes the product boundary and does not prevent root from writing it.

A separate retry problem remains: bytes can change from A to B and back to A. The original hash then matches again. Our local check reproduced this. A file revision cannot prove that an earlier operation never ran. Mutation identity, uncertain outcomes, and retry policy need their own contract.

### There are real errors in the reports

The library report says Ansible collapses repeated options because it uses a dictionary. In the reviewed version, `keydict` explicitly preserves insertion order and multiple values. However, `parsekeys` indexes entries by the key blob, so duplicate key occurrences are collapsed there. The latter is relevant to a lossless occurrence editor; the former criticism is false. See [ansible.posix 2.2.2 source](https://raw.githubusercontent.com/ansible-collections/ansible.posix/2.2.2/plugins/modules/authorized_key.py).

The transport report discusses `composery-web`, an existing `ssh2.Client`, and `SSH_PRIVATE_KEY`. Searches of this workspace's backend and package manifest found none of those SSH integration symbols. Its alleged current host-verification bug must not be recorded as a finding about this implementation. Host verification remains a requirement for any transport we add.

The membership report reopens the former owner's permissions and proposes a different owner-deletion policy. Those are product recommendations, not SSH requirements. They do not supersede the prior ownership discussion or the existing account-deletion decision.

## Product boundary carried forward

The working direction is structured management of native authorized-key entries for supported accounts and files, with the server as the source of truth. It does not require a raw text editor, a persistent key inventory, automatic restoration, or key ownership tied to membership.

One blanket SSH administration permission can govern these application operations. It is separate from the user's Linux authority and from other platform permissions. Removing membership does not automatically remove SSH entries. Editing authorizations for a privileged account can confer that account's authority; native key restrictions do not constrain an administrator who can remove those restrictions.

The UI, a future public API, and Delighter must share application operations and authorization checks. Authentication adapters can differ. Reports proposing bearer grants or an extra browser approval do not settle the handoff UX.

The current code and `docs/decisions.md` still describe the older owner/write/read role model. The membership redesign remains implementation work. This audit does not silently migrate that model or replace its decision record.

## Local evidence

The disposable probe in `tmp/ssh-boundary-probe/` passed all 18 checks against extracted Ubuntu package `openssh-server` `1:9.6p1-3ubuntu13.19` in WSL. It used generated fixture keys, explicit host trust, and a loopback daemon. It did not install a system SSH service or modify a customer server.

The checks cover authentication through two configured files, immediate remote write/readback, subsequent-login effects, removal with an existing session, invalid options, option order, duplicate entries, loaded-versus-disk configuration, content revisions, and advisory locking. The script and results remain disposable evidence; production tests must reproduce relevant behavior in their own fixtures.

This is not proof of hosted Convex connectivity, automatic bootstrap trust, crash-safe production writes, complete option support, arbitrary configuration discovery, or the Delighter journey.

## Implementation sequence and gates

| Slice | What can start | Required result before advancing |
| --- | --- | --- |
| Native file model | Lossless parsing and pure edit planning for a concrete file observation; finish the missing option matrix alongside it. | Unchanged bytes round-trip exactly; duplicates remain distinct; ordered options retain meaning; malformed or unsupported content is preserved; ambiguous edits fail explicitly. |
| Trusted read | A hosted transport experiment against a disposable server with independently established host trust. | The actual Convex deployment reads the intended file; a wrong host key fails; unavailable access is reported accurately; output and time are bounded. |
| Production mutation | After filesystem and operation contracts are explicit. | Target-path and metadata handling, conflict behavior, cooperating-writer serialization, durable outcomes, lost replies, retries, and readback have executable acceptance checks. The external-writer limitation is explicit. |
| Memberships and adapters | Implement the agreed policy through shared application operations. | Delegation and ownership rules hold; queued work rechecks authority at a defined dispatch boundary; removal is not presented as undoing an already dispatched remote effect. |
| Manual connection | After trusted management and mutation work end to end. | A client-held key can connect using the correct account, endpoint, and host trust; ordinary SSH continues without the platform. |
| Delighter | After the handoff authority channel is chosen. | An unauthenticated agent cannot gain write authority from public prompt text alone; approved setup invokes the same operations as manual setup. |

The first slice is ready to begin. Its interface can use file bytes and explicit edit requests without committing to a transport, database inventory, or general server-state framework. Full structured option support is not ready to be declared complete until the missing inventory is finished and checked against the target version.

Production mutation and automatic provisioning are not yet ready to call settled. The next engineering work should resolve those gates through small proofs rather than another broad architecture conversation. Only a product tradeoff that evidence cannot resolve needs a user decision.

## Completion rule

For each promised operation, specify supported inputs, who may request it, what successful output proves, and behavior after conflict, loss of access, interruption, and external modification. The feature is complete when those contracts pass their tests across the supported environment and the manual journey works through the shared API. Unknown or unsupported conditions must produce an honest result instead of a fabricated current state.

The number of research reports, their confidence, and their agreement are not completion metrics. A new finding changes a decision only when it changes a stated requirement, falsifies an assumption, or fails an acceptance check.
