# Evaluate SSH Tools

Source: https://chatgpt.com/share/6aa7756e-106c-83eb-ac21-302115690c74

---

## Turn 1: User

_2026-09-14T04:06:11.116Z_

We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Find and evaluate existing tools that remove real implementation work for this feature. Investigate native OpenSSH, Node SSH libraries such as ssh2, authorized-key parsers/editors, and configuration-management modules such as Ansible authorized_key. These names are starting points, not preferred winners; identify stronger candidates if supported by evidence.

Separate transport, key-material parsing, authorized_keys option parsing, sshd_config evaluation, safe filesystem mutation, and application orchestration. Do not count a library as covering a layer merely because it can execute arbitrary shell commands.

Inspect actual code and tests for option coverage, duplicate/repeated options, malformed input, preservation behavior, host verification defaults, certificates/FIDO, dependency footprint, license, and maintenance. Verify version and compatibility with Node 24, the target OpenSSH package, and hosted Convex where applicable. A recent release is not by itself evidence of correctness.

Return an adopt/adapt/write decision for each concrete responsibility, with the strongest simpler alternative. Supply small conformance probes that could disqualify a candidate. Do not recommend implementing cryptography or certificate encoding merely to avoid a dependency.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.

---

## Turn 2: ChatGPT

_2026-09-14T04:06:11.796Z_

I’ll treat this as a dependency due-diligence pass, not an architecture exercise: first pin the exact OpenSSH/Ubuntu/Node baselines, then inspect candidate source/tests layer by layer, and finish with adopt/adapt/write decisions plus disqualifying probes. I’ll explicitly separate what is verified from what is inferred or still unknown.

---

## Turn 3: ChatGPT

_2026-09-14T04:06:43.810Z_

The first baseline is already useful: Ubuntu 24.04 is still on OpenSSH Portable 9.6p1 with Ubuntu’s 13.19 patch level, while Convex now explicitly supports Node 24 actions. That means “works on current upstream OpenSSH” is not enough; candidates need to be checked against 9.6p1 semantics and Convex’s Node-action constraints.

---

## Turn 4: ChatGPT

_2026-09-14T04:07:48.451Z_

A second important finding is emerging: `ssh2` is a strong transport candidate but is unsafe if used “as documented defaults” because v1.17.0 explicitly accepts any host key when no verifier is supplied. Its transport algorithm set also omits OpenSSH certificate host-key algorithms and FIDO/SK key types, so those need explicit compatibility probes rather than being assumed from generic SSH support.

---

## Turn 5: ChatGPT

_2026-09-14T04:16:05.668Z_

## Recommendation

The best implementation is mostly **native OpenSSH + a small Composery-specific editor/orchestration layer**, not a large SSH-management dependency.

| Responsibility | Decision | Primary choice | Strongest simpler alternative |
|---|---|---|---|
| SSH transport from hosted backend | **ADOPT, conditional** | `ssh2` **v1.17.0**, pinned to commit `844f1ed…`, with mandatory host-key verification | Use native `ssh` in the client/agent instead of backend SSH where operationally acceptable |
| Public-key/certificate validation and fingerprints | **ADOPT native** | Target/client `ssh-keygen` from the installed OpenSSH package | For non-authoritative UI previews only, reuse `ssh2`'s parser for its supported classical key types |
| `authorized_keys` syntax/options | **WRITE** | Small lossless TS parser/editor, conformed against the target `sshd` | Avoid editing customer files at all: add a dedicated Composery `AuthorizedKeysFile` |
| `sshd_config` evaluation | **ADOPT native** | `/usr/sbin/sshd -T -C ...` on the server | If the effective configuration is immutable and entirely Composery-owned, persist the provisioned path—but still validate with `sshd` |
| Safe filesystem mutation | **ADAPT** | `ssh2` SFTP primitives + your own staged-write/CAS/rename protocol | Dedicated Composery-owned key file greatly simplifies this layer |
| Application operations/authz | **WRITE** | Convex operation layer; Node action only performs SSH side effects | None that preserves your “same operations/rules for UI and programmatic clients” requirement |
| Ansible/Augeas authorized-key editing | **DO NOT ADOPT** | Useful only as reference implementations/tests | Small focused editor is less code/risk for this product |

The most important simplification I found is worth challenging the current direction with: **do not make general-purpose editing of each customer's `~/.ssh/authorized_keys` the default.** OpenSSH natively permits multiple `AuthorizedKeysFile` paths. Keep the customer's normal file and add a Composery-controlled second file, for example an absolute per-user path using OpenSSH's supported tokens. Ordinary SSH remains independent, while Composery stops needing to preserve arbitrary customer formatting, comments, symlink arrangements, and concurrent edits for its own entries. OpenSSH 9.6p1 supports multiple files and resolves them as part of the daemon configuration. 

