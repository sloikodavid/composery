# Safe File Editing Guarantees

Source: https://chatgpt.com/share/6aa8b200-c3ac-83eb-9f96-630064e735fd

---

**User**

Context: A control plane edits small configuration files on customer Linux machines over SSH. The customer has root and may edit the same file by hand, with any editor, at any moment. The control plane reads the file and its metadata, computes new content from what it read, and writes the file back. It must never lose an edit silently, never report success when the result is unknown, and never leave the file in a partial state. It cannot install a daemon on the machine, and it cannot expect other tools to cooperate with a locking convention.

Question: What are the established techniques for changing a file safely under these conditions, and what does each one actually guarantee?

Cover: read, modify, write with a comparison of the observed bytes and metadata; advisory locking and why other writers may ignore it; the atomic rename pattern and what it does and does not prevent; file descriptor based checks against path substitution; detecting a change between the last check and the rename; preserving ownership, permissions, extended attributes, ACLs and security labels; behaviour on unusual filesystems and with hard links or symlinks; and how to classify an outcome as unknown rather than as success or failure.

Include the conventions that widely deployed tools follow when editing shared files such as authorized_keys, sudoers, or /etc/passwd, and what those tools do about concurrent editors.

Evidence rules: cite manual pages, source, and standards with versions. Give a reproducible demonstration for each guarantee and each gap. State clearly which risks cannot be removed and are therefore a matter of disclosure rather than engineering.

---

**ChatGPT**

I’ll separate this into two layers: what Linux/POSIX primitives actually guarantee, and what remains impossible when a privileged human can write at any instant without cooperating. I’ll also give shell/C reproductions for each property and race, then compare how `vipw`/`passwd`, `visudo`, and `ssh-copy-id` behave.

---

**ChatGPT**

One important boundary is already clear: “read + compare + rename” is optimistic concurrency, not a true compare-and-swap. Linux has an atomic namespace replacement primitive (`rename`), but no standard primitive meaning “replace this pathname only if it still denotes exactly the version I compared.” That distinction drives the unavoidable final race.

---

**ChatGPT**

The implementation pattern that gets closest is: keep the pathname anchored by directory file descriptors; build and fully sync a same-filesystem temporary inode; copy the metadata contract onto that inode; re-read/compare the live file; then atomically install. Crucially, all ownership/mode/ACL/xattr work should happen **before** the rename, so the live pathname never exposes an intermediate metadata state. `fsync()` on the file alone is not enough for crash durability; the containing directory must also be synced.

---

**ChatGPT**

## Bottom line

On an ordinary Linux filesystem, there is a well-established way to make **your own update atomic and crash-resistant**: build a complete replacement in the same directory/filesystem, set its metadata, `fsync()` it, then `rename()` it over the target and `fsync()` the directory. POSIX.1-2024 requires `rename()` replacement to be atomic; Linux guarantees that an existing destination is never momentarily absent. ([The Open Group](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html?utm_source=chatgpt.com))

There is **not**, however, a standard Linux operation equivalent to:

> replace pathname P with this inode, **iff P still contains exactly the version I read**

That missing compare-and-swap is decisive. A non-cooperating writer can change the file after the control plane's final comparison but before `rename()`. Advisory locks cannot stop it. A file descriptor prevents pathname-substitution attacks on the object you are examining, but it does not freeze that object or make a later pathname replacement conditional. Consequently, the literal requirement “never silently overwrite any edit made by an arbitrary root writer at any instant” is **not satisfiable** with a regular Linux file and an uncooperative writer. What can be engineered is very strong optimistic conflict detection plus atomic publication, with a small but irreducible race explicitly disclosed.

This assumes root is merely *uncooperative*, not malicious. A hostile root owns the machine and can ptrace/kill the SSH-side process, replace binaries/libraries, alter mounts, manipulate clocks and filesystems, and so on. No host-local protocol can give security guarantees against that root.

## What each technique guarantees

