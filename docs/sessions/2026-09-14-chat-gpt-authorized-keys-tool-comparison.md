# Authorized Keys Tool Comparison

Source: https://chatgpt.com/share/6aa874ee-da54-83ed-ab59-5a35f77912a8

---

## Turn 1: User

_2026-09-14T22:01:38.894Z_

Context: A web control panel edits OpenSSH authorized_keys files on customer Linux machines through structured forms. The files are the source of truth. Requirements: preserve every unchanged byte, keep duplicate keys as separate entries, keep option order, support every native option, and represent unknown or malformed content without losing it.

Question: Which existing libraries, tools, and products parse or edit authorized_keys files, and how well do they meet these requirements?

Cover at least: Go golang.org/x/crypto/ssh, Node.js sshpk and ssh2, Python paramiko and asyncssh, Ansible ansible.posix.authorized_key, Puppet ssh_authorized_key, Chef and Salt modules, cloud-init, the Google Compute Engine guest agent, AWS EC2 Instance Connect, Teleport, and any other parser you find. For each: language, license, maintenance activity, whether it preserves unknown bytes, duplicates, option order, repeated options, quoting, comments, and line endings, which options it understands, and known bugs.

Also design a test corpus of authorized_keys files that would reveal these differences, and state the result each tool gives for it where you can verify it.

Evidence rules: Cite source code at exact versions or commits. Separate verified behavior from documentation claims. Include cases where a well-known tool loses or changes data.

---

## Turn 2: ChatGPT

_2026-09-14T22:01:39.011Z_

I’ll treat this as an interoperability/data-fidelity survey, not just a parser API comparison. I’ll separate “verified from code/tests” from “documented/claimed,” pin evidence to concrete releases or commits, and call out destructive edit paths explicitly.

---

## Turn 3: ChatGPT

_2026-09-14T22:02:30.155Z_

The first important distinction is already clear: most “SSH key parsers” are key-blob parsers, not lossless `authorized_keys` document parsers. For example, current Go `x/crypto/ssh` deliberately skips invalid/comment lines and returns semantic fields; `MarshalAuthorizedKey` re-emits only `type + base64 + LF`, so it cannot be a byte-preserving editor.

---

## Turn 4: ChatGPT

_2026-09-14T22:04:12.422Z_

A second key finding: configuration-management tools differ sharply in *how* they damage fidelity. Ansible 2.2.2 keys its parsed map by the base64 key, so duplicate key blobs collapse; its option parser uses an ordered dictionary but repeated option names overwrite earlier values, and any write serializes normalized syntax.  Cloud-init is more preservation-aware: it retains an original `src_line` object for unparseable entries, but still reads with `splitlines()` and later rejoins with `\n`, so mixed/original line endings cannot survive an update.

---

## Turn 5: ChatGPT

_2026-09-14T22:15:19.852Z_

## Bottom line

I did not find an existing library or product that satisfies all of your requirements.

The fundamental mismatch is that most libraries model an `authorized_keys` line as a **semantic SSH public key plus optional metadata**, while you need a **lossless concrete-syntax document model**. Configuration-management tools come closer to editing the file, but almost all normalize, deduplicate, regenerate, or discard some content.

For a control panel where the on-machine file remains authoritative, I would **not** use any of these tools as the storage/parser layer. I would build a byte-preserving parser/editor, using OpenSSH itself as the semantic reference/validator.

I reviewed source pinned to releases/tags where possible. In the tables below:

- **V** = verified directly from pinned source.
- **D** = documented behavior, but I did not verify the complete implementation path.
- **?** = I could not establish the behavior strongly enough to claim it.
- “Preserves” means after an edit elsewhere in the file, not merely “can read it.”

### Why exact option order really matters

This is not just a cosmetic requirement. OpenSSH 10.5p1 parses options sequentially. For example, `restrict` clears forwarding/PTY/user-rc permissions, while later positive options such as `pty` can turn permissions back on. Therefore:

```text
restrict,pty ...
```

and

```text
pty,restrict ...
```

do **not** have the same semantics. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth-options.c))

OpenSSH also gives different repeated-option semantics depending on the option: multiple `command`, `principals`, or `from` clauses are errors; repeated `expiry-time` effectively takes the earliest time; repeated `environment` values are allowed but the first occurrence of a given environment variable name wins; `permitopen` and `permitlisten` accumulate. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth-options.c))

That rules out any internal representation of options as a simple map.

OpenSSH 10.5p1 currently recognizes key types including FIDO security-key forms, ECDSA, Ed25519, RSA, and `ssh-mldsa44-ed25519@openssh.com`. Its file grammar is `options keytype base64 comment`, with the options field optional, and quotes permit spaces and escaped quotes. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

---

# Comparison