This alternative becomes less attractive if Composery must administer arbitrary pre-existing SSH authorizations rather than only authorizations created through Composery, or if customers may freely modify `AuthorizedKeysFile` through `Match` configuration.

---

## Decisive evidence

### 1. Pin the server semantics to Ubuntu's OpenSSH, not "SSH" generally

**Verified.** As of September 14, 2026, Ubuntu 24.04's current `openssh-server` is `1:9.6p1-3ubuntu13.19`; Ubuntu shipped that package for recent OpenSSH security fixes. This is **OpenSSH Portable 9.6p1 plus Ubuntu's patch series**, not OpenBSD-current and not pristine upstream 9.6p1. ([Ubuntu Packages](https://packages.ubuntu.com/noble-updates/openssh-server))

For upstream source inspection I pinned OpenSSH Portable tag `V_9_6_P1`, whose tag points to commit `8241b9c0529228b4b86d88b1a6076fb9f97e4a99`, dated December 18, 2023.  

**Recommendation.** Treat the actual Ubuntu `/usr/sbin/sshd` installed on each server as the final semantic oracle. Upstream source is useful for understanding behavior; it should not replace testing against Ubuntu's patched binary.

### 2. `sshd_config`: don't write a parser

**Verified.** OpenSSH already exposes exactly the evaluator you need. In Portable 9.6p1, `sshd -T` validates configuration and outputs effective settings; `-C` supplies connection properties such as `user`, `addr`, `host`, `laddr`, `lport`, and `rdomain`, causing applicable `Match` blocks to be evaluated. `-T` also includes the additional validity/key sanity checks of `-t`.  

**Decision: ADOPT.** Execute the installed `sshd -T -C user=...,...` and parse its simple normalized output. Do not reproduce `Include`, `Match`, first-value behavior, token expansion, or future Ubuntu/OpenSSH changes in TypeScript.

That also solves an important correctness problem with finding the real authorization source: `AuthorizedKeysFile` can name multiple files and may be changed by effective configuration. 

### 3. `authorized_keys` options are too semantic for generic key parsers

**Verified.** OpenSSH 9.6p1's accepted options include `restrict`, forwarding flags, `command`, `environment`, `from`, `expiry-time`, `permitopen`, `permitlisten`, `principals`, `tunnel`, FIDO `no-touch-required`/`verify-required`, and others. It explicitly permits repeated `permitopen` and `permitlisten`. 

More importantly, the actual parser does **not** have uniform duplicate semantics:

- repeated `command`, `principals`, or `from` is an error;
- `permitopen` / `permitlisten` accumulate;
- repeated `environment` entries preserve the first entry for a given variable name;
- repeated expiry times resolve to the earliest;
- flags are processed sequentially, so `restrict,pty` can re-enable PTY after `restrict`;
- unknown options, bad quoting, and dangling commas fail parsing. 

**Deduction.** A `{[optionName]: value}` model cannot faithfully represent the language.

**Decision: WRITE.** The parser does not need to implement cryptography. It needs to preserve the original line plus a tokenized, ordered option sequence and apply 9.6p1-compatible option validation for edits you expose. Use the installed OpenSSH binary as the acceptance oracle in conformance tests.

For untouched lines, preserve bytes rather than parse/serialize them unnecessarily.

---

## Candidate evaluation

### `ssh2` 1.17.0 — adopt for transport, not authorization semantics

I inspected exact release **v1.17.0**, commit `844f1edfc41589737671f96a4f4e76afdf46abd4`, released August 20, 2025. It is MIT licensed; direct required dependencies are `asn1` and `bcrypt-pbkdf`, with optional native CPU-feature dependencies.  

**Node 24:** good evidence. Its CI matrix explicitly includes Node 24.x on Linux, macOS, and Windows. I verified the CI definition, but I did **not** retrieve historical passing workflow results for the release commit, so this is evidence that Node 24 is intentionally tested, not proof that every v1.17.0 platform job passed. 

The major issue is host authentication. **With no `hostVerifier`, ssh2 v1.17.0 deliberately accepts the server host key.** The source literally follows the no-verifier branch with `"Host accepted by default (no verification)"`. 

Therefore:

> **PASS only if Composery always supplies a host verifier backed by an explicit trust policy. Auto-accept is a release blocker.**

Its built-in host-key algorithms cover conventional Ed25519, ECDSA and RSA variants, but its constants do not list OpenSSH certificate host-key algorithms or SK/FIDO host keys.  Its key parser likewise focuses on conventional RSA/DSA/ECDSA/Ed25519 formats and even contains a TODO for more thorough validation. 

So `ssh2` should be **transport**, not your definition of what Ubuntu OpenSSH considers a valid authorization key.

Hosted Convex is compatible with the package shape in principle: Node actions can now select Node **24**, and external npm packages are supported. ([Convex Developer Hub](https://docs.convex.dev/production/project-configuration)) Node-specific libraries must live in `"use node"` actions rather than queries/mutations. ([Convex Developer Hub](https://docs.convex.dev/functions/actions))

**Unknown:** I found no Convex primary documentation that explicitly promises arbitrary outbound raw TCP sockets such as `net.Socket` to port 22. Do not infer SSH connectivity merely from HTTP/external-service support. One deployed Convex probe can resolve this.

### Native `ssh` / `ssh-keygen` — strongest compatibility dependency

For client-side operation, native OpenSSH is the simpler transport when it is available. It buys you OpenSSH's own agent integration, certificates, security-key/FIDO behavior, known-host handling and algorithm evolution instead of recreating those areas in JS.

Ubuntu's current OpenSSH client package itself depends on `libfido2`, demonstrating that FIDO support is part of the target native stack. ([Ubuntu Packages](https://packages.ubuntu.com/noble/openssh-client))

For **key material**, use `ssh-keygen` for authoritative parsing/fingerprinting/certificate inspection where an OpenSSH executable is available. That avoids implementing certificate encoding or crypto solely to eliminate a dependency.

Condition making `ssh2` preferable: the executable cannot be assumed available—particularly on a cross-platform packaged agent—or you need a fully embedded Node transport. In that case use `ssh2`, but make its supported algorithm subset explicit.

### `sshpk` 1.18.0 — capable, but not worth adding here

Exact release **1.18.0**, commit `8df038598965802fe287715ab4389e56da2593c5`, tagged April 3, 2025, is MIT. It handles conventional SSH keys and has real OpenSSH certificate parsing code/tests.  

But it brings eight direct runtime dependencies including `jsbn`, `tweetnacl`, `ecc-jsbn`, ASN.1 and bcrypt code.  Its OpenSSH public-key reader is not an `authorized_keys` option parser and contains deliberately permissive recovery logic for malformed/whitespace-damaged input.  I found no SK/FIDO support.

**Decision: don't add it.** It would duplicate part of native `ssh-keygen` and part of `ssh2` without solving the hard option/editing layer.

### `@stacksjs/ts-ssh` 0.1.1 — reject for this stack

I inspected tag **v0.1.1**, commit `8019717ec34f717ac62e6b34bce7c967640f9443`. It is MIT and pleasantly small, but its implementation calls `Bun.CryptoHasher`, despite otherwise importing Node APIs, so it is not a Node-24-only dependency as shipped.  

Its authorized-key parser leaves options as one opaque string, lacks SK/certificate key types in its recognized type list, and the file parser silently skips lines it doesn't understand. Its tests cover useful malformed-key cases, but not OpenSSH option semantics or duplicate options.  

**Decision: reject.**

### Ansible `ansible.posix.authorized_key` 2.2.2 — reject as the editor

Exact inspected release **2.2.2**, release commit `e98d9a0756458be1ac710988498000973889075c`, released in July 2026. 

Its implementation exposes several concrete mismatches with your needs:

- options become a dictionary, so repeated names collapse;
- file entries are keyed by public-key blob, so two lines containing the same key with different restrictions/comments can collapse;
- recognized lines are serialized anew rather than preserved losslessly;
- it does perform sensible tempfile + atomic-move filesystem work. 

There is also an **open August 2026 PR** fixing a current serialization bug where commentless keys gain trailing whitespace, with new idempotency tests. 

This is particularly damaging because OpenSSH explicitly uses repeated `permitopen`/`permitlisten`, while Ansible's dictionary representation cannot retain them correctly.

**Decision: reject as parser/editor; borrow filesystem/testing ideas only.** Running Python/Ansible from Convex would also be disproportionate dependency weight.

### Augeas 1.14.1 — reject despite better preservation instincts

Ubuntu 24.04 packages Augeas **1.14.1-1build2**. ([Ubuntu Packages](https://packages.ubuntu.com/ca/noble/arm64/augeas-tools)) The exact upstream 1.14.1 tag points at commit `b993ce902243a6d7b607c3895b4f67789d69e245`. 

Its `Authorized_Keys` lens is simply too old for OpenSSH 9.6 semantics: it hard-codes options such as `command`, `environment`, `from`, `permitopen`, and older `no-*` flags, but has no `restrict`, `permitlisten`, `expiry-time`, FIDO options, etc. Its key-type regex also predates SK/FIDO and certificate forms. 

**Decision: reject.** It is a heavier native dependency yet still requires you to patch the grammar.

---

## Safe mutation

There is no library in this set that eliminates the responsibility cleanly.

`ssh2` does provide SFTP, including the OpenSSH rename extension, so it can eliminate protocol-level SFTP implementation work.  But “has SFTP” does not mean “safely edits an authorization file.”

**Recommendation: ADAPT SFTP primitives, WRITE the transaction.** For a Composery-owned file:

1. live-read content and file metadata;
2. compute edit against the exact version read;
3. create a temporary file in the same directory;
4. write complete new contents;
5. set intended permissions/ownership;
6. atomically replace using OpenSSH `posix-rename` when supported;
7. reject or retry if the source changed between read and commit.

For arbitrary customer-owned files, symlink behavior, ownership, directory permissions and concurrent local editors substantially increase the surface. That is another reason the second-`AuthorizedKeysFile` design is stronger.

---

## Application orchestration

**Decision: WRITE, but keep it thin.** Convex should own the application operation and platform authorization; the Node action is merely the side-effect adapter.

Convex's Node runtime is action-only, and actions do not directly participate in a database transaction; Convex itself recommends batching query/mutation interactions to reduce race windows. ([Convex Developer Hub](https://docs.convex.dev/functions/runtimes))

This fits the requirement that UI and programmatic clients use the same operations and rules: expose one application-level operation, authorize it against platform membership/permissions, then invoke the SSH adapter internally. Linux privileges remain server state, not a side effect of platform membership bookkeeping.

I would **not** bake automatic key deletion, membership→key ownership, persistent inventory, or reconciliation into this dependency layer; none is required by OpenSSH.

---

## Disqualifying conformance probes

These are deliberately small. A candidate that fails one should not silently become authoritative.

1. **Transport/host trust:** pin server host key A; replace server with key B. `ssh2` must abort before user authentication. A connection with omitted verifier must be considered a test failure.
2. **Convex:** deploy an actual Node-24 `"use node"` action using `net.connect`/`ssh2` to a controlled Ubuntu 24.04 server. PASS = TCP connection + verified SSH handshake; failure settles the hosted-Convex uncertainty.
3. **Option duplicates:** round-trip `permitopen="a:1",permitopen="b:2"` with both entries intact. Reject `command="a",command="b"`.
4. **Ordering:** compare `restrict,pty` with `pty,restrict` against Ubuntu's `sshd`; the model must not normalize them into an unordered set.
5. **Other repetition:** repeated expiry dates must yield OpenSSH's earliest expiry; duplicate environment names must match OpenSSH's first-entry behavior.
6. **Malformed syntax:** unmatched quote, unknown option and trailing comma must fail rather than be rewritten into something valid.
7. **File preservation:** a no-op operation must be byte-identical. Two lines containing the same public key but different options must remain two lines. A commentless line must not acquire whitespace.
8. **Key corpus:** compare your accepted/rejected result with Ubuntu's `ssh-keygen`/`sshd` for Ed25519, RSA, ECDSA, both SK/FIDO types, user certificates, CA authorization lines, malformed base64, inner/outer key-type mismatch and truncated blobs.
9. **Configuration:** fixtures containing `Include`, `Match User`, and multiple `AuthorizedKeysFile` entries must be resolved by `sshd -T -C`; don't assert against a home-grown parser.
10. **Filesystem:** exercise destination symlink, wrong ownership/mode, simultaneous external modification, interrupted upload and failed rename. The final file must always be complete old-or-new content, never partial.

I did **not** execute these product probes. I inspected upstream source/tests and current primary package/docs. The execution environment available to me here has Node 22 and no `ssh`/`ssh-keygen`, so claiming a Node-24/OpenSSH interoperability run would be false.

## Remaining decisions / unknowns

Only two things need product/environment evidence rather than more library analysis.

First, **host bootstrap trust**: `ssh2`'s default is unacceptable, but source inspection cannot decide whether Composery should pin a host key captured during provisioning, use another provider-authenticated source, or deliberately use TOFU. That trust anchor must be chosen before backend `ssh2` is production-ready.

Second, **raw TCP from hosted Convex** needs the one deployed probe above. Convex explicitly supports Node 24 and Node npm packages, but its public documentation I found does not make raw port-22 connectivity an explicit compatibility promise. ([Convex Developer Hub](https://docs.convex.dev/production/project-configuration))

Everything else is sufficiently resolved to proceed: **native OpenSSH for configuration/key truth, `ssh2` for conditional transport, a dedicated additional `AuthorizedKeysFile` where possible, and a small lossless Composery editor instead of Ansible/Augeas/general SSH-key libraries.**
