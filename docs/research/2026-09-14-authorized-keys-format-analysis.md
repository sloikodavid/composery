# Authorized keys format analysis

Source: https://chatgpt.com/share/6aa8764e-3b30-83ed-9719-79776e2f5286

---

**User**

Context: A web control panel manages Linux VPS instances. Today they start from Ubuntu 24.04 images, but customers have root and can change anything, including the operating system and the SSH server. The panel connects to each instance over SSH and wants to let authorized customers list, add, edit, and remove entries in OpenSSH authorized_keys files through structured forms. The files on the server are the source of truth, and unchanged bytes must be preserved exactly. The panel wants to support the complete native format of the OpenSSH that is actually installed, without inventing semantics.

Question: What exactly is the authorized_keys format and its option set, and how does it differ between OpenSSH versions and distribution builds?

Produce:
1. A complete inventory of every option that sshd accepts in an authorized_keys entry, for each OpenSSH release from 8.0 through the newest release, and for the Ubuntu 24.04, Debian 12, and RHEL 9 packages. For each option: the value grammar, whether it can repeat, whether order matters, interactions with other options, the release that added, changed, or removed it, and any distribution patch that changes it.
2. The complete line grammar: leading whitespace, the options field, key types (including certificates and security-key types), the base64 blob, comments, quoting and escaping rules, maximum line length, encoding handling, blank lines, and comment lines.
3. How sshd behaves on an entry it cannot parse: skip the line, reject the file, or something else, per version.
4. A reliable way to detect changes to this format in future releases.

Evidence rules: Cite source files (for example auth-options.c, auth2-pubkeyfile.c, sshkey.c) at exact tags or commits, and man pages at matching versions. Mark anything taken from documentation only, without source confirmation. Distinguish OpenBSD-current, OpenSSH Portable, and distribution packages. Give counterexamples where documentation and source disagree. State what you could not verify.

---

**ChatGPT**

I’ll treat this as a source-audit rather than a man-page summary: first establish the exact upstream release range and parser implementation, then diff the accepted option tokens/grammars across tags, and finally compare the Ubuntu 24.04, Debian 12, and RHEL 9 source packages for downstream changes. I’ll explicitly separate what is enforced by code from what is merely documented, and call out any places I can’t verify from public source.

---

**ChatGPT**

The upstream release range is now clear: the newest stable release as of September 14, 2026 is OpenSSH 10.5/10.5p1 (August 11, 2026), not 10.3. One important early finding is that the authorized_keys parser has been structurally stable for years: most releases from 8.4 onward share the same option names, but there are semantic changes (notably certificate-principal handling in 10.3 and `restrict`/tunnel enforcement fixed in 10.5) that a control panel must model separately from token recognition.

---

**ChatGPT**

The most important implementation point is this: **`authorized_keys` is not a stable declarative format with a versioned schema. It is the input language of several OpenSSH C parsers, and the source code—not the man page—is authoritative.** If your panel must preserve arbitrary customer-managed files byte-for-byte and support whatever `sshd` is actually installed, the safest design is a lossless concrete-syntax parser plus a version/build-specific semantic capability layer, rather than serializing the whole file from normalized form.