| Tool / pinned source | Lang. / license | Maintenance | What it really parses/edits | Fit for lossless source-of-truth editing |
|---|---|---|---|---|
| **OpenSSH 10.5p1** `V_10_5_P1` | C / BSD-style mix | Active upstream | Canonical server grammar/semantics | Reference implementation, not a lossless editing API |
| **golang.org/x/crypto/ssh v0.57.0** | Go / BSD-3 | Active; v0.57.0 Sep 2026 | Individual authorized-key entries | **No** |
| **sshpk v1.18.0** | JS / MIT | Release line relatively quiet | Individual public keys | **No** |
| **ssh2 v1.17.0** | JS / MIT | Maintained; 2026 repo activity | Individual public keys | **No** |
| **Paramiko 5.0.0** | Python / LGPL-2.1 | Active; May 2026 release | Individual public-key blobs | **No** |
| **AsyncSSH 2.24.0** | Python / EPL-2.0 or GPL-2+ | Active; Jun 2026 release | Real `authorized_keys` parsing for authorization | Better semantic parser, still **No** |
| **ansible.posix.authorized_key 2.2.2** | Python / GPL-3+ | Active | Whole-file config-management editor | **No — duplicate-key loss/normalization** |
| **puppetlabs-sshkeys_core 3.0.2** | Ruby / Apache-2.0 | Active; Aug 2026 release | Parsed-file resource provider | **No** |
| **Chef `ssh_authorized_keys` 1.0.0** | Ruby/Chef / Apache-2.0 | Stale; Aug 2020 | Declarative whole-file generator | **Strong no** |
| **Salt 3008.2 SSH module** | Python / Apache-2.0 | Active; Jul 2026 | Whole-file reader/editor | **No — several destructive paths** |
| **cloud-init 26.2** | Python / repo carries Apache-2.0/GPLv3 licensing | Active; Jul 2026 | Tolerant whole-file parser/editor | Closest of CM tools, but **No** |
| **GCE guest agent 20260903.00** | Go / Apache-2.0 | Very active; Sep 2026 | Marker-based text rewrite | Not a general parser; **No** |
| **AWS EC2 Instance Connect** public repo 1.1.17 / packages later | Shell / Apache-2.0 | Public source/release history uneven | `AuthorizedKeysCommand`, not file editor | **N/A**, architectural alternative |
| **Teleport 18.10.x** | Go / mixed AGPL/Apache licensing | Active | CA + OpenSSH configuration | **N/A**, architectural alternative |
| **Augeas Authorized_Keys lens 1.14.1** | C/lens DSL / LGPL-2+ | Lens relatively old | Concrete config-file tree | Interesting architecture, grammar too stale |
| **RustCrypto `ssh-key` 0.6.7** | Rust / MIT or Apache-2.0 | Maintained library | Authorized-keys iterator/parser | **No** |

---

## 1. Go: `golang.org/x/crypto/ssh`

