# Design Authorized Keys Editing

Source: https://chatgpt.com/share/6aa7750c-8300-83eb-9274-e795561f82f6

---

**User**

We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Design and challenge the smallest reliable mechanism for reading and editing selected authorized-key entries while the owner may edit files directly. Compare targeted edits with whole-file replacement using an expected revision; account for preservation of comments, formatting, unrecognized entries, and identical key material with different options.

Investigate symlinks, hard links, ownership, modes, ACLs, security labels, special files, read-only filesystems, size limits, encoding, path substitution, atomic rename, fsync and crash durability. Explain which risks matter in supported environments and what must be rejected rather than automatically repaired.

Analyze races with our own workers and independent writers. State exactly what locks, content hashes, and rechecks guarantee and cannot guarantee; do not describe a check followed by a rename as an atomic compare-and-swap without evidence. Analyze crash before/after a write, lost response, retry after a later external edit, and deletion of one duplicate entry.

Return an operation contract, minimal durable state if needed, recovery behavior, and fault-injection tests. No generic configuration-management engine unless the concrete requirements require it.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.

---

**ChatGPT**

I’ll ground this in Ubuntu 24.04’s shipped OpenSSH plus upstream source and Linux filesystem semantics, then separate what is actually guaranteed from what a control-plane protocol can only approximate. The key decision point is whether edits must fail on *any* intervening external change, or may safely rebase a targeted change onto a newer file when the selected entry is still unambiguous.

---

**ChatGPT**

Two important facts are already clear: Ubuntu 24.04 is still on the OpenSSH 9.6p1 line (currently packaged as `1:9.6p1-3ubuntu13.19` for amd64), and upstream `V_9_6_P1` is the signed tag for commit `8241b9c…`, tagged 18 Dec 2023. I’m using that code path—not OpenBSD-current—to define what `authorized_keys` actually accepts.

---

**ChatGPT**

The architecture is converging on an important distinction: a targeted API can preserve unrelated bytes, but the actual safe installation is still a whole-file inode replacement. That gives atomic *visibility* at `rename(2)`, not atomic “replace only if hash still equals X”; an uncooperative direct editor can still win or lose inside the final check→rename window.

---

**ChatGPT**

## Recommendation

For a shared, owner-editable `authorized_keys`, use **targeted operations with an exact-byte expected revision**, implemented as a byte-preserving server-side transformation followed by staged whole-file replacement. Do **not** expose whole-file replacement as the normal application operation, and do **not** automatically rebase a stale targeted edit.

The important limitation is fundamental: on Linux there is no filesystem primitive here equivalent to “rename this staged inode over `authorized_keys` only if the current file still has SHA-256 X.” `rename(2)` atomically changes which inode the pathname names, but a hash check immediately before it is a separate operation. Therefore this design can serialize all Composery writers and detect almost every ordinary external edit, but **cannot guarantee against an independent writer in the final check→rename window**. `flock()` cannot close that gap because it is advisory and a direct editor may ignore it. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html?utm_source=chatgpt.com))

If “Composery must never overwrite an independent owner edit” is a hard requirement, the stronger and actually simpler design is a **second `AuthorizedKeysFile` owned logically by Composery**, leaving the customer's normal `~/.ssh/authorized_keys` untouched. OpenSSH supports multiple authorized-key files natively. That is my preferred design if Composery does not specifically need to edit arbitrary pre-existing entries in the customer's file. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_9_6_P1/sshd_config.5))

### Evidence baseline

As of **14 September 2026**, Canonical's current Ubuntu 24.04 LTS/Noble security package is `openssh-server 1:9.6p1-3ubuntu13.19`; Canonical published that build on **3 September 2026**. ([Ubuntu](https://ubuntu.com/security/notices/USN-8721-1?utm_source=chatgpt.com)) Upstream OpenSSH Portable tag `V_9_6_P1` points to commit `8241b9c0529228b4b86d88b1a6076fb9f97e4a99`, tagged **18 December 2023**. 