As of **2026-09-14, the newest stable upstream release is OpenSSH 10.5 / 10.5p1, released 2026-08-11**. ([openssh.com](https://www.openssh.com/releasenotes.html))

## 1. `authorized_keys` option inventory

### Accepted option language in current OpenSSH

At tag **`V_10_5_P1`**, `sshauthopt_parse()` in `auth-options.c` recognizes these tokens:

| Option | Parsed value / effect | Repeat semantics | Order-sensitive? |
|---|---|---|---|
| `restrict` | flag; disables port, agent, X11 forwarding, PTY, and user rc | yes, idempotent | **yes** relative to re-enabling flags |
| `cert-authority` | flag marking key as CA | yes | effectively no |
| `port-forwarding` | enable forwarding | yes | **yes** |
| `no-port-forwarding` | disable forwarding | yes | **yes** |
| `agent-forwarding` | enable agent forwarding | yes | **yes** |
| `no-agent-forwarding` | disable agent forwarding | yes | **yes** |
| `X11-forwarding` / `x11-forwarding` | enable X11 | yes | **yes** |
| `no-X11-forwarding` | disable X11 | yes | **yes** |
| `pty` | permit PTY | yes | **yes** |
| `no-pty` | forbid PTY | yes | **yes** |
| `user-rc` | permit `~/.ssh/rc` | yes | **yes** |
| `no-user-rc` | forbid it | yes | **yes** |
| `touch-required` | require SK user-presence bit | yes | **yes**, last wins |
| `no-touch-required` | waive SK user-presence bit | yes | **yes**, last wins |
| `verify-required` | require SK user verification | yes | **yes**, last wins |
| `no-verify-required` | clear that requirement | yes | **yes**, last wins |
| `command="..."` | forced command | **no**; duplicate invalidates line | n/a |
| `principals="..."` | certificate-principal list | **no**; duplicate invalidates line | n/a |
| `from="..."` | source host/address pattern-list | **no**; duplicate invalidates line | n/a |
| `expiry-time="..."` | absolute expiry | yes; **earliest time wins** | no |
| `environment="NAME=value"` | environment assignment | yes | duplicate names: version-dependent |
| `permitopen="host:port"` | allowed local-forward destination | yes | collection |
| `permitlisten="[host:]port"` | allowed remote-forward listener | yes | collection |
| `tunnel="n"` | force tunnel device | yes; **last wins** | yes |

That list comes directly from the `V_10_5_P1` parser.  The limits and storage model are declared in `auth-options.h`. 

### Two undocumented-but-accepted spellings

The manual documents `no-touch-required` and `verify-required`, but the actual parser calls:

```c
opt_flag("touch-required", 1, ...)
opt_flag("verify-required", 1, ...)
```

The `allow_negate=1` argument means **both positive and `no-` spellings are accepted**. Consequently:

- `touch-required`
- `no-touch-required`
- `verify-required`
- `no-verify-required`

are all parser-recognized, even though the 10.5 `sshd(8)` option list documents only `no-touch-required` and `verify-required`.  

That is a concrete source/documentation mismatch and a good example of why a web form generated solely from `sshd(8)` is insufficient.

### `restrict` is explicitly order-sensitive

For example:

```text
restrict,pty
```

ends with PTY **allowed**.

But:

```text
pty,restrict
```

ends with PTY **forbidden**.

`restrict` immediately resets five permission bits to zero; later positive options may set them back. 

The same last-setting-wins rule applies to the positive/negative forwarding, PTY, user-rc, touch and verification flags.

### Value grammars

**`command=VALUE`**  
`VALUE` is parsed by the common authorized-key option dequoter. It may be double-quoted; a literal quote can be escaped with backslash. Any string is accepted by this layer. Duplicate `command` clauses cause the whole option string to fail. The man page describes the forced-command semantics and certificate interaction. 

If both the CA line and the certificate contain forced commands, the certificate is usable only if the commands are identical. Certificate/key restrictions are otherwise combined restrictively. 

**`principals=VALUE`**  
Parser accepts one dequoted string. Semantically it is a comma-separated list and only applies meaningfully to a `cert-authority` line. Duplicate clauses invalidate the line. 

There is an important 10.3 semantic change described below.

**`from=VALUE`**  
One dequoted pattern-list. Duplicate clauses invalidate the line. Hostnames use OpenSSH pattern matching; IP addresses may use CIDR. At authentication, both hostname/IP matching rules and any certificate `source-address` restriction must succeed. 

**`expiry-time=VALUE`**  
May repeat. Every occurrence is parsed and the **minimum/earliest timestamp wins**. 

Originally it accepted local-time absolute date/time forms. Starting with 9.6, a `Z` suffix explicitly selects UTC. The documented modern forms are:

```text
YYYYMMDD[Z]
YYYYMMDDHHMM[SS][Z]
```

OpenSSH 9.6 specifically added UTC-suffixed dates to `authorized_keys` expiry times. ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com))