**Pinned source:** `golang.org/x/crypto/ssh` **v0.57.0**. ([GitHub](https://github.com/golang/crypto/blob/v0.57.0/ssh/keys.go))

`ParseAuthorizedKey()` is probably the most commonly mistaken candidate. It is useful for extracting semantic keys, but its contract is almost the opposite of yours. It splits input into lines, trims whitespace, skips blank/comment/invalid lines, and returns the first valid key plus a `rest` slice. Its option splitter is quote-aware and returns options as an ordered `[]string`, so **option ordering and repeated option strings can survive parsing of one valid line**. A caller which repeatedly consumes `rest` can also observe duplicate valid keys as separate occurrences. ([GitHub](https://github.com/golang/crypto/blob/v0.57.0/ssh/keys.go))

But skipped malformed/comment content has no node in the model. Exact whitespace and EOL representation are not retained. `MarshalAuthorizedKey()` is especially important: it emits only the public-key type, base64 wire blob, and `\n`; it does not serialize options or the comment. ([GitHub](https://github.com/golang/crypto/blob/v0.57.0/ssh/keys.go))

It doesn't semantically “understand” authorized-key options at all; they are returned as strings. The public-key-type switch also lags OpenSSH 10.5p1: v0.57.0 includes RSA, DSA, ECDSA, Ed25519 and FIDO SK types but not the new `ssh-mldsa44-ed25519@openssh.com` type. Compare the Go source with OpenSSH's current list. ([GitHub](https://github.com/golang/crypto/blob/v0.57.0/ssh/keys.go))

**Verdict:** a useful secondary key decoder, but unsuitable as the document parser.

---

## 2. Node.js: `sshpk`

**Pinned source:** `sshpk` **v1.18.0**, `lib/formats/ssh.js`. ([GitHub](https://github.com/TritonDataCenter/node-sshpk/blob/v1.18.0/lib/formats/ssh.js))

This is a **single-key parser**, not an `authorized_keys` document parser. Its SSH reader expects roughly:

```text
type base64 [comment]
```

An option-prefixed authorized-key line therefore doesn't fit its model.

There is also a particularly bad fidelity property: before parsing, the reader converts a Buffer to an ASCII string and applies trimming and removal of carriage returns/backslashes. In other words, input spelling is intentionally normalized before the key is parsed. ([GitHub](https://github.com/TritonDataCenter/node-sshpk/blob/v1.18.0/lib/formats/ssh.js))

Consequences:

- unknown lines: no preservation
- duplicate entries: no document representation
- option order/repeats: unsupported
- quoted options: unsupported
- comments: only a key's trailing comment
- line endings: not retained
- arbitrary bytes: ASCII/text processing prevents a byte-preserving model

**Verdict:** useful cryptographic/public-key utility, wrong abstraction.

---

## 3. Node.js: `ssh2`

**Pinned source:** **v1.17.0**, `lib/protocol/keyParser.js`. ([GitHub](https://raw.githubusercontent.com/mscdex/ssh2/v1.17.0/lib/protocol/keyParser.js))

`ssh2` likewise parses SSH key material rather than `authorized_keys` documents. Its OpenSSH public-key regex starts from recognized key types; an option-prefixed line isn't the expected syntax. Input strings/Buffers are converted into trimmed strings.

The v1.17.0 parser recognizes the traditional RSA/DSS/ECDSA/Ed25519 family but does not provide complete OpenSSH 10.5 authorized-key type coverage; in particular this version isn't a parser for the current MLDSA authorized-key syntax, and its public-key parser isn't an authorized-key-options parser at all. ([GitHub](https://raw.githubusercontent.com/mscdex/ssh2/v1.17.0/lib/protocol/keyParser.js))

**Verdict:** same category as `sshpk`: good SSH protocol/key code, no source-document model.

---

## 4. Python: Paramiko

**Pinned source:** **Paramiko 5.0.0**. ([GitHub](https://github.com/paramiko/paramiko/blob/5.0.0/paramiko/pkey.py))

Paramiko's `PublicBlob.from_string()` describes its input explicitly as a one-line:

```text
<key-name> <base64-blob> [comment]
```

and performs a whitespace split into at most three fields. ([GitHub](https://github.com/paramiko/paramiko/blob/5.0.0/paramiko/pkey.py))

So:

```text
restrict,command="foo" ssh-ed25519 AAAA... comment
```

does not become an authorized-key entry with options. The first token is treated as though it were the key name.

The trailing comment is semantically extracted and stripped, so even that is not a concrete-source representation.

**Understood authorized-key options:** none.

**Verdict:** public-key decoder only.

---

## 5. Python: AsyncSSH

**Pinned source:** **AsyncSSH 2.24.0**, `asyncssh/auth_keys.py`. ([GitHub](https://github.com/ronf/asyncssh/blob/v2.24.0/asyncssh/auth_keys.py))

AsyncSSH is much more interesting because it really does parse authorized-key options.

It recognizes semantic handlers for things including:

- `command`
- `environment`
- `from`
- `permitopen`
- `principals`
- AsyncSSH's X.509-related `subject`

and generic options can also be stored. ([GitHub](https://github.com/ronf/asyncssh/blob/v2.24.0/asyncssh/auth_keys.py))

Its option tokenizer understands quotes and escapes, but then creates a **semantic dictionary-like options representation**. That destroys global source order. Individual handlers introduce additional normalization: for example, `permitopen` is represented as a set, environment entries go into keyed structures, and singleton values such as command are assigned semantically rather than retaining repeated source tokens.

At the document level, `SSHAuthorizedKeys.load()` uses `splitlines()`, strips each line, skips blanks/comments, and ignores entries that fail key import. Valid duplicate keys can remain as separate semantic entries, but malformed/raw material and line-ending information cannot. ([GitHub](https://github.com/ronf/asyncssh/blob/v2.24.0/asyncssh/auth_keys.py))

So AsyncSSH is arguably the best parser here for answering, “What does this file authorize?” but not, “How do I change exactly one byte range and preserve everything else?”

**Verdict:** useful as a validation/semantic-analysis sidecar, not as the editing AST.

---

# Configuration-management tools

## 6. Ansible `ansible.posix.authorized_key`

**Pinned source:** `ansible.posix` **2.2.2**, `plugins/modules/authorized_key.py`. ([GitHub](https://raw.githubusercontent.com/ansible-collections/ansible.posix/2.2.2/plugins/modules/authorized_key.py))

This deserves special attention because it looks like the obvious existing editor.

### What it gets right

Its custom `keydict` is deliberately designed to preserve **insertion order and multiple occurrences of the same option name**. So within one surviving parsed key line, option order and repeated options are handled more carefully than a normal Python dict. ([GitHub](https://raw.githubusercontent.com/ansible-collections/ansible.posix/2.2.2/plugins/modules/authorized_key.py))

### Fatal issue for your requirements: duplicate keys

The whole parsed file is stored in a dictionary indexed by the **base64 key blob**. Consequently:

```text
no-pty ssh-ed25519 AAAA... first
pty    ssh-ed25519 AAAA... second
```

does not remain two independently addressable source entries. Later occurrences replace earlier ones in the parsed representation. ([GitHub](https://raw.githubusercontent.com/ansible-collections/ansible.posix/2.2.2/plugins/modules/authorized_key.py))

Invalid/skipped lines are also used as dictionary keys, so exact duplicate opaque lines are vulnerable to the same occurrence-identity problem.

On write, valid entries are reconstructed and terminated with `\n`; whitespace is normalized rather than splice-edited. ([GitHub](https://raw.githubusercontent.com/ansible-collections/ansible.posix/2.2.2/plugins/modules/authorized_key.py))

Its recognized **key types** come from a fixed list. That list includes several FIDO/WebAuthn types but, in 2.2.2, does not include OpenSSH 10.5p1's `ssh-mldsa44-ed25519@openssh.com`. Its option names themselves are mostly syntactic/opaque rather than a full semantic OpenSSH whitelist.

There has also been current work around keys without comments—evidence that this normalization path has real compatibility edge cases rather than being purely theoretical.

**Verdict:** considerably better than a simplistic parser, but the base64-key dictionary makes it categorically incompatible with “duplicates are separate source records.”

---

## 7. Puppet `ssh_authorized_key`

**Pinned source:** `puppetlabs-sshkeys_core` **v3.0.2**. ([GitHub](https://github.com/puppetlabs/puppetlabs-sshkeys_core/blob/v3.0.2/lib/puppet/provider/ssh_authorized_key/parsed.rb))

Puppet uses its parsed-file machinery and has explicit record fields for options, key type, key, and resource name/comment. Its option parser returns an **array**, rather than a map, and therefore can retain ordering and repeated option tokens for syntax it recognizes. The writer joins parsed options back together when generating a managed record. ([GitHub](https://github.com/puppetlabs/puppetlabs-sshkeys_core/blob/v3.0.2/lib/puppet/provider/ssh_authorized_key/parsed.rb))

However:

- managed lines are generated from semantic fields rather than retained as raw spans;
- resource identity is not per physical source-line occurrence;
- exact duplicate entries are consequently problematic;
- its key-line regex is based on a fixed key-type grammar and does not cover OpenSSH 10.5's MLDSA key type;
- option syntax is accepted generically, rather than implementing all current OpenSSH option semantics.

Comments/blanks benefit from Puppet's generic parsed-file handling, but I found no contract promising byte-for-byte retention of arbitrary text or original EOL bytes. I therefore count exact EOL/unknown-byte fidelity as **not established**, rather than assuming Puppet's minimal rewrite behavior is lossless.

**Verdict:** better source structure than Ansible in some respects, still not a lossless concrete-syntax editor.

---

## 8. Chef `ssh_authorized_keys` cookbook

**Pinned product:** Chef Supermarket cookbook **1.0.0**, Aug 2020. ([Chef Supermarket](https://supermarket.chef.io/cookbooks/ssh_authorized_keys/versions/1.0.0))

This is one of the clearest mismatches. Its documentation explicitly describes an accumulator model and warns that SSH keys added outside that mechanism/manual management will be removed. ([Chef Supermarket](https://supermarket.chef.io/cookbooks/ssh_authorized_keys/versions/1.0.0))

Its options API is a hash, which is itself insufficient to represent:

```text
permitopen="a:22",permitopen="b:22"
```

as two independently ordered occurrences of the same option name.

The cookbook is designed to generate the desired `authorized_keys` state, including deterministic sorting, not preserve a source document.

That means:

- arbitrary unknown lines: **not safe**
- manually added keys: **documented as subject to deletion**
- source ordering: not authoritative
- repeated option names: hash model cannot faithfully represent them
- whitespace/EOL/comment spelling: regenerated

**Verdict:** exactly the kind of declarative desired-state system you should avoid when the file itself is the source of truth.

---

## 9. Salt SSH module

**Pinned source:** Salt **v3008.2**, `salt/modules/ssh.py`. ([GitHub](https://github.com/saltstack/salt/blob/v3008.2/salt/modules/ssh.py))

Salt has several source-verified fidelity problems.

Its validation path strips each physical line, ignores blanks, and stores parsed keys in a **dictionary keyed by the base64 key**, so duplicate key occurrences collapse. Its option parsing uses a plain comma split rather than a proper quote-aware lexer. ([GitHub](https://github.com/saltstack/salt/blob/v3008.2/salt/modules/ssh.py))

Thus a valid option such as:

```text
command="printf 'a,b'"
```

is structurally mis-split at the comma.

Its replacement code rewrites normalized stripped lines with new line endings rather than retaining raw bytes. ([GitHub](https://github.com/saltstack/salt/blob/v3008.2/salt/modules/ssh.py))

More seriously, the removal path skips lines which don't match its expected key regex. Because it rewrites the accumulated list afterwards, a malformed/non-key line can disappear while removing an unrelated authorized key. ([GitHub](https://github.com/saltstack/salt/blob/v3008.2/salt/modules/ssh.py))

That is a direct example of the failure mode your design must prevent: **editing one valid entry destroys unrelated opaque content.**

**Verdict:** unsuitable.

---

## 10. cloud-init

**Pinned source:** cloud-init **26.2**, `cloudinit/ssh_util.py`. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/26.2/cloudinit/ssh_util.py))

Of the configuration-management implementations, cloud-init has one of the more sensible tolerant parsers.

An `AuthKeyLine` can retain the original source string, and if an entry can't be parsed—including unknown key types—it can be represented as an opaque line instead of being discarded. That's a valuable design idea. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/26.2/cloudinit/ssh_util.py))

For recognized entries, however, it has a semantic representation and canonical rendering. Its supported key-type list is explicitly inherited from an older OpenSSH generation and does not include current `ssh-mldsa44-ed25519@openssh.com`.

More importantly for byte preservation:

```python
...splitlines()
```

is used while loading the file, and the file is subsequently reconstructed using `"\n".join(...)`. Therefore physical EOL information is already lost before the tolerant raw-line representation gets a chance to save it. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/26.2/cloudinit/ssh_util.py))

Updates identify keys using key material/base64. Multiple entries carrying the same public key therefore are not independently stable identities; an update can affect every occurrence of that key rather than one chosen physical record. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/26.2/cloudinit/ssh_util.py))

The options substring is much less aggressively interpreted than AsyncSSH, so unknown/current option names tend to survive better.

**Verdict:** useful inspiration for “opaque line” handling, but still fails duplicate identity and byte/EOL preservation.

---

# Cloud/provider products

## 11. Google Compute Engine guest agent

**Pinned source:** guest-agent tag **20260903.00**; release commit reported as `f238644`. The relevant implementation is `google_guest_agent/non_windows_accounts.go`. ([GitHub](https://raw.githubusercontent.com/GoogleCloudPlatform/guest-agent/20260903.00/google_guest_agent/non_windows_accounts.go))

The GCE agent does not deeply parse every user's authorized-key line. Instead it performs marker-based rewriting around:

```text
# Added by Google
```

That has the nice side effect that ordinary non-Google lines, including duplicates and option syntax the agent doesn't understand, are mostly treated opaquely.

But it isn't lossless:

- it `strings.Split`s on `\n`;
- empty strings/blank LF records are skipped;
- preserved lines are later emitted with new `\n`;
- a file lacking a terminal newline gains one.

There is also a particularly useful adversarial test. The code treats a physical line exactly equal to:

```text
# Added by Google
```

as its ownership marker and suppresses the following managed-key line. Therefore a **user-created comment which happens to be exactly that string can cause the next nonempty user key to be removed during the rewrite**. ([GitHub](https://raw.githubusercontent.com/GoogleCloudPlatform/guest-agent/20260903.00/google_guest_agent/non_windows_accounts.go))

That's a good example of why an opaque string shouldn't simultaneously be used as an ownership sentinel without a stronger namespace/provenance mechanism.

**Verdict:** preserves arbitrary user key syntax better than many CM tools, but still fails source-document fidelity and is not a general editing API.

---

## 12. AWS EC2 Instance Connect

EC2 Instance Connect is different: it is primarily an **`AuthorizedKeysCommand` architecture**, not a library which parses and rewrites the user's permanent `authorized_keys`.

AWS documents configuring `sshd` to invoke:

```text
/opt/aws/bin/eic_run_authorized_keys %u %f
```

(or the distro-specific equivalent), with the helper retrieving temporary key material. ([AWS Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-set-up.html))

The public `aws/aws-ec2-instance-connect-config` GitHub release trail is comparatively old—GitHub's last release is 1.1.17 from 2022, while distro/package changelogs have carried later revisions—which makes “latest source version” less clean than for the other projects.

For your requirements the important result is:

**unknown bytes / duplicates / comments / option order / line endings: N/A**, because EIC does not need to mutate the customer's permanent file to inject its temporary keys.

It is a useful architectural pattern if you were willing to make something other than the file authoritative. Your stated requirement says you are not.

---

## 13. Teleport

Current Teleport OpenSSH/agentless integration is also primarily an alternative to editing per-key `authorized_keys`: it exports a Teleport SSH CA and configures OpenSSH `TrustedUserCAKeys`. The documented flow writes the Teleport CA to a separate file and changes `sshd` configuration. ([Teleport](https://goteleport.com/docs/enroll-resources/server-access/openssh/openssh-manual-install/))

So the fidelity columns are again mostly **N/A**.

This is architecturally attractive when central identity is allowed, because it removes most per-user authorized-key file mutation entirely. It does not solve your stated problem of exposing an existing, customer-editable, authoritative file through structured forms.

---

# Other parsers worth knowing

## 14. Augeas `Authorized_Keys` lens

**Pinned source:** Augeas **release-1.14.1**, `lenses/authorized_keys.aug`. ([GitHub](https://github.com/hercules-team/augeas/blob/release-1.14.1/lenses/authorized_keys.aug))

Augeas is philosophically the closest existing technology: its whole purpose is structured editing of configuration files while keeping unrelated source material stable.

Unfortunately, this particular lens is substantially behind modern OpenSSH.

Its explicit key/value option list contains things such as:

```text
command
environment
from
permitopen
principals
tunnel
```

and its flag list covers older options such as `cert-authority` and the `no-*` forwarding/PTY restrictions. It lacks a number of modern OpenSSH options such as `restrict`, `expiry-time`, `permitlisten`, and the newer FIDO-related presence/verification flags. ([GitHub](https://github.com/hercules-team/augeas/blob/release-1.14.1/lenses/authorized_keys.aug))

Its key-type grammar also predates current forms: patterns such as `sk-...@openssh.com` and the new MLDSA hybrid type are outside what this old lens expects. Compare it with OpenSSH 10.5p1's current key-type list. ([GitHub](https://github.com/hercules-team/augeas/blob/release-1.14.1/lenses/authorized_keys.aug))

Augeas can naturally represent repeated records, comments, and order for syntax its lens accepts, but a lens that **rejects future/unknown legal syntax** is incompatible with your “never lose unknown content” rule.

**Verdict:** borrow the lens/CST philosophy, not this lens as-is.

---

## 15. RustCrypto `ssh-key`

**Pinned source:** `ssh-key` **0.6.7**, `authorized_keys.rs`. ([Docs.rs](https://docs.rs/ssh-key/latest/src/ssh_key/authorized_keys.rs.html))

This crate does have an explicit authorized-keys reader, and it retains the options section substantially as a string rather than projecting every option into a map. Therefore valid duplicate lines and option spelling/order are better preserved at the entry level than with AsyncSSH.

But it reads text, not arbitrary bytes, and uses `str::Lines`, so original EOLs are gone.

There is also a strong corpus edge case in the current parser: the line reader uses the first `#` as the start of a comment without first establishing whether that `#` is inside a quoted option value. ([Docs.rs](https://docs.rs/ssh-key/latest/src/ssh_key/authorized_keys.rs.html))

Consequently something like:

```text
command="printf '# hello'" ssh-ed25519 AAAA...
```

is a valuable regression test: `#` is perfectly meaningful inside a quoted command, but this style of comment stripping can truncate the line.

Malformed lines are errors rather than first-class opaque document nodes.

**Verdict:** nicer entry-level representation than several competitors, still no lossless document model.

---

# Fidelity matrix

This condenses the source findings. `✓` means the model can retain the feature in the relevant path; `✗` means a demonstrated incompatibility; `△` means partial/context-dependent.

| Tool | Unknown/malformed lines | Duplicate key occurrences | Option order | Repeated option names | Quote fidelity | Comments | Original EOLs |
|---|---:|---:|---:|---:|---:|---:|---:|
| Go x/crypto v0.57 | ✗ skipped | ✓ if caller iterates `rest` | ✓ strings | ✓ strings | △ parsed, not raw | △ trailing semantic comment only | ✗ |
| sshpk 1.18 | ✗ | ✗ doc model absent | ✗ | ✗ | ✗ | △ trailing only | ✗ |
| ssh2 1.17 | ✗ | ✗ doc model absent | ✗ | ✗ | ✗ | △ | ✗ |
| Paramiko 5.0 | ✗ | ✗ doc model absent | ✗ | ✗ | ✗ | △ normalized | ✗ |
| AsyncSSH 2.24 | ✗ skipped | ✓ semantic entries | **✗ dict** | △ option-dependent | semantic ✓ / raw ✗ | ✗ document comments | ✗ |
| Ansible 2.2.2 | △ skipped strings | **✗ keyed by blob** | ✓ within survivor | **✓ custom keydict** | △ | △ | ✗ |
| Puppet 3.0.2 | △ | △ identity constraints | ✓ | ✓ array | △ | ✓ semantic records | ? / no byte contract |
| Chef cookbook 1.0 | **✗ D: manual state deleted** | ✗ | ✗ source order | ✗ hash model | ✗ regenerated | ✗ unmanaged | ✗ |
| Salt 3008.2 | **✗ removal can discard** | **✗ keyed by blob** | △ | △ | **✗ comma split** | △ | ✗ |
| cloud-init 26.2 | **✓ opaque text line** | △ update keyed by blob | ✓ raw option substring | ✓ substring | ✓ enough to scan | ✓ text | **✗ splitlines/join** |
| GCE agent 20260903 | △ mostly opaque | ✓ non-Google lines | ✓ opaque | ✓ opaque | ✓ opaque | **△ reserved marker** | ✗ strict fidelity |
| Augeas 1.14.1 | ✗ outside lens grammar | ✓ for accepted records | ✓ | ✓ tree records | lens-dependent | ✓ | ? |
| Rust `ssh-key` 0.6.7 | ✗ parse error | ✓ | ✓ raw option string | ✓ raw string | **△ `#` problem** | ✗ | ✗ |

A particularly important nuance is **Ansible**: repeated *options* are preserved by its custom ordered `keydict`; repeated *key lines* are not, because the surrounding file model is keyed by public-key blob. ([GitHub](https://raw.githubusercontent.com/ansible-collections/ansible.posix/2.2.2/plugins/modules/authorized_key.py))

---

# Native option coverage

For your own parser, I would derive this dynamically/version-by-version from OpenSSH rather than freezing a third-party list.

OpenSSH 10.5p1's parser/source covers the flag families for:

`restrict`, `cert-authority`, `port-forwarding`/`no-port-forwarding`, `agent-forwarding`/`no-agent-forwarding`, `X11-forwarding`/`no-X11-forwarding`, `touch-required`/its negative form, `verify-required`/negative parsing form, `pty`/`no-pty`, and `user-rc`/`no-user-rc`; plus valued options `command`, `principals`, `from`, `expiry-time`, `environment`, `permitopen`, `permitlisten`, and `tunnel`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth-options.c))

The meaningful differences between libraries are:

| Implementation | Option knowledge |
|---|---|
| Go x/crypto | **No semantic knowledge**; returns syntactic option strings |
| sshpk / ssh2 / Paramiko | No authorized-key-option parser |
| AsyncSSH | Semantic subset plus generic fallback; notably transforms values into typed collections |
| Ansible | Mostly syntactic/opaque names; preserves repeated name tokens in its `keydict` |
| Puppet | Generic syntactic option tokens, not current OpenSSH semantics |
| Chef | User-supplied hash representation, not a native grammar model |
| Salt | Generic strings split by comma; not safe for quoted commas |
| cloud-init | Mostly opaque options substring; comparatively forward-compatible |
| GCE guest agent | Does not need to understand preserved user options |
| Augeas | **Hard-coded old whitelist**, now incomplete |
| Rust `ssh-key` | Largely raw options string rather than semantic whitelist |

For your requirement, **“understands every option” and “preserves unknown options” should be independent properties**. A future OpenSSH option should appear in the UI as “unknown to this panel / preserved verbatim,” not cause the entry to be rejected or rewritten.

---

# Proposed conformance corpus

Use *real generated key blobs* rather than synthetic `AAAA...`: `K1` = Ed25519, `K2` = RSA or ECDSA, and `KML` = an actual OpenSSH 10.5 `ssh-mldsa44-ed25519@openssh.com` key. Then build these fixtures as **byte arrays**, not source-language text strings.

1. **`01-byte-identity`** — a comment with LF, an empty LF line, K1 using CRLF, K2 using LF, a malformed final record with **no terminating newline**, plus a fixture containing non-UTF-8 bytes in an opaque/comment line. A no-op parse/save must produce identical SHA-256 and identical length.

2. **`02-duplicate-keys`**
   ```text
   no-pty K1 dup-a
   pty K1 dup-b
   no-pty K1 dup-a
   ```
   Three physical records, including two byte-identical entries. Every one must get its own record identity.

3. **`03-option-order`**
   ```text
   restrict,pty K1 order-a
   pty,restrict K2 order-b
   ```
   The AST must retain order; a semantic validator should report the different effective PTY permissions. OpenSSH's sequential parser confirms the distinction. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth-options.c))

4. **`04-repeated-options`**
   ```text
   permitopen="db1.example:22",environment="A=1",permitopen="db2.example:2200",environment="B=2" K1 repeats
   command="one",command="two" K2 invalid-but-preserve
   ```
   The first exercises legal repetition; the second must remain representable even though OpenSSH rejects repeated `command`.

5. **`05-quoting`**
   ```text
   command="printf \"a,b#c\"",from="10.0.0.0/8,!10.1.2.3" K1 quote-test
   ```
   This exposes Salt's naive comma splitting and RustCrypto's `#` treatment, while also testing escaped quotes. OpenSSH explicitly permits a quote in `command` by backslash-escaping it. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

6. **`06-native-options`** — one independently valid line for every OpenSSH 10.5p1 native option/positive-negative form. Do not put conflicting flags on one line; the goal is grammar/coverage testing.

7. **`07-unknown-options`**
   ```text
   x-vendor-flag,x-vendor-opt="a,b" K1 vendor
   ```
   OpenSSH may reject this semantically; your editor must still parse it as an opaque/diagnostic option sequence without changing it.

8. **`08-malformed-and-comments`**
   ```text
   garbage not-a-key
   command="unterminated K1
   ssh-ed25519 !!!not-base64!!! broken
   # Added by Google
   K2 human-key-after-marker
   garbage not-a-key
   ```
   This contains a repeated malformed line and deliberately triggers the GCE ownership-marker collision. ([GitHub](https://raw.githubusercontent.com/GoogleCloudPlatform/guest-agent/20260903.00/google_guest_agent/non_windows_accounts.go))

9. **`09-modern-types`** — KML plus current SK Ed25519 and SK ECDSA keys. This catches old fixed key-type lists such as cloud-init/Augeas/Ansible. OpenSSH 10.5p1's authoritative supported-type list includes MLDSA. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

10. **`10-source-spelling`** — tabs instead of spaces, several spaces between key fields, leading whitespace before a comment, comments with trailing spaces, option keywords with unusual capitalization, a key with no comment, a final newline in one fixture and none in another, and a legal line close to OpenSSH's 8-KiB maximum. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

The most important automated invariant should be:

```text
parse(bytes) -> document
serialize_without_edits(document) == bytes
```

followed by:

```text
edit(record N, field F)

all byte ranges outside the edited source span and any
strictly necessary syntactic delimiters remain byte-identical
```

---

# Expected results on the corpus

These are **source-verified predictions**, not a claim that I ran all sixteen implementations end-to-end in one harness.

| Tool | T02 duplicates | T03 order | T04 repeats | T05 quoting | T08 opaque/malformed | T09 MLDSA | T01 byte/EOL identity |
|---|---|---|---|---|---|---|---|
| Go x/crypto | pass if looping `rest` | pass strings | pass strings | mostly pass parser | **fails: skipped** | **fails** | **fails** |
| sshpk | N/A document | fails option line | fails | fails | fails | incomplete | fails |
| ssh2 | N/A document | fails option line | fails | fails | fails | fails/current gap | fails |
| Paramiko | N/A document | fails option line | fails | fails | fails | ? key subsystem | fails |
| AsyncSSH | valid duplicates survive | **lost globally** | transformed/deduped per handler | semantic pass | **discarded** | ? | fails |
| Ansible | **collapses by blob** | pass surviving option order | pass | △ | opaque lines partially retained; identical opaque duplicates unsafe | **fails** | fails |
| Puppet | △ | pass accepted syntax | pass | △ | △ | **fails** | not established |
| Chef | desired-state regeneration | source order irrelevant | **hash can't model same key twice** | generated | unmanaged content may disappear | depends input/template | fails |
| Salt | **collapses by blob** | △ | △ | **fails quoted comma** | **removal can delete malformed lines** | parser-dependent | fails |
| cloud-init | parse yes, targeted edit no | pass substring | pass substring | pass scanner | **best here: opaque text retained** | opaque/not manageable as recognized type | fails |
| GCE agent | keeps ordinary duplicates | opaque | opaque | opaque | **reserved-marker fixture fails** | opaque | fails |
| Augeas | pass inside accepted grammar | pass | likely pass | lens-dependent | **grammar failure** | **fails** | no strict guarantee |
| Rust `ssh-key` | pass valid lines | pass raw substring | pass raw substring | **fails `#` case** | fails | crate-version dependent | fails |

Two especially useful destructive regression tests are Salt and GCE: Salt can remove malformed unrelated material during a key-removal rewrite, while GCE's special marker can cause the following line to be classified as Google-managed. ([GitHub](https://github.com/saltstack/salt/blob/v3008.2/salt/modules/ssh.py))

---

# The design I would use

I would implement a **lossless CST (concrete syntax tree) over raw bytes**, with a semantic overlay.

At the top level, each physical occurrence should be something like:

```text
Record {
    id: per-occurrence identity,
    raw_span: [start,end),
    content_span,
    eol: bytes,             // "\n", "\r\n", "\r", or ""
    kind: ParsedKey | Comment | Blank | Opaque,
    diagnostics: [...]
}
```

A `ParsedKey` should retain **both** the raw line and parsed source spans:

```text
KeyEntry {
    prefix_whitespace_span,
    options_span?,
    inter_field_whitespace_spans[],
    key_type_span,
    base64_span,
    comment_span?,
    options: [OptionOccurrence, ...]
}
```

Crucially, `options` is an **ordered vector of occurrences**, never a map:

```text
OptionOccurrence {
    raw_span,
    name_span,
    raw_value_span?,
    decoded_name?,
    decoded_value?,
    known_semantics?,
    diagnostics[]
}
```

That structure lets the UI know that:

```text
permitopen="a:22",permitopen="b:22"
```

contains two controls while retaining the original commas, quote spelling, escapes, capitalization and order.

Unknown or malformed material should never fall out of the AST. A valid-looking key with an unknown option can be represented as a `ParsedKey` with an `UnknownOption` diagnostic; an unrecoverable line becomes `Opaque`, carrying all raw bytes. The distinction between **“I can't interpret this”** and **“this line does not exist”** is the main thing almost all the surveyed libraries get wrong.

For editing, use **source-span splicing**. If the user changes only a comment, replace the comment span. Do not regenerate the options or key fields. If the user adds an option, choose a documented canonical spelling only for the *new* bytes; pre-existing bytes remain untouched.

Finally, validate the semantic result against the target OpenSSH version where feasible. Keep the validator separate from the parser: OpenSSH 10.5p1 rejecting `x-vendor-foo` should produce a diagnostic, not deletion. Likewise, a newer option unknown to your control panel must remain editable as an opaque occurrence.

For disk writes, I'd also treat preservation as broader than file contents: use optimistic concurrency against the exact bytes/stat you read, write a temporary file in the same filesystem, preserve owner/mode and relevant security metadata, `fsync`, atomically rename, and refuse to silently overwrite out-of-band changes.

### Recommendation

If this control panel must meet the requirements literally, **build the lossless parser**. Reuse a mature SSH library only for decoding/validating the key blob and fingerprints. Of the surveyed implementations, cloud-init provides a useful model for preserving unparseable lines, Go's parser provides useful quote-aware option tokenization, and Augeas provides the right general philosophy of minimal source edits—but none is safe as the authoritative editor without a new byte-preserving layer around it. ([GitHub](https://raw.githubusercontent.com/canonical/cloud-init/26.2/cloudinit/ssh_util.py))

The critical acceptance criterion is not “can parse every legal OpenSSH file.” It is stronger: **for every possible byte sequence that can exist in the file, editing one understood record must never alter any byte outside the intended edit.** None of the existing tools above provides that contract.