All parser-specific conclusions below use **OpenSSH Portable 9.6p1**, not current OpenBSD/OpenSSH master. Current master is materially newer—for example, its `sshd(8)` documents key types absent from the 9.6-era manual—so it should not silently define Noble behavior. ([GitHub](https://github.com/openssh/openssh-portable/blob/master/sshd.8?utm_source=chatgpt.com)) RFC 4252, January 2006, defines SSH public-key authentication in terms of proving possession of a private key and server acceptance of the public key; it does **not** define OpenSSH's `authorized_keys` file format or its options. ([RFC Editor](https://www.rfc-editor.org/info/rfc4252/?utm_source=chatgpt.com))

I verified Canonical's package/version but did **not** successfully extract the exact `3ubuntu13.19` Debian source patch set in this environment, so I will not claim that every relevant Noble source line is byte-identical to upstream `V_9_6_P1`. A reproducible Noble check is:

```sh
apt-get source openssh=1:9.6p1-3ubuntu13.19
grep -nE 'auth_openfile|safe_path_fd|auth_check_authkeys_file' \
    openssh-9.6p1/{auth2-pubkeyfile.c,misc.c}
diff -u \
    <(curl -fsSL https://raw.githubusercontent.com/openssh/openssh-portable/V_9_6_P1/auth2-pubkeyfile.c) \
    openssh-9.6p1/auth2-pubkeyfile.c
```

I have not run the filesystem fault-injection experiments proposed below.

## Why targeted edits beat whole-file replacement

OpenSSH 9.6p1 treats the file as physical lines, skips blank/comment lines, and parses each remaining line as an authorization. The documented format has optional options followed by key type, base64 key and comment; the comment has no authentication semantics. Lines have a documented maximum of 8 KiB. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))

Crucially, the same public-key material can appear several times with **different authorization options**. The parser first tries to read a key, and otherwise interprets a prefix as key options before reading the key. Consequently a fingerprint is not an entry identifier: two lines containing the same key may grant materially different privileges. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))

A targeted operation can therefore preserve every non-target byte: comments, spacing, line endings, unfamiliar options, currently unknown key types, and opaque lines. A client-side whole-file replacement can provide optimistic concurrency with the same expected hash, but puts preservation correctness in every client and encourages normalization. It offers no stronger protection from the final external-writer race.

The representation should consequently be **bytes, not a normalized text AST**. Parse enough to present recognized authorizations, but retain the exact byte span of every record. A revision should be `sha256:<hash of all exact file bytes>`.

An entry identifier should be **revision-scoped**, for example conceptually `H(revision || byteOffset || H(rawRecord))`. It is deliberately invalid once the file changes. Two byte-identical duplicate lines at different offsets still receive different IDs.

That makes duplicate deletion well-defined: “delete entry 4 from revision X,” not “delete this fingerprint.” If anything changes first—even an unrelated comment—the revision is stale and the deletion fails. This is stricter than necessary in some cases, but it eliminates dangerous guesses.

## Proposed operation contract

| Operation | Contract |
|---|---|
| `read` | Live-read server bytes; return exact `revision`, ordered recognized entries with revision-scoped IDs, plus opaque/unsupported-state indicators. No stored inventory is authoritative. |
| `add(expectedRevision, line)` | Add exactly one validated authorization record. `expectedRevision` may be a distinguished `absent` value. |
| `replace(expectedRevision, entryId, line)` | Replace only that physical record's content; preserve its existing line terminator. |
| `delete(expectedRevision, entryId)` | Remove exactly that physical record, not every occurrence of its key material. |
| stale revision | `CONFLICT`; modify nothing. No automatic semantic rebase. |
| unsupported filesystem/file state | `UNSUPPORTED_STATE`; modify nothing. |
| pre-publish I/O failure | `IO_ERROR`; old pathname remains authoritative. |
| successful rename but failed/unknown durability step | `OUTCOME_UNKNOWN`; caller must reread and must not blindly replay. |

For `add`, use LF for the new record. If a nonempty file lacks a terminating newline, inserting the separator LF before the new record is the one intentional modification to pre-existing bytes. Replacements otherwise retain the original record terminator; unrelated CRLF/LF choices are untouched.

Validate newly supplied records independently. No embedded LF, CR or NUL; one authorization only; enforce the OpenSSH-documented 8 KiB line limit. For the existing file, I would make **NUL bytes or any physical line over 8 KiB mutation-blocking**: reads can report them, but Composery should not pretend to understand unsupported/ambiguous input. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_9_6_P1/sshd.8))