**`environment=NAME=value`**  
The first `=` divides name/value; the name must satisfy OpenSSH's environment-variable-name validator. Whether it has any effect is additionally controlled by `PermitUserEnvironment`. 

Before 8.7, duplicate variable names were accumulated and downstream behavior effectively allowed later values to supersede earlier ones. **8.7 changed authorized-key environment variables to first-match-wins and introduced the 1024-name limit.** ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com))

There is a source-level boundary wrinkle: the current parser tests `nenv > SSH_AUTHOPT_ENV_MAX` *before* appending, not `>=`; with `SSH_AUTHOPT_ENV_MAX == 1024`, the parser can therefore reach **1025 accepted distinct entries** before rejecting a subsequent one. The header comment says “Maximum ... 1024”, so the implementation and nominal limit differ by one.  

**`permitopen=host:port`**  
Repeatable. Host must fit `NI_MAXHOST`; port is a valid positive port or `*`. IPv6 uses bracketed syntax. There is deliberately **no DNS resolution or wildcard matching of the destination hostname**.  

**`permitlisten=[host:]port`**  
Repeatable. A bare port is normalized internally as wildcard listen host. Host wildcards are meaningful for this option. Port may be `*`.  

Nominal limit for each of `permitopen` and `permitlisten` is 4096. Again, current code checks `npermits > 4096` before appending, so **4097 can be accepted** before the next occurrence fails.  

**`tunnel=VALUE`**  
Parsed through OpenSSH's tunnel-device parser and the result overwrites the preceding value, so repetitions are last-wins. The man page describes it as an integer tunnel-device number.  

### Version-by-version inventory, OpenSSH Portable

The complete parser evolution from 8.0 onward is surprisingly small:

| Release | Accepted option set / semantic changes |
|---|---|
| **8.0p1** | Baseline set: `restrict`, `cert-authority`, `[no-]port-forwarding`, `[no-]agent-forwarding`, `[no-]x11-forwarding`, `[no-]pty`, `[no-]user-rc`, `command`, `principals`, `from`, `expiry-time`, `environment`, `permitopen`, `permitlisten`, `tunnel`. Source: `V_8_0_P1`.  |
| **8.1p1** | Same tokens. Adds bounded `permitopen`/`permitlisten` count as a DoS hardening change. ([OpenSSH](https://www.openssh.com/releasenotes.html)) |
| **8.2p1** | Adds parser support for **`[no-]touch-required`** alongside the new FIDO/SK key types. Source explicitly parses `touch-required` with negation enabled.  FIDO key support and the documented `no-touch-required` authorized-key option were introduced here. ([OpenSSH](https://www.openssh.com/releasenotes.html)) |
| **8.3p1** | Same tokens as 8.2. |
| **8.4p1** | Adds **`[no-]verify-required`**. Exact parser shown at `V_8_4_P1`.  Release notes document `verify-required`. ([OpenSSH](https://www.openssh.com/releasenotes.html)) |
| **8.5p1** | Same option tokens. |
| **8.6p1** | Same option tokens. |
| **8.7p1** | Same tokens; `environment=` becomes **first-name-wins** and nominally capped at 1024 names. ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com)) |
| **8.8p1** | Same tokens. |
| **8.9p1** | Same tokens. |
| **9.0p1** | Same tokens. |
| **9.1p1** | Same tokens. |
| **9.2p1** | Same tokens. |
| **9.3p1** | Same tokens. |
| **9.4p1** | Same tokens. |
| **9.5p1** | Same tokens. |
| **9.6p1** | Same tokens; `expiry-time` additionally accepts UTC `Z` suffix. ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com)) |
| **9.7p1** | Same tokens. |
| **9.8p1** | Same tokens. |
| **9.9p1** | Same tokens. Fixes state leakage where authorized-key restrictions from a key whose signature failed could affect a later key. ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com)) |
| **9.9p2** | Same format/options as 9.9p1; security-only portable release. ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com)) |
| **10.0p1** | Same option tokens. |
| **10.1p1** | Same option tokens. |
| **10.2p1** | Same option tokens; fixes a `principals=` matching bug involving comma-containing certificate principal names, preceding the larger 10.3 behavior change. The 10.3 release notes describe the 10.2 defect. ([openssh.com](https://www.openssh.com/releasenotes.html)) |
| **10.3p1** | Same tokens. **Semantic change:** an empty certificate principal list no longer acts like a wildcard when a CA is trusted via `authorized_keys`; wildcard handling of certificate principals was also corrected. ([openssh.com](https://www.openssh.com/releasenotes.html)) |
| **10.4p1** | Same authorized-key token set. |
| **10.5p1** | Same token set. Fixes `restrict` so that it correctly restricts **tunnel forwarding** too. ([openssh.com](https://www.openssh.com/releasenotes.html)) Current parser is `V_10_5_P1/auth-options.c`.  |

Thus the practical schema families are:

```text
8.0–8.1     baseline
8.2–8.3     baseline + [no-]touch-required
8.4–10.5    baseline + [no-]touch-required + [no-]verify-required
```

with semantic/version changes layered on top.

---

## Distribution builds

### Ubuntu 24.04 LTS

The currently published Noble security package is **`1:9.6p1-3ubuntu13.19`**. ([Ubuntu Packages](https://packages.ubuntu.com/noble/openssh-server?utm_source=chatgpt.com))

Its parser language therefore corresponds to upstream **9.6p1**:

- all baseline options;
- `[no-]touch-required`;
- `[no-]verify-required`;
- `expiry-time` with `Z`/UTC support;
- 8.7 first-wins environment semantics.

I found **no Ubuntu Noble patch adding/removing an authorized-key option token or changing the option grammar**. The package carries normal Debian/Ubuntu integration and security backports, but the public Noble package metadata still identifies 9.6p1 as the source base. ([Ubuntu Packages](https://packages.ubuntu.com/source/noble/openssh?utm_source=chatgpt.com))

A caveat: Ubuntu may backport security behavior without changing `ssh -V`, so you cannot derive all semantics from `9.6p1` alone. In particular, future Noble security updates could backport parser or authorization fixes.

### Debian 12 / bookworm

Current package: **`1:9.2p1-2+deb12u10`**. ([Debian Packages](https://packages.debian.org/bookworm/openssh-server?utm_source=chatgpt.com))

Its public quilt patch series is available verbatim. I found no patch that modifies `auth-options.c` or adds an authorized-key option. The patches include GSSAPI, TCP wrappers, SELinux, path/mode policy, documentation, etc. ([Debian Sources](https://sources.debian.org/patches/openssh/1%3A9.2p1-2%2Bdeb12u10/))

One relevant Debian-specific behavior is **file-permission policy**, not line grammar: Debian carries a patch allowing an SSH-sensitive file such as `authorized_keys` to be group-writable when the group contains only that user. ([Debian Sources](https://sources.debian.org/patches/openssh/1%3A9.2p1-2%2Bdeb12u10/))

So for syntax/options, Debian 12 matches upstream 9.2p1. Its security tracker currently still lists some later OpenSSH issues as unfixed/postponed, emphasizing that downstream version numbers do not imply latest upstream semantics. ([Debian Security Tracker](https://security-tracker.debian.org/tracker/source-package/openssh?utm_source=chatgpt.com))

### RHEL 9

RHEL 9 remains based on **OpenSSH 8.7p1**, with an extensive downstream/backport patch stack. A recent RHEL 9.6 erratum, for example, ships `openssh-8.7p1-45.el9_6.4`. ([Red Hat Customer Portal](https://access.redhat.com/errata/RHSA-2026%3A66410?utm_source=chatgpt.com))

The public CentOS Stream/RHEL dist-git shows a very large patch series around that 8.7p1 base. ([GitLab](https://gitlab.com/redhat/centos-stream/rpms/openssh/-/tree/test-ci-10-20250325?utm_source=chatgpt.com))

I did **not find a public RHEL 9 patch that adds or removes an `authorized_keys` option keyword**. Therefore its recognized option language is the 8.7 family:

```text
baseline
+[no-]touch-required
+[no-]verify-required
```

and it includes 8.7's first-wins environment behavior.

However, I cannot make as strong a source-completeness claim for the proprietary RHEL SRPM as for Debian: I verified the publicly visible CentOS Stream 9/RHEL-related dist-git and Red Hat errata, not every historical RHEL subscription SRPM revision. Treat that as **verified to the extent of the public downstream sources**, not proof that no private/update-only patch has ever touched this parser.

---

# 2. Complete line grammar

A useful abstract grammar is:

```text
line :=
    leading-ws? (
        empty
      | "#" arbitrary-bytes
      | options ws+ keytype ws+ base64 [ws+ comment]
      | keytype ws+ base64 [ws+ comment]
    )
```

But this hides several important parser facts.

### Leading whitespace

`sshd` skips leading ASCII space and tab before deciding whether the line is empty/comment/key material. Current code does:

```c
skip_space(&cp);
if (!*cp || *cp == '\n' || *cp == '#')
        continue;
```



OpenSSH 8.0 did the same and already used `getline()`. 

So indented comments such as:

```text
       # comment
```

are comments.

### Blank/comment lines

Blank lines are ignored. A comment line is one whose first non-space/tab byte is `#`. 

`#` is **not** generally an inline comment delimiter in an `authorized_keys` key line. Once the key blob has been parsed, the rest is the comment field and is opaque to authentication.

### Detecting whether the first field is options or key type

The implementation does **not** lex the line into a predefined four-field schema first.

It attempts `sshkey_read()` at the beginning. If that fails, it assumes an options field may be present, advances over an authorized-key option string—including quoted spaces—and then tries `sshkey_read()` again. 

This is important for lossless parsing because “options present” is inferred from whether a valid public-key encoding begins at position zero.

### Options field

Options are comma-separated.

Whitespace terminates the options field unless inside a double-quoted value. The option parser itself stops at space or tab. Unknown syntax causes option parsing to fail. 

Keywords are case-insensitive; the manual expressly documents that. 

The option scanner used to find the end of the options field treats `\"` specially so an escaped quote does not toggle quoted state. The parser family was introduced before 8.0 and the same strategy remains in modern code. ([FreeBSD cgit](https://cgit-dev.freebsd.org/src-test/commit/?h=vendor%2Fopenpam%2FCINERARIA&id=c8a2bf14627149859c5fed86cf127096c4fa2870&utm_source=chatgpt.com))

### Quoting/escaping

Double quotes group a value containing spaces, commas, etc.

For the documented `command` case, a literal quote is represented by escaping the quote with backslash. 

Do **not** implement shell quoting. There are no shell-style single quotes, `$'...'`, generic C escapes, or shell expansion at this lexical layer.

For a lossless editor, preserve the original spelling/escapes instead of dequoting and reserializing unless the user actually edits that field.

### Key types

At 8.0, `sshd(8)` documented:

```text
ecdsa-sha2-nistp256
ecdsa-sha2-nistp384
ecdsa-sha2-nistp521
ssh-ed25519
ssh-dss
ssh-rsa
```



OpenSSH 8.2 added security-key/FIDO algorithms:

```text
sk-ecdsa-sha2-nistp256@openssh.com
sk-ssh-ed25519@openssh.com
```

plus certificate counterparts in the key implementation. ([OpenSSH](https://www.openssh.com/releasenotes.html))

Modern 10.5 documents:

```text
sk-ecdsa-sha2-nistp256@openssh.com
ecdsa-sha2-nistp256
ecdsa-sha2-nistp384
ecdsa-sha2-nistp521
sk-ssh-ed25519@openssh.com
ssh-ed25519
ssh-mldsa44-ed25519@openssh.com
ssh-rsa
```



OpenSSH 10.4 introduced the experimental ML-DSA/Ed25519 composite scheme; its source name is `ssh-mldsa44-ed25519`. ([openssh.com](https://www.openssh.com/releasenotes.html)) Current `sshkey.c` conditionally includes the ML-DSA implementation and security-key implementations depending on build-time features. 

This illustrates another reason **the package build matters**:

- OpenSSL-backed key implementations are conditional on `WITH_OPENSSL`.
- SK implementations are conditional on `ENABLE_SK`.
- ML-DSA is conditional on `USE_MLDSA`.

So the only completely reliable key-type list for an installed server is the installed binary/build, not the upstream release number.

For certificates, OpenSSH has certificate variants such as:

```text
ssh-ed25519-cert-v01@openssh.com
ssh-rsa-cert-v01@openssh.com
ecdsa-sha2-nistp256-cert-v01@openssh.com
sk-ssh-ed25519-cert-v01@openssh.com
sk-ecdsa-sha2-nistp256-cert-v01@openssh.com
...
```

but an authorized-key **CA trust entry normally contains the CA's ordinary public key plus `cert-authority`**, not the user's certificate itself. The certificate's key type exists in `sshkey.c`, but CA authorization is mediated by `cert-authority` and comparison against the certificate's signing key. 

### Base64 blob

The textual public-key representation is:

```text
algorithm-name SP base64(key-blob)
```

The decoded key blob is the same wire-format public-key structure used in SSH. OpenSSH's `PROTOCOL` explicitly states this. 

A syntactically plausible Base64 string is insufficient: `sshkey_read()` decodes and parses the binary key and verifies that its algorithm/type is consistent.

### Comment

Everything after the successfully parsed public-key encoding is semantically ignored by sshd as the key comment. The man page says the comment “is not used for anything”. 

Therefore you should treat it as an opaque byte-preservation region, not normalize it.

### Maximum line length: documentation is wrong for these releases

The `sshd(8)` man page has long claimed an **8 KiB line limit**. It said so in 8.0  and still says so in 10.5. 

But actual server code in **both 8.0 and 10.5 uses POSIX `getline()` with a dynamically growing buffer and imposes no 8 KiB per-line limit at this layer**.  

So:

> **Documentation-only claim:** 8 KiB maximum.  
> **Source-confirmed sshd behavior:** no 8 KiB line-length check in the authorized-keys file reader for 8.0–10.5.

This is probably the clearest documentation/source counterexample relevant to your panel.

Practical limits still arise from allocation limits and from limits on the decoded key itself, but **do not truncate a line to 8192 bytes just because the man page says 8 KiB.**

### Encoding

There is no UTF-8 decoding layer for `authorized_keys`.

The file is consumed as bytes through C `FILE *` / `getline()`, and the meaningful syntax is ASCII-oriented:

- spaces/tabs;
- commas;
- quotes/backslashes;
- ASCII option names;
- ASCII Base64;
- algorithm names.

The comment and quoted string content are not globally required to be valid UTF-8.

Consequently, for source-of-truth editing you should treat the file as **bytes**, not as a UTF-8 document. Display invalid byte sequences with an escaped/lossless representation.

Embedded NUL is especially problematic because subsequent parser operations use NUL-terminated C strings; content after an embedded NUL is not part of the effective line from the parser's perspective even though `getline()` read it.

### CRLF

OpenSSH's logical parser is written around Unix text files and strips/recognizes `\n`, spaces, and tabs in the relevant places. Do not silently normalize CRLF to LF when your invariant is byte preservation. A file may be accepted in some contexts while retaining `\r` in otherwise opaque trailing material.

---

# 3. What happens to malformed entries?

For the releases covered here, **a malformed individual authorized-key line does not reject the entire file**.

The file reader loops line-by-line. A failure to:

- find a key,
- find the end of the options field,
- parse options,
- decode the key,
- or satisfy the options

causes that candidate line to return failure, and scanning continues to later lines. 

For example, current code:

```c
if ((keyopts = sshauthopt_parse(...)) == NULL) {
        ...
        goto out;
}
```

returns failure for that line, while `auth_check_authkeys_file()` continues iterating. 

OpenSSH 8.0 already had the same per-line scan model. 

So the relevant distinction is:

```text
bad line                  -> skip/non-match that line
good later line           -> may still authenticate
bad whole-file ownership  -> file may be ignored entirely
open/read failure         -> file unavailable
```

`StrictModes`, ownership/type/path checks happen when opening the file and can cause the **whole file** to be ignored before individual lines are considered. Current `auth_openfile()` confirms this. 

Also distinguish **syntactically valid but unusable** from parse errors. Examples include:

- an expired `expiry-time`;
- a nonmatching `from`;
- wrong certificate principal;
- key below `RequiredRSASize`;
- key algorithm excluded by `PubkeyAcceptedAlgorithms`;
- `cert-authority` attached to a line being considered for a plain key.

Those do not necessarily make the line syntactically malformed; they make the candidate fail authorization.

---

# 4. Semantic changes that don't change grammar

These are particularly dangerous for a structured panel because a pure syntax version table misses them.

**8.1 — forwarding-option count limits.**  
OpenSSH added a cap on `permitopen`/`permitlisten` occurrences. ([OpenSSH](https://www.openssh.com/releasenotes.html))

**8.7 — `environment=` first-wins.**  
Repeated environment names changed behavior and became bounded. ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com))

**9.6 — UTC expiry syntax.**  
`Z` became valid on absolute times. ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com))

**9.9 — failed signatures and accumulated key options.**  
OpenSSH fixed a bug where restrictions from a candidate key could be incorrectly left in force after signature verification failed. ([OpenSSH](https://www.openssh.org/releasenotes.html?utm_source=chatgpt.com))

**10.2/10.3 — certificate principals.**  
10.2 had an incorrect comma-related principal-match algorithm; 10.3 changed empty-principal semantics from wildcard-like to never-match and cleaned up wildcard behavior. ([openssh.com](https://www.openssh.com/releasenotes.html))

**10.5 — `restrict` finally restricts tunnels as intended.**  
The recognized token did not change; its enforcement did. ([openssh.com](https://www.openssh.com/releasenotes.html))

This last one is a textbook example of why “same option parser” does **not** mean “same semantics”.

---

# 5. OpenBSD-current vs Portable vs distro packages

Treat these as three different authorities.

**OpenBSD-current** is the development source from which most core OpenSSH changes originate. Its CVS revisions may precede a Portable release and may include OpenBSD-specific assumptions.

**OpenSSH Portable** is a synchronized port plus portability code. For Linux VPSes, the Portable release tag—e.g. `V_10_5_P1`—is the correct upstream baseline. The current 10.5 parser I cited above is exactly from that Portable tag. 

**Distribution package source** is the final authority for a distro-installed `sshd`. Debian demonstrates why: it carries substantial downstream behavior such as GSSAPI support and relaxed secure-file group-write policy while preserving upstream authorized-key option grammar. ([Debian Sources](https://sources.debian.org/patches/openssh/1%3A9.2p1-2%2Bdeb12u10/)) RHEL has an even larger patch stack around its nominal 8.7p1 base. ([GitLab](https://gitlab.com/redhat/centos-stream/rpms/openssh/-/tree/test-ci-10-20250325?utm_source=chatgpt.com))

Therefore, do **not** map:

```text
ssh -V says OpenSSH_8.7p1
```

to “exactly upstream 8.7p1 semantics.”

On RHEL in particular that inference is false in general because years of fixes have been backported without rebasing the visible upstream version.

---

# 6. Reliable future-change detection

For your application I would make capability discovery reproducible and machine-generated.

Use a pipeline with four inputs for every supported build:

1. **Actual package identity**
   ```sh
   ssh -V
   dpkg-query -W openssh-server
   rpm -q openssh-server
   ```
   plus distro/repository identity.

2. **Exact source package**
   Obtain the distro source corresponding to the installed binary, apply its patch series, and retain its source-package checksum/version.

3. **Static parser extraction**
   Diff at least:
   ```text
   auth-options.c
   auth-options.h
   auth2-pubkeyfile.c / older auth2-pubkey.c
   sshkey.c
   sshkey-*.c
   misc.c
   sshd.8
   ```
   across the previous and new build.

   Specifically flag changes to:
   ```text
   sshauthopt_parse()
   opt_flag()
   opt_match()
   opt_dequote()
   sshkey_read()
   keyimpls[]
   auth_check_authkey_line()
   auth_check_authkeys_file()
   auth_authorise_keyopts()
   match_principals_option()
   sshauthopt_merge()
   ```

4. **Black-box corpus test**
   Start that exact `sshd` build in a container/VM and feed a generated `authorized_keys` corpus containing:
   - every known option;
   - positive/negative forms;
   - every pair of conflicting flags in both orders;
   - duplicate singleton options;
   - repeated environment names;
   - boundary counts 1024/1025/1026 and 4096/4097/4098;
   - quoted commas/spaces/escaped quotes;
   - malformed quotes;
   - unknown option;
   - every supported key type;
   - oversized lines;
   - NUL-containing files;
   - certificate principal edge cases.

The CI should fail when either the static token set or observed acceptance/semantics changes.

The most useful artifact to generate is not “OpenSSH version → schema”; make it:

```text
package build fingerprint
    -> lexical grammar version
    -> option-token set
    -> semantic quirks/features
    -> compiled key implementations
```

For example:

```json
{
  "package": "openssh-server 1:9.6p1-3ubuntu13.19",
  "options": {
    "touch-required": true,
    "no-touch-required": true,
    "verify-required": true,
    "no-verify-required": true
  },
  "semantics": {
    "env_duplicate": "first-wins",
    "expiry_utc_z": true,
    "restrict_tunnel": false
  }
}
```

That last `restrict_tunnel` field is deliberately separate from parser capability: an older Ubuntu/RHEL build may recognize `restrict` perfectly while still lacking the 10.5 fix.

---

## What I could not fully verify

I could verify the upstream parser against exact Portable release tags including `V_8_0_P1`, `V_8_2_P1`, `V_8_4_P1`, and `V_10_5_P1`, and I verified Debian 12's published `+deb12u10` patch series.     ([Debian Sources](https://sources.debian.org/patches/openssh/1%3A9.2p1-2%2Bdeb12u10/))

For **RHEL 9**, I verified Red Hat's package/errata version and the publicly visible CentOS Stream 9/RHEL-related dist-git, but I did not have an authenticated Red Hat source-RPM channel with which to reconstruct and hash every current RHEL 9 SRPM patch. I therefore cannot state with mathematical certainty that no subscription-only RHEL patch changes an obscure `authorized_keys` semantic. ([Red Hat Customer Portal](https://access.redhat.com/errata/RHSA-2026%3A66410?utm_source=chatgpt.com))

For **Ubuntu Noble**, I verified the current published package/source version, but did not independently unpack and mechanically diff every file in `9.6p1-3ubuntu13.19` against upstream during this answer. I found no published indication of a Noble-specific authorized-key grammar extension. ([Ubuntu Packages](https://packages.ubuntu.com/source/noble/openssh?utm_source=chatgpt.com))

The two most significant confirmed documentation/source disagreements are therefore:

- the manual's persistent **8 KiB line limit**, while `sshd` actually uses unlimited `getline()` in both 8.0 and 10.5;    
- the manual documenting only `no-touch-required` / `verify-required`, while the parser also accepts **`touch-required` and `no-verify-required`**.  

For a byte-preserving VPS control panel, those two discrepancies alone are enough reason **not to derive the editable grammar from man pages**.