| Technique | What it gives you | What it does **not** give you |
|---|---|---|
| Read bytes and metadata, later compare them | Detects ordinary intervening edits that occurred before the comparison. Comparing actual bytes is substantially stronger than checking size/mtime alone. | No exclusion. A change after the comparison wins the race. A read itself is not a whole-file snapshot if another process writes the same inode concurrently. Linux even warns that fields returned by one `statx()` can represent different moments. ([man7.org](https://www.man7.org/linux/man-pages/man2/statx.2.html)) |
| `flock()` / POSIX record lock | Serialization among processes that obey the convention. Useful because established admin tools often do cooperate. | On normal local Linux filesystems it is advisory: another process with permission can simply ignore it and perform I/O. NFS/CIFS semantics differ. ([man7.org](https://man7.org/linux/man-pages/man2/flock.2.html)) |
| Mandatory locking | Historically attempted enforced exclusion. | Not an answer. Linux documents races even in its mandatory-lock implementation and advises against relying on it; modern Linux has moved away from it. ([man7.org](https://www.man7.org/linux/man-pages/man2/fcntl_locking.2.html)) |
| Open file descriptor plus `fstat`/`statx(AT_EMPTY_PATH)` | Identifies and examines the inode you actually opened, even if someone subsequently substitutes the pathname. Directory FDs also make pathname resolution independent of CWD/path-prefix renames. ([man7.org](https://www.man7.org/linux/man-pages/man2/statx.2.html)) | Does not prevent the inode from being written through another FD, and does not make your eventual `renameat()` conditional on pathname identity. |
| `openat2()` resolution restrictions | On Linux, can reject symlinks/magic links, prevent `..`/mount escape, and keep resolution beneath an anchored directory. Excellent TOCTOU/path-hardening. ([man7.org](https://man7.org/linux/man-pages/man2/openat2.2.html)) | Still not version locking or compare-and-swap. |
| Same-filesystem temporary file + `rename()` | Atomic namespace publication: readers opening the name see the old file or the new file, not your half-written temporary file. Existing open FDs remain attached to the old inode. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html)) | Does not prevent overwriting a concurrent edit during the last comparison→rename window; does not update existing FDs; breaks hard-link identity; does not itself guarantee power-loss durability. |
| `fsync(temp)` then `rename()`, then `fsync(directory)` | The normal crash-durability pattern. Linux explicitly says syncing the file does not necessarily persist the containing directory entry, hence the directory sync. ([man7.org](https://man7.org/linux/man-pages/man2/fsync.2.html)) | Subject to filesystem/device implementation quality and network-filesystem semantics. |
| `renameat2(..., RENAME_EXCHANGE)` | Atomically swaps candidate and target, retaining the inode that actually occupied the target under the candidate's old name. This can be used for **post-commit conflict detection**. Linux 3.15+, glibc 2.28+. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html)) | It is “change then validate”, not conditional replacement. On conflict you have already changed the live name; rollback is itself raced. A writer that opened the old inode before the exchange can write it afterward. |
| inotify/fanotify | Useful diagnostics and wakeups. | Not authoritative transaction machinery. Event queues can overflow/drop events, events can be coalesced, and watches concern filesystem events rather than an atomic expected-version predicate. ([man7.org](https://man7.org/linux/man-pages/man7/inotify.7.html?utm_source=chatgpt.com)) |

`RENAME_NOREPLACE` is sometimes confused with CAS. It only says “fail if the destination exists”; it cannot say “replace destination only if it is inode X / generation Y / bytes B.” Its filesystem support also varies. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

## The robust optimistic-update pattern

For a control plane like yours, I would put the entire transaction in **one remote helper process invoked over SSH**, rather than composing `cat`, `stat`, `mv`, etc. as separate SSH commands. This reduces race windows and makes error reporting much more precise, although it does not remove the final race.

Open the containing directory and keep its directory FD for the transaction. Resolve the target relative to that FD. On sufficiently new Linux, `openat2()` with an explicit policy such as `RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS` and, where appropriate, `RESOLVE_BENEATH` is much safer than repeatedly resolving a pathname. POSIX's rationale for `renameat()` likewise says directory FDs exist specifically to avoid races caused by parallel changes to path prefixes. ([The Open Group](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html?utm_source=chatgpt.com))

Open the target and retain that FD. Reject anything except a regular file unless you deliberately implement semantics for the other type. Record at least device/mount identity, inode, file type, link count, uid, gid, mode, size, nanosecond mtime/ctime, plus whatever extended metadata is in your preservation contract. Then read the contents through that FD.

For particularly defensive reads, take metadata before and after the content read, and reread the file until you obtain a stable pair of identical byte streams and compatible metadata. That detects ordinary concurrent in-place writers. It is still not a formal snapshot: `statx(2)` explicitly permits fields from different moments, and there is no general Linux `statx` “content generation” field that turns a regular file into a versioned CAS object. ([man7.org](https://www.man7.org/linux/man-pages/man2/statx.2.html))

Compute the new contents exclusively from that accepted base version. Create the candidate **in the target directory**—not `/tmp`—using an exclusive random name or Linux `O_TMPFILE` where supported. Same filesystem matters because `rename()` across mount points fails with `EXDEV`. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

Write the entire candidate, checking short writes and errors. Apply all metadata that must be present at publication time. Run application-specific validation—syntax parsing, semantic checks, etc.—while it is still private. Then `fsync()` the candidate.

Immediately before publication, independently reopen the live target relative to the anchored directory FD and compare it with the original accepted base. For strict conflict detection, compare actual bytes, not merely a hash or timestamp; a cryptographic hash is a useful optimization but not logically necessary for these tiny files. Recompare the metadata fields that are part of your contract.

If anything differs, discard the candidate and return **CONFLICT / NOT COMMITTED**.

If it still matches, `renameat()` the candidate over the target. That publication is one atomic namespace operation under POSIX. Then `fsync()` the directory. Finally reopen the live pathname and verify the bytes and required metadata.

That sequence ensures that **your process never publishes a partially constructed replacement**. It does not solve:

```text
control: compare target == base        => yes
human:   save "important change"
control: rename(candidate, target)     => human change replaced
```

There is no locking convention involved in that race, and the atomicity of `rename()` actually makes the overwrite very clean.

## The last-check-to-rename race

With plain `rename()`, you cannot detect a change made precisely in that gap before you overwrite it. Making the helper native and putting comparison and rename next to each other narrows the gap from milliseconds/network round trips to perhaps microseconds, but the correctness property remains unchanged.

`RENAME_EXCHANGE` gives an interesting Linux-specific strengthening. Instead of destroying the current destination name, atomically exchange `candidate` and `target`. The file that was at `target` at the exchange is now available at the candidate pathname. You can compare that displaced inode against your base. If it differs, you know an intervening change reached the pathname before the exchange and you can retain both versions for reconciliation. `RENAME_EXCHANGE` is explicitly atomic. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

That still is not a genuine CAS. Consider a manual writer that does:

```text
fd = open("/etc/config", O_WRONLY)
             ... control plane exchanges pathnames ...
write(fd, "human edit")
close(fd)
```

Linux specifies that an open FD is unaffected by rename. The human's write now lands on the **displaced old inode**, not the new file at `/etc/config`. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

If you retain that displaced inode rather than immediately unlinking it, you have at least avoided destroying the bytes. But there is no moment at which you can prove “no holder of an old writable FD will ever write this inode again”. This is an unavoidable incompatibility between replacement-by-rename and arbitrary stale FDs.

Automatic rollback after detecting an exchange conflict is problematic too: between your conflict check and the reverse exchange, somebody may have edited the new live pathname. The rollback then has exactly the same race. The safest response to a post-exchange conflict is therefore to preserve both objects and classify the transaction as requiring reconciliation, not to pretend you can invisibly roll it back.

## Metadata preservation is a contract, not one syscall

A replacement inode starts life with its own metadata. If you simply write `/tmp/x; mv /tmp/x /etc/config`, ownership, mode, ACLs, xattrs, labels, capabilities, timestamps, filesystem flags, and hard-link topology can change.

For normal Linux files, the preservation contract commonly includes uid/gid, permission bits, POSIX ACL, all readable/copyable extended attributes, the SELinux label where applicable, file capabilities, and optionally atime/mtime and filesystem inode flags. Linux provides FD-based xattr operations (`flistxattr`, `fgetxattr`, `fsetxattr`); xattrs belong to the inode. The API can report `ENOTSUP`, and even enumeration has limits, so inability to copy or verify a required attribute should make the update unsupported—not silently drop it. ([man7.org](https://man7.org/linux/man-pages/man2/listxattr.2.html?utm_source=chatgpt.com))

For ACLs, use the ACL API (`acl_get_fd`, `acl_set_fd`) rather than assuming mode bits are sufficient. Linux's ACL API derives from abandoned IEEE 1003.1e draft 17 rather than current POSIX, and filesystem support may be disabled. Also remember that `chmod` and the ACL mask interact. ([man7.org](https://www.man7.org/linux/man-pages/man3/acl_set_fd.3%40%40acl.html?utm_source=chatgpt.com))

SELinux provides FD-based `fsetfilecon()`, so you can label the private candidate before exposing it. The shadow utilities also demonstrate the alternative of setting the filesystem creation context before creating their temporary copy. ([man7.org](https://www.man7.org/linux/man-pages/man3/lsetfilecon.3.html))

Order matters. On Linux, changing owner/group can clear set-ID bits, and changing ownership of an executable clears file capability sets. So a sensible sequence is ownership first, then mode/ACL, then `security.capability` and other affected security xattrs/labels, and verification afterward. ([man7.org](https://man7.org/linux/man-pages/man2/chown.2.html?utm_source=chatgpt.com))

Only atime and mtime are directly restorable with `futimens()`; changing them itself updates ctime. An atomic replacement necessarily has a new inode and new ctime/birthtime characteristics, so **exact inode metadata identity is impossible**. ([man7.org](https://man7.org/linux/man-pages/man2/utimensat.2.html?utm_source=chatgpt.com)) Filesystem flags such as immutable/append-only are yet another Linux/filesystem-specific namespace accessed through `FS_IOC_GETFLAGS/SETFLAGS`. ([man7.org](https://man7.org/linux/man-pages/man2/fs_ioc_getflags.2const.html?utm_source=chatgpt.com))

This leads to a useful product rule: do not claim “preserves metadata” generically. Define a finite supported metadata set, copy and verify every member, and reject/degrade explicitly if the filesystem exposes metadata you cannot preserve.

## Symlinks, hard links and odd filesystems

A symlink needs an explicit policy. `rename(temp, symlink_path)` replaces the **symlink directory entry itself**; it does not update its referent. Linux documents this explicitly. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html)) For a control-plane configuration editor, rejecting symlink targets is generally the cleanest contract. If following links is required, resolve and anchor the referent carefully with `openat2`/directory FDs and treat replacement of the referent as a separate operation.

Hard links are fundamentally incompatible with transparent replacement. Suppose `/etc/x` and `/other/x` are hard links to one inode. Rename a new inode over `/etc/x`, and `/other/x` still refers to the old inode; Linux says other hard links are unaffected. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html)) An in-place rewrite would preserve hard-link identity, but then readers can see partial content and a crash can leave an incomplete update. If hard-link semantics matter, there is no operation that simultaneously gives ordinary whole-file rename atomicity and preserves all existing hard links. A conservative control plane should reject `st_nlink != 1` unless the customer explicitly accepts this behavior.

Filesystem assumptions also belong in the API contract. POSIX.1-2024 specifies atomic `rename()`, but nonstandard FUSE implementations, unusual network filesystems, overlay/union filesystems and buggy storage stacks need qualification. Overlay/union renames may involve copy-up and whiteouts; Linux documents those semantics explicitly. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

NFS has a particularly important outcome problem: Linux's `rename(2)` manual says that a reported failure does **not** prove the rename did not happen. A server may perform the rename, crash before replying, and then reject the retransmitted RPC. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html)) That alone means a binary success/failure API is wrong for arbitrary filesystems.

Locks also vary over network filesystems. Linux implements `flock()` over NFS using whole-file `fcntl` locks on modern kernels, while CIFS/SMB has had versions where flock semantics become effectively mandatory; mount options can alter behavior. ([man7.org](https://man7.org/linux/man-pages/man2/flock.2.html)) So “we took a flock” should never be part of the unqualified correctness proof.

## What existing Unix tools actually do

`visudo`, `vipw`, and friends solve a weaker—and practical—problem: **serialize well-behaved administrative tools by convention**, then use temporary files and validation.

Sudo 1.9.17p2's `visudo(8)` says explicitly that it locks the sudoers file against simultaneous edits, reports “sudoers file busy” if another `visudo` is editing, syntax-checks the result, and uses a temporary file (`sudoers.tmp`) before installation. ([Debian Manpages](https://manpages.debian.org/unstable/sudo/visudo.8.en.html)) Its source/install path sets ownership/mode on the temporary object before moving it into place. That prevents two cooperating `visudo` sessions from trampling one another and avoids installing malformed sudoers. It does **not** prevent root from running `vi /etc/sudoers`, `sed -i`, `cp`, or a custom program while `visudo` has its conventional lock.

Shadow-utils 4.17.4's `vipw(8)` likewise says it sets the appropriate locks to prevent corruption. ([Debian Manpages](https://manpages.debian.org/trixie/passwd/vipw.8.en.html)) The 4.17.4 common I/O implementation uses the password-database lock machinery (including `lckpwdf()` when available and its own lock file); `vipw` constructs an edited temporary copy, preserves basic owner/mode information, handles SELinux creation context where enabled, creates a backup link, then renames the edited file over the database. ([GitHub](https://github.com/shadow-maint/shadow/blob/4.17.4/lib/commonio.c)) `passwd`, `usermod`, `vipw` and related shadow-utils are designed to participate in that convention. A direct root editor need not.

`authorized_keys` is intentionally looser. In OpenSSH's `ssh-copy-id` as shipped with OpenSSH 10.5p1, the normal operation **appends** keys to `~/.ssh/authorized_keys`, which avoids a read-modify-replace cycle for the usual “add one key” case. There is no global authorized_keys editor lock. Its `-s` SFTP mode instead downloads the file, modifies it locally and uploads it—the classic read/modify/write shape, and therefore vulnerable to concurrent-update overwrite unless the surrounding transport/server adds stronger semantics. ([Debian Manpages](https://manpages.debian.org/unstable/openssh-client/ssh-copy-id.1.en.html))

So the longstanding Unix convention is not “these files are magically safe against arbitrary concurrent root edits.” It is “administrators are told to use the designated editor, and those designated tools cooperate with locks and validation.” `visudo` and `vipw` are social/protocol conventions backed by advisory serialization.

## Outcome classification

A control plane should have more than a Boolean result:

| Result | Meaning |
|---|---|
| **COMMITTED** | The publication syscall is known to have succeeded, required metadata was already on the replacement, candidate and directory syncs succeeded under the supported filesystem contract, and a post-read verified the intended bytes/metadata. This means “our replacement was durably installed and observed”; with plain rename it still cannot mean “proved that no uncooperative edit occurred in the final race”. |
| **CONFLICT / NOT COMMITTED** | An intervening change was detected before any live-namespace modification, so the candidate was discarded. This is the clean optimistic-concurrency outcome. |
| **SUPERSEDED** | You know your rename completed, but a postcheck shows somebody subsequently replaced/changed the live path. Do not rewrite it to “fix” this automatically. |
| **UNKNOWN / INDETERMINATE** | You cannot prove whether publication happened, whether it is durable, or which version is currently authoritative. Never map this to either success or ordinary failure. |

Typical **UNKNOWN** cases are an SSH connection loss after the remote process may have entered `rename`; an NFS `rename` error with the documented replay ambiguity; `rename` succeeding but directory `fsync()` failing, leaving the running namespace changed but crash persistence uncertain; losing contact before receiving the remote transaction's final status; or inability to perform the mandatory postcondition check. `fsync()` itself can report delayed `EIO`/`ENOSPC`, and Linux notes that writeback errors may only become visible there. ([man7.org](https://man7.org/linux/man-pages/man2/fsync.2.html))

After UNKNOWN, **never retry the write blindly**. Reconnect and reconcile against durable control-plane state containing the original exact bytes/metadata fingerprint and intended replacement. If the file is exactly the intended result, record “commit observed after reconciliation”. If it is exactly the base, the commit was not observed. If it is a third version, preserve it and treat the transaction as conflict/indeterminate. An external transaction ID can improve diagnostics, but since customer root controls the machine, an on-host journal cannot be an authoritative witness.

There is also an important semantic point about SSH: if the remote helper completed `rename` and `fsync` but the network died before its final message reached the controller, the controller **must** initially say UNKNOWN. Exactly-once acknowledgement is not provided by SSH.

## Reproducible demonstrations

These examples are deliberately performed in a disposable directory. The tests involving SELinux/NFS obviously require those facilities.

1. **An advisory lock does not stop a nonparticipant.**

   Terminal A:

   ```sh
   d=$(mktemp -d)
   printf 'old\n' >"$d/f"
   exec 9<>"$d/f"
   flock -x 9
   echo locked
   sleep 60
   ```

   While it sleeps, terminal B:

   ```sh
   printf 'manual edit\n' >"$d/f"
   cat "$d/f"
   ```

   The write succeeds on a normal local filesystem even though A owns an exclusive flock. That is exactly the documented “advisory only” behavior. ([man7.org](https://man7.org/linux/man-pages/man2/flock.2.html))

2. **The final compare→rename lost-update race.**

   ```sh
   d=$(mktemp -d); cd "$d"
   printf 'base\n' > live
   cp live observed
   printf 'control-plane\n' > candidate

   cmp -s live observed && echo "precondition still true"

   # This is the customer's save in the race window:
   printf 'customer edit\n' > live

   mv -f candidate live
   cat live
   ```

   It prints `control-plane`. Atomic rename did exactly what was requested; the optimistic precondition simply became stale.

3. **Atomic rename prevents readers from seeing your partly built temporary file.**

   ```sh
   python3 - <<'PY'
   import os, threading, tempfile

   d=tempfile.mkdtemp()
   p=os.path.join(d,"live")
   open(p,"wb").write(b"A"*1_000_000)

   bad=[]
   def writer():
       for i in range(200):
           t=os.path.join(d,"tmp")
           with open(t,"wb") as f:
               f.write((b"B" if i&1 else b"A")*1_000_000)
               f.flush()
               os.fsync(f.fileno())
           os.replace(t,p)

   def reader():
       for _ in range(2000):
           with open(p,"rb") as f:
               x=f.read()
           if x not in (b"A"*1_000_000, b"B"*1_000_000):
               bad.append(x[:40])

   a=threading.Thread(target=writer)
   b=threading.Thread(target=reader)
   a.start(); b.start(); a.join(); b.join()
   print("unexpected partial observations:", len(bad))
   PY
   ```

   This is an empirical illustration of the namespace guarantee; POSIX supplies the normative atomicity requirement. ([The Open Group](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html?utm_source=chatgpt.com))

4. **A read is not a snapshot against an in-place writer.**

   ```sh
   python3 - <<'PY'
   import os,tempfile,threading,time
   p=tempfile.mktemp()
   N=1_000_000
   open(p,"wb").write(b"A"*N)

   halfway=threading.Event()
   def w():
       with open(p,"r+b",buffering=0) as f:
           f.write(b"B"*(N//2))
           halfway.set()
           time.sleep(1)
           f.write(b"B"*(N//2))

   t=threading.Thread(target=w); t.start()
   halfway.wait()
   x=open(p,"rb").read()
   print(x[:1], x[-1:], x.count(b"A"), x.count(b"B"))
   t.join()
   PY
   ```

   During the sleep the reader observes one half new and one half old. Holding a file FD would identify the inode but would not freeze its contents.

5. **An FD protects object identity against pathname substitution.**

   ```sh
   python3 - <<'PY'
   import os,tempfile
   d=tempfile.mkdtemp(); p=d+"/f"
   open(p,"w").write("old\n")
   fd=os.open(p,os.O_RDONLY)
   old=os.fstat(fd)

   open(d+"/new","w").write("replacement\n")
   os.replace(d+"/new",p)

   now=os.stat(p)
   print("same inode?", (old.st_dev,old.st_ino)==(now.st_dev,now.st_ino))
   print("FD reads:", os.read(fd,100).decode().strip())
   print("path reads:", open(p).read().strip())
   PY
   ```

   The FD still reads the original inode, exactly as `rename(2)` specifies. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

6. **Hard links are broken by replacement.**

   ```sh
   d=$(mktemp -d); cd "$d"
   printf old > live
   ln live alias
   stat -c '%i %n' live alias

   printf new > candidate
   mv candidate live

   stat -c '%i %n' live alias
   printf 'live='; cat live; echo
   printf 'alias='; cat alias; echo
   ```

   The two paths start with one inode and end with two; `alias` remains `old`. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

7. **Renaming over a symlink replaces the symlink, not its referent.**

   ```sh
   d=$(mktemp -d); cd "$d"
   printf old > real
   ln -s real live
   printf replacement > candidate
   mv candidate live

   test -L live && echo symlink || echo regular-file
   printf 'live='; cat live; echo
   printf 'real='; cat real; echo
   ```

   `live` is now a regular replacement file while `real` remains `old`. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

8. **Ordinary rename loses inode xattrs unless you copy them.**

   On a filesystem supporting user xattrs:

   ```sh
   d=$(mktemp -d); cd "$d"
   printf old > live
   setfattr -n user.control_demo -v preserved live
   getfattr -d live

   printf new > candidate
   mv candidate live
   getfattr -d live
   ```

   The new inode has no `user.control_demo`. Repeat with `getfacl/setfacl` to demonstrate ACL loss. Extended attributes are inode-associated by definition. ([man7.org](https://man7.org/linux/man-pages/man2/setxattr.2.html))

9. **`RENAME_EXCHANGE` preserves the displaced path object.**

   On Linux/glibc:

   ```sh
   d=$(mktemp -d); cd "$d"
   printf HUMAN > live
   printf CONTROL > candidate

   python3 - <<'PY'
   import ctypes, os
   libc=ctypes.CDLL(None, use_errno=True)
   AT_FDCWD=-100
   RENAME_EXCHANGE=2
   r=libc.renameat2(AT_FDCWD,b"candidate",
                    AT_FDCWD,b"live",
                    RENAME_EXCHANGE)
   if r:
       raise OSError(ctypes.get_errno(), os.strerror(ctypes.get_errno()))
   PY

   echo "live=$(cat live)"
   echo "displaced=$(cat candidate)"
   ```

   You get `live=CONTROL` and `displaced=HUMAN`. This is useful for audit/reconciliation, but remember the stale-FD problem above. ([man7.org](https://man7.org/linux/man-pages/man2/rename.2.html))

10. **`visudo` serialization is conventional, not universal.**

    Use a disposable file:

    ```sh
    printf 'root ALL=(ALL:ALL) ALL\n' >/tmp/sudoers.demo
    visudo -f /tmp/sudoers.demo
    ```

    Leave the editor open. A second:

    ```sh
    visudo -f /tmp/sudoers.demo
    ```

    should report the file as busy. Yet in a third shell:

    ```sh
    printf '# direct noncooperating edit\n' >>/tmp/sudoers.demo
    ```

    succeeds. That illustrates precisely the distinction between `visudo`'s concurrency convention and kernel-enforced exclusion. ([Debian Manpages](https://manpages.debian.org/unstable/sudo/visudo.8.en.html))

11. **A remote outcome can be unknown even though the rename happened.**

    On a test SSH host:

    ```sh
    ssh host '
      d=$(mktemp -d)
      echo OLD >"$d/live"
      echo NEW >"$d/tmp"
      mv "$d/tmp" "$d/live"
      echo "$d" >/tmp/demo-last-dir
      kill -KILL $$
    '
    ```

    The SSH invocation terminates abnormally, so the controller has no successful transaction acknowledgement. Reconnect:

    ```sh
    ssh host 'd=$(cat /tmp/demo-last-dir); cat "$d/live"'
    ```

    and you find `NEW`. Production code should model this as UNKNOWN until reconciliation, not “failed, therefore safe to retry”.

Crash persistence is the one guarantee that is not responsibly demonstrated by killing an ordinary userspace process: page cache remains intact. Testing it requires a disposable VM or block-device fault-injection setup that actually cuts storage before/after the candidate `fsync`, `rename`, and directory `fsync`. The normative reason for the second sync is explicit in `fsync(2)`: file sync alone need not make the directory entry durable. ([man7.org](https://man7.org/linux/man-pages/man2/fsync.2.html))

## The risks that belong in disclosure

The irreducible disclosure should say, in substance:

**Concurrent uncooperative edits.** Linux regular-file APIs do not provide an atomic “replace if unchanged since I read it” operation. A direct writer can race the final check. Locks only eliminate this if every writer follows the locking protocol.

**Already-open file descriptors.** Atomic replacement cannot redirect FDs that were opened before the rename. Such writers can continue modifying the displaced old inode.

**Hard links.** Atomic inode replacement necessarily severs that pathname from its previous hard-link set. Preserving both hard-link identity and whole-file replacement atomicity is not generally possible.

**Exact metadata identity.** Replacement necessarily changes inode identity and ctime/birth characteristics; filesystem-specific metadata may not be portable, enumerable, or reproducible.

**Remote acknowledgement.** SSH/network failure can make completion indeterminate. Retrying without reconciliation risks duplicate or destructive action.

**Filesystem semantics.** NFS has a documented “error although rename occurred” case, while custom/FUSE/overlay/cluster filesystems and storage hardware require a tested support contract.

**Hostile root.** No client algorithm can establish trustworthy invariants against a root user deliberately subverting the same host.

So if “must never lose an edit silently” is an absolute product invariant rather than a best-effort concurrency objective, the architecture needs one of three things that your premise currently excludes: writer cooperation/serialization, a storage primitive with true conditional transactions/versioning, or a trusted component controlling all writes. With none of those, the correct engineering solution is **atomic publication + aggressive conflict detection + indeterminate outcomes + explicit disclosure of the final race**, not a claim that `rename()` or `flock()` solves concurrent editing.