Also impose a product-level total file cap—**1 MiB is a reasonable initial value**, but this is a Composery DoS bound, not an OpenSSH rule.

## Filesystem contract

The mutation helper should be a small privileged Linux component rather than Node code doing pathname-based `readFile`/`rename` calls directly. Ubuntu 24.04 originally shipped Linux 6.8, while `openat2(2)` has existed since Linux 5.6, so the necessary path-resolution primitive is available on the baseline platform. ([Ubuntu Documentation](https://documentation.ubuntu.com/release-notes/24.04/?utm_source=chatgpt.com))

The supported state should be deliberately narrow:

| Condition | Action and reason |
|---|---|
| Symbolic link in `.ssh` path or target | **Reject mutation.** `openat2` with `RESOLVE_BENEATH \| RESOLVE_NO_SYMLINKS`. OpenSSH itself can accept some canonically safe symlink arrangements, but replacing a symlink pathname replaces the symlink rather than its target, making mutation semantics surprising. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_9_6_P1/misc.c)) |
| Non-regular target: FIFO, socket, device, directory | **Reject.** OpenSSH's own authorization-file opener requires a regular file. This also prevents blocking on a FIFO. ([github.com](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c?utm_source=chatgpt.com)) |
| `st_nlink != 1` | **Reject.** Atomic rename would deliberately sever the target pathname from its existing hard-link aliases, while those aliases retain the old inode. ([man7.org](https://man7.org/linux/man-pages/man7/inode.7.html?utm_source=chatgpt.com)) |
| Unsafe owner/mode | **Reject, don't chmod/chown-repair.** With `StrictModes`, OpenSSH accepts ownership by the user or root and checks against group/other writability in the file/path. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_9_6_P1/sshd_config.5)) |
| ACLs or xattrs on target | **Reject in v1.** ACLs, capabilities and security labels can reside in xattrs and do not automatically migrate when replacing the inode. ([man7.org](https://man7.org/linux/man-pages/man7/xattr.7.html?utm_source=chatgpt.com)) |
| Default ACL on containing directory | **Reject in v1**, because a newly created staging inode inherits it. ([man7.org](https://man7.org/linux/man-pages/man5/acl.5.html?utm_source=chatgpt.com)) |
| Immutable or append-only inode flag | **Reject, never clear automatically.** Both deliberately restrict modification, even for root absent the required capability/action. ([man7.org](https://www.man7.org/linux/man-pages/man2/ioctl_iflags.2.html?utm_source=chatgpt.com)) |
| Read-only mount | **Reject.** Never remount it. `rename` returns `EROFS`. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html?utm_source=chatgpt.com)) |
| Remote/unknown filesystem semantics | Initially **unsupported unless tested**. In particular, NFS has special rename failure ambiguity and `flock` behavior differs on NFS/SMB. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html?utm_source=chatgpt.com)) |

Rejecting all target xattrs is intentionally conservative. Ubuntu 24.04's default MAC is AppArmor 4.0.1, whose policy is path-based rather than SELinux-style inode labeling, so SELinux labels are not normally an issue on a stock Noble server. But Ubuntu supports other configurations, and `security.*` also includes things such as file capabilities. Silent copying is more complicated and more dangerous than refusing an unusual file. ([Ubuntu Documentation](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/?utm_source=chatgpt.com))

This policy should apply only to **mutation**. A live read can still report a symlink, ACL, unexpected mode, or other unsupported state so the owner understands why editing is unavailable.

## Mutation algorithm and its exact guarantees

Acquire one Composery-owned `flock(LOCK_EX)` on a stable lock file outside the customer's replaceable tree, keyed by server/user/authorization-file slot. Do **not** lock `authorized_keys` itself: after rename it is a different inode. This lock gives serialization among cooperating Composery workers only. Linux explicitly defines `flock` as advisory for ordinary local files, so it cannot stop the owner from writing around it. ([man7.org](https://www.man7.org/linux/man-pages/man2/flock.2.html?utm_source=chatgpt.com))

Resolve from a trusted directory fd with `openat2`, not from a client-supplied pathname. `RESOLVE_BENEATH` prevents escape and `RESOLVE_NO_SYMLINKS` rejects symlink components. `fstat` the opened objects and validate type, ownership, modes, link count and supported metadata. ([man7.org](https://man7.org/linux/man-pages/man2/openat2.2.html?utm_source=chatgpt.com))

Read the exact bytes with a size bound and compute `preRevision`. Require equality with `expectedRevision`, then perform the targeted byte splice in memory. Create a random staging regular file **in the same directory**, using exclusive creation and no symlink following; write with a short-write-safe loop, set the intended ordinary owner/group/mode on the staging inode, and recheck its metadata.

Call `fsync(stagingFd)`. Linux documents that this flushes file data and metadata, but explicitly says it does not guarantee durability of the containing directory entry. ([man7.org](https://www.man7.org/linux/man-pages/man2/fsync.2.html?utm_source=chatgpt.com))

Immediately before publication, reopen/re-resolve the current destination from the trusted root, verify that the expected containing directory is still the same `(st_dev, st_ino)`, reread the current destination and require its exact SHA-256 to still equal `preRevision`. This catches an independent writer that finishes before the recheck.

Then rename the staging name over the existing destination. Linux guarantees atomic pathname replacement—the destination does not pass through a missing state—and open FDs to the old inode remain valid. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html?utm_source=chatgpt.com))

Finally `fsync(directoryFd)`, because that is what makes the renamed directory entry durable according to the documented `fsync` contract. Then optionally reopen the pathname and compute/report the observed `postRevision`. ([man7.org](https://www.man7.org/linux/man-pages/man2/fsync.2.html?utm_source=chatgpt.com))

For creation when the destination was absent, use `renameat2(..., RENAME_NOREPLACE)`: unlike replacement, Linux *does* provide an atomic “only if destination does not exist” condition. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html?utm_source=chatgpt.com))

### What the hash/recheck does **not** guarantee

This sequence is **not CAS** and should not be described as CAS, a transaction, or serializable mutation against shell users.

Consider:

```text
Composery: final read/hash == X
Owner:                         writes change Y
Composery:                                  rename(temp, authorized_keys)
```

Y is lost from the pathname. There is no expected-hash condition attached to that rename.

Similarly, an owner can atomically rename their version over Composery's version immediately after Composery publishes. Or an editor may keep an FD to the old inode; after Composery renames, later writes through that FD still modify the old inode and are invisible through `authorized_keys`, because open descriptors are unaffected by rename. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html?utm_source=chatgpt.com))

A post-rename hash only tells you what existed **when that postcheck occurred**. It cannot freeze the file afterward.

This is why repeated hashes, `mtime`, inode comparisons or inotify do not turn the operation into CAS. They make race detection better; they do not eliminate the final uncoordinated interval.

## Crash and retry behavior

Before `rename`, a crash leaves the old destination authoritative. A complete or partial staging file may remain; it must never be mistaken for an authorization source.

After staging `fsync` but before rename, the same applies. After `rename` but before directory `fsync`, the new file is ordinarily visible to the running system, but crash/power-loss durability of the directory change has not yet been established. If directory `fsync` fails after a successful rename, report **`OUTCOME_UNKNOWN`**, not failure followed by an automatic retry. ([man7.org](https://www.man7.org/linux/man-pages/man2/fsync.2.html?utm_source=chatgpt.com))

After staging-file `fsync` + rename + directory `fsync`, the protocol has reached the durability level documented by Linux. This is still subject to whatever guarantees the underlying storage stack actually provides.

If the network/API response is lost after a successful commit, a retry carrying the original expected revision sees a different revision and returns `CONFLICT`; it does **not** perform the operation twice. This is particularly important for duplicate deletion.

If an external edit happened after that successful operation, a late retry still uses the old revision and therefore cannot accidentally find another copy of the same key and delete it. The caller must reread and make a new explicit selection.

No durable key inventory or local transaction journal is required for these semantics. The file remains authoritative and the correctness lock may live under `/run`. A request audit record in Convex is useful operationally, but cannot provide distributed exactly-once semantics: there is inevitably a failure point between durable filesystem publication and recording the outcome remotely.

I would also **not automatically delete old `.composery-tmp-*` files on boot merely by filename prefix**: the customer can create such names. Either tolerate rare orphan staging files or later add securely attributable cleanup metadata/state.

## Fault-injection acceptance suite

These are tests I recommend; I have not executed them.

| Injection | PASS criterion |
|---|---|
| Corpus containing comments, blank lines, odd spacing, CRLF and unrecognized records | After targeted replace/delete, every byte outside the specified record/boundary is identical. |
| Same public key three times with different options | Deleting the middle entry deletes only that physical entry. |
| Two byte-identical duplicate lines | Entry IDs are distinct within one revision; selecting one removes exactly one. |
| Two Composery workers start from revision X | One mutation may succeed; the other must observe the new revision and conflict. Never two successes based on X. |
| External edit before final recheck | Composery returns `CONFLICT`; external bytes remain. |
| External edit precisely after final hash and before rename | Demonstrate that the edit **can be overwritten**. PASS means the limitation is reproduced and documented; if the product requirement says this must never happen, the shared-file design fails. |
| External atomic rename immediately after Composery rename | Demonstrate that the external version may become current. Composery must not claim continuing ownership/enforcement. |
| Writer holds old target FD across Composery rename | Writes to old FD do not mutate the new pathname inode. |
| Swap target or a path component for symlink | Mutation rejects; nothing outside the supported subtree changes. |
| Hardlink target (`st_nlink=2`) | Mutation rejects; both aliases remain untouched. |
| FIFO/socket/device/directory | Immediate rejection; no FIFO blocking and no writes. |
| Unsafe mode/owner, ACL, xattr, default ACL, immutable/append flag | Mutation rejects without attempting to “repair” the server. |
| Inject `ENOSPC`/`EIO` before rename | Original pathname bytes remain unchanged. |
| Kill process after staging `fsync`, before rename | Original remains authoritative; possible orphan only. |
| Kill/process failure after rename, before directory `fsync` | Recovery does not blindly replay; caller must reread. |
| Drop API response after directory `fsync` | Retry with old revision cannot apply operation again. |
| Successful delete, external later edit, retry old delete | `CONFLICT`; no other duplicate is selected heuristically. |
| Two creators race from `absent` | `RENAME_NOREPLACE` permits at most one destination creation. |
| NUL, >8 KiB physical record, or >product file-size cap | Mutation rejects before staging/publishing. |

For actual crash durability testing, `SIGKILL` only tests process death. Use disposable VMs plus controlled VM power-off or a block-device fault facility to test the power-loss cases.

## Stronger simpler alternative

Configure, at image/bootstrap time, something equivalent to:

```text
AuthorizedKeysFile .ssh/authorized_keys .ssh/composery_authorized_keys
```

OpenSSH Portable 9.6p1 explicitly supports multiple whitespace-separated authorization files. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_9_6_P1/sshd_config.5))

Then:

- the owner retains unrestricted native management of `.ssh/authorized_keys`;
- Composery edits only `.ssh/composery_authorized_keys`;
- sshd continues authenticating locally if Composery/Convex/the Internet disappears;
- no private key reaches Composery;
- comments/formatting/races in the owner's file cease to be Composery's problem;
- the Composery file can use the much simpler **whole-file replacement with expected revision** because Composery can define itself as its sole writer.

That is preferable unless a product requirement specifically says **Composery must enumerate and edit arbitrary entries that owners also directly edit in the same file**.

`AuthorizedKeysCommand` is weaker for your stated independence goal because it creates an authentication-time command dependency and is unnecessary here; OpenSSH also evaluates normal authorized-key files before that command. 

A marker block in the customer's shared file does not solve the fundamental race, and in-place rewriting preserves inode/xattrs/hardlinks at the cost of exposing partial writes and much worse crash behavior. Neither is a better minimum.

## Decisive product gate

There is one issue evidence cannot decide:

> **Must Composery guarantee that it can never overwrite an independent direct edit to the same shared authorization file?**

If **yes**, the shared-file editing requirement and uncoordinated direct writers are incompatible. Use the separate `AuthorizedKeysFile`, or require every writer to participate in the same locking protocol.

If **no**, and the acceptable contract is instead “detect stale state except for a documented final uncoordinated filesystem race,” the targeted, revision-scoped mechanism above is the smallest design I would ship.

Everything else can be made deterministic without a persistent key inventory or configuration-management engine.
