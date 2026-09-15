# Compare SSH Validation Methods

Source: https://chatgpt.com/share/6aa8714b-5d8c-83ed-bfec-742e0d6693ed

---

**User**

Context: A web control panel manages Linux VPS instances. Customers have root and can change anything on the instance. The panel connects over SSH and edits OpenSSH authorized_keys files through structured forms, with the files on the server as the source of truth. Before or after writing an entry, the panel needs to tell the customer whether the installed sshd will accept that entry and what it will mean. Known facts: `sshd -t` checks the server configuration but accepts authorized_keys entries that authentication later rejects, and `ssh-keygen -l` checks a public key but not the options around it.

Question: Which methods can determine, with high fidelity, that a specific sshd build will accept a specific authorized_keys entry and apply its options as intended?

Evaluate at least: reimplementing the parser from the OpenSSH source; compiling or linking OpenSSH's own parsing code into a separate validator; running sshd in debug or test modes against a temporary configuration; a loopback authentication test on the target machine with a temporary key; `sshd -T`, `ssh -G`, and `ssh-keygen` checks; an AuthorizedKeysCommand-based approach; and any other method you find. For each method, report: what it proves and does not prove, behavior across versions and patched builds, cost and risk when run on a customer's machine, failure modes, security risks, and maintenance cost.

Evidence rules: Cite OpenSSH source at exact tags or commits and man pages at matching versions. Describe a reproducible experiment for every claim about runtime behavior. Include cases where a method gives a wrong answer. Do not recommend a method until you have compared all of them; if no method is sufficient, say so.

---

**ChatGPT**

I’ll treat “high fidelity” as “answers for the exact installed `sshd` binary, its compiled feature set/patches, and the effective server configuration—not merely upstream OpenSSH syntax.” I’ll compare static/source-derived approaches against experiments that actually drive the authentication path, and I’ll call out where a method can say “valid” while the daemon still rejects or gives different semantics.

---

**ChatGPT**

The upstream code already shows why a “parser-only” answer is incomplete: parsing an option string is only one stage. Later stages perform context checks (`from=`, expiry, CA/principal consistency), merge key/certificate options, and then session code enforces command/forwarding/PTY/environment behavior. A validator has to decide which of those stages it is claiming to model.

---

**ChatGPT**

A useful version-drift example emerged: OpenSSH 10.5 (released August 11, 2026) fixed `restrict` so it actually restricts tunnel forwarding; 10.4 also fixed a regression where key options could be applied after a failed signature. Those are exactly the kinds of discrepancies a cloned parser or “what the man page says” validator can miss for a particular installed build.

---

**ChatGPT**

For this problem, “valid authorized_keys entry” is not one property. OpenSSH makes several distinct decisions: the line must parse; the key/certificate must be authorized in a connection context; a signed authentication may have to succeed; and, after authentication, the resulting options interact with server policy and session/channel code. In OpenSSH 10.5p1, the single-line routine `auth_check_authkey_line()` parses the key and options, compares the actual key/CA, performs context-dependent authorization, and merges certificate options; `from=` depends on the actual remote host/IP and `expiry-time` on the current clock. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c))

That distinction matters because a method can be an excellent **parser oracle** and still be a bad **behavior oracle**.

## Comparison

| Method | Exact installed build? | Entry syntax / key match | Context authorization | Signature/authentication | Option semantics | Machine risk | Maintenance |
|---|---|---|---|---|---|---|---|
| Reimplement OpenSSH parser | No, unless continuously matched | High for modeled version | Only what you model | No | Only what you model | Very low | **Very high** |
| Build OpenSSH's parsing code into helper | Only if built from exact source/patches | **Very high** | Potentially high if enough code is imported | No | No, unless much more of sshd is imported | Low | High |
| `sshd -t` / `-T` / current `-G` | Uses installed binary | **No authorized_keys validation** | No | No | Gives useful global/effective config only | Low | Low |
| `ssh -G` | Client only | No | No | No | No | Negligible | Low |
| `ssh-keygen -l` / `-L` | Installed utility, not sshd parser | Key/certificate blob only | No | No | No authorized_keys options | Negligible | Low |
| Exact installed `sshd`, isolated, unsigned public-key query | **Yes** | **Yes** | **Yes, for simulated connection context** | No signature | Does not activate/test session options | Moderate | Moderate |
| Exact installed `sshd`, isolated, signed login + behavioral probes | **Yes** | **Yes** | **Yes, for simulated context** | **Yes**, if exact private credential available | **Highest pre-production fidelity** | Moderate–high | Moderate–high |
| Authentication through live production sshd | **Yes; actual running service** | **Yes** | **Yes, for that connection** | Yes if signed | Yes if actively tested | **High operational risk** | Moderate |
| Production loopback with temporary key | Yes | Yes | Wrong context for `from=`/address-dependent `Match` | Yes for temporary key | High for what you probe | **High** | Moderate |
| `AuthorizedKeysCommand` alone | No; it is a key source, not validator | Its output is subsequently parsed by sshd | Only when invoked by sshd | No by itself | No by itself | Production use can be invasive | Low–moderate |
| Protocol-level unsigned public-key probe against live sshd | **Yes** | **Yes for the queried key** | **Yes for that connection** | No | No | Low–moderate | Moderate |
| ptrace/gdb/eBPF/LD_PRELOAD instrumentation | Exact process possible | Potentially | Potentially | Potentially | Potentially | **Very high** | Very high |

The two strongest techniques are therefore different: an **unsigned public-key query to an isolated copy of the exact installed sshd** is unusually good for asking “would this daemon authorize this exact public key/entry?”, while **a signed connection followed by explicit behavioral probes** is required if “apply its options as intended” is meant literally.

---

## 1. Reimplement the authorized_keys parser

This can give a fast, side-effect-free UI validator. If you reproduce `sshauthopt_parse()` and the surrounding key-line rules precisely, you can catch quoting, commas, option names, argument syntax and key decoding. At 10.5p1, `auth_check_authkey_line()` first attempts to read a key, otherwise skips the option field, reads the key, calls `sshauthopt_parse()`, compares the key/CA, then performs authorization checks. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c)) The current option parser sets fields such as the `restrict` flag and disables forwarding/PTY/etc. in its returned `sshauthopt`; malformed/unrecognised material eventually produces `unknown key option`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth-options.c))

What it **does not prove** is more important. It is not necessarily the code in the customer's executable. A distro may backport changes, apply downstream patches or build different features; a customer with root can replace sshd entirely. It also doesn't prove time/address/certificate conditions, signature behavior, or whether session/channel code enforces a parsed flag correctly.

There is a particularly strong real wrong-answer case. The OpenSSH 10.4p1 man page said `restrict` enabled “all restrictions”, including future restrictions. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_4_P1/sshd.8)) Its parser duly treated `restrict` as a restriction, but `server_request_tun()` in 10.4p1 checked `PermitTunnel` and global `DisableForwarding` without consulting the key's `restricted` flag. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_4_P1/serverloop.c)) Commit **`d322f2c`** fixed this, and OpenSSH 10.5's release notes explicitly say `restrict` was fixed to apply correctly to tunnel forwarding. ([GitHub](https://github.com/openssh/openssh-portable/commit/d322f2c))

**Reproducible experiment E1:** build OpenSSH `V_10_4_P1` and `V_10_5_P1` in disposable VMs/namespaces. Configure `PermitTunnel yes`; authorize a test key as `restrict <key>`. Authenticate and request a TUN device (`ssh -w ...`). On 10.4p1 the TUN authorization path lacks the `restricted` check; repeat against 10.5p1 to observe the fix. Do this only in a disposable namespace/VM because TUN setup has network side effects. This is a concrete case where a parser-derived interpretation and even the matching 10.4 documentation produce the wrong behavioral answer.

A parser clone remains valuable for explaining entries in the UI, but its maintenance burden is high: every OpenSSH release, vendor patch and semantic fix becomes your problem.

## 2. Compile or link OpenSSH's parser into a validator

This is stronger than reimplementation for syntax. Calling the same revision's `sshauthopt_parse()` eliminates many transcription differences. Importing `auth_check_authkey_line()` goes further: that function is specifically documented in source as checking one authorized_keys-format line, returning the options on success. It also applies contextual checks and handles certificate-option merging. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c))

But OpenSSH does not expose this as a stable validator ABI. `auth_check_authkey_line()` depends on OpenSSH internal types and more of sshd's authentication machinery. The further you pull the dependency graph, the closer you get to building a second sshd. A helper built from pristine upstream 10.5p1 does not prove the behavior of Ubuntu's, RHEL's, a vendor's, or the customer's locally patched 10.5p1 executable.

**Experiment E2:** build the helper from pristine `V_10_5_P1`, then change one option-recognition branch in an sshd build while retaining the same externally displayed version. Feed the changed option to both. The helper and daemon disagree. Repeat by rebuilding the helper from the exact patched tree; syntax agreement returns, while the helper still cannot reveal a bug such as the 10.4 tunnel-enforcement defect.

Security risk is much lower than starting a daemon, but build and packaging maintenance is significant. It is a very good *source-version parser oracle*, not an installed-binary semantics oracle.

## 3. `sshd -t`, `sshd -T`, and server `sshd -G`

These solve a different problem. In the 10.5p1 `sshd(8)` man page, `-t` checks configuration validity and host-key sanity. `-T` prints the effective server configuration and additionally performs the `-t` checks; `-C` supplies connection parameters such as user and source address so matching `Match` blocks can be evaluated. Current 10.5p1 also has `-G`, which parses and prints effective configuration. None is specified to parse authorized_keys. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8))

They are extremely useful **adjuncts**, because option meaning depends on server configuration. For example, session code combines the per-key forwarding permission with `DisableForwarding` and `AllowTcpForwarding`; a key cannot make globally forbidden forwarding available. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/session.c)) Likewise, server `ForceCommand` wins over a key's `command=` option in 10.5p1 session code. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/session.c))

**Experiment E3:** create a syntactically valid sshd configuration and an authorized_keys line beginning with an unknown option, e.g. `this-option-does-not-exist <valid-key>`. `sshd -t`/`-T` still validate the server configuration; an actual authorization attempt using that line is rejected by `sshauthopt_parse()`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth-options.c)) This is the simplest demonstration that `-t`/`-T` are not authorized_keys validators.

Cost and risk are low, so they should be used to determine effective policy, but a successful exit is not evidence that an entry works.

## 4. `ssh -G`

`ssh -G` evaluates **client** `Host` and `Match` configuration and exits. That is exactly how the matching 10.5p1 `ssh(1)` describes it. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh.1)) It says nothing about the server's authorized_keys file.

**Experiment E4:** run `ssh -G target` before and after replacing a server authorized_keys line with the unknown-option line from E3. Its output is unchanged. No server authentication is performed.

It is essentially irrelevant to server-side validation except when debugging the client parameters used by a separate end-to-end test.

## 5. `ssh-keygen`

`ssh-keygen -l` proves that it can obtain a public key and fingerprint it; the matching 10.5p1 man page says exactly that. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh-keygen.1)) It is not an authorized_keys option parser.

This distinction is particularly dangerous because `ssh-keygen` intentionally accepts formats where material precedes a key. Its fingerprint path ultimately finds and reads a public key; it never substitutes for `sshauthopt_parse()`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh-keygen.c))

**Experiment E5:**
```sh
ssh-keygen -q -t ed25519 -N '' -f /tmp/ak-test

{
    printf 'this-option-does-not-exist '
    cat /tmp/ak-test.pub
} >/tmp/candidate

ssh-keygen -lf /tmp/candidate
```

A fingerprintable key does not imply that sshd accepts the surrounding options. Feed `/tmp/candidate` to the 10.5p1 authorization path: the sshd option parser rejects the unknown option. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth-options.c)) `ssh-keygen -L` is similarly useful for inspecting a certificate's contents, but it cannot decide how an authorized_keys CA line, server policy and certificate options combine.

Risk is negligible and maintenance low. Keep it as a **key/blob sanity check**, not the verdict.

## 6. Run the exact installed sshd under a temporary configuration

This is the first method that can give high fidelity to an arbitrary patched build without reproducing its source.

`sshd -d` uses the daemon itself in debug mode, stays in the foreground, does not fork and handles one connection; `-D` also prevents detaching. These properties are documented in the matching 10.5p1 man page. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) You can launch the exact executable on a loopback-only high port with a temporary host key and temporary configuration.

A particularly useful way to inject the candidate without modifying the customer's authorized_keys is:

```text
AuthorizedKeysFile none
AuthorizedKeysCommand /root-owned/path/emit-candidate
AuthorizedKeysCommandUser dedicated-user
```

The 10.5p1 man page requires the command to be absolute, root-owned and not group/world-writable, and specifies that it writes authorized_keys-format lines. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5)) More importantly, the 10.5p1 source shows that stdout from `AuthorizedKeysCommand` is passed to **the same `auth_check_authkeys_file()` used for ordinary keys**, with the candidate key and connection's remote IP/hostname. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c))

That gives you the exact installed parser and authorization code.

However, there are two substantially different tests you can perform against this daemon.

### Unsigned public-key query

SSH public-key authentication supports a request without a signature. In OpenSSH 10.5p1, the unsigned branch calls `mm_user_key_allowed()` on the key and sends `SSH2_MSG_USERAUTH_PK_OK` if the key is allowed. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c)) The signed branch separately requires both `mm_user_key_allowed()` and a successful cryptographic signature check. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c))

This is almost tailor-made for the panel's pre-write problem: you possess the public key but normally should not possess the customer's private key.

It proves that the **exact executable** recognizes the entry and authorizes that public key for the supplied user/address/time/certificate context. `user_key_allowed()` also rejects revoked keys before scanning sources. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c)) `auth_check_authkey_line()` checks `from=`, expiration and certificate relationships before declaring a candidate key usable. For `from=`, the actual remote host and IP are passed through `match_host_and_ip()`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c))

It does **not** prove that the signature will work, that a FIDO authenticator will satisfy its requirements, that a multi-factor `AuthenticationMethods` chain completes, or that session restrictions are subsequently enforced.

**Experiment E6:** use a tiny SSH protocol test client or instrumented OpenSSH client to issue the `publickey` method with the signature-present flag false. Against the isolated sshd and candidate from its AuthorizedKeysCommand, observe `SSH2_MSG_USERAUTH_PK_OK`. Then send the same request with a deliberately invalid signature: the signed branch fails. This reproduces the exact distinction visible in the 10.5p1 source. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c)) A second variant configures `AuthenticationMethods publickey,password`: the key can receive PK_OK while public-key authentication alone cannot complete the configured authentication sequence.

I would implement the unsigned probe at protocol/library level rather than make parsing `ssh -vvv` output part of the panel API.

### Signed login plus behavioral probes

If you possess a matching test private key, a complete authentication goes through signature verification and activates the returned key options. It is then possible to actually request a PTY, forwarding, a forced command, environment variables, agent/X11 forwarding or a tunnel.

That is the only general way to catch bugs in **enforcement**, such as the 10.4 `restrict`/TUN defect.

For arbitrary customer-supplied public keys you normally do not have the private half. You can substitute a panel-generated key while preserving the options field, which tests the option behavior but no longer proves key/certificate-specific properties of the original entry.

**Experiment E7:** emit
```text
restrict,command="/controlled/test-program" <panel-test-key>
```
from the isolated daemon's AuthorizedKeysCommand, authenticate with its corresponding private key, then independently request a PTY, TCP forwards and a different command. Record whether the requests succeed and what `/controlled/test-program` sees as `SSH_ORIGINAL_COMMAND`. Repeat with one restriction removed at a time. For forwarding, compare results with the effective `AllowTcpForwarding`/`DisableForwarding` values; 10.5p1 session code explicitly combines them. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/session.c)) For `command=`, repeat with a server `ForceCommand` and observe that the server-level command takes precedence, matching `do_exec()`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/session.c)) TUN tests belong in a network namespace/VM, not on the customer's normal networking stack.

The major risks are starting another root sshd, exposing the test port accidentally, launching PAM/session/forced-command hooks, creating PTYs or forwards, generating audit records, and cleanup failure. Bind only to loopback or a private network namespace; use an unpredictable root-owned temporary directory; don't interpolate the authorized_keys text into a shell command; cap runtime/process/resources; and use a dedicated nonprivileged AuthorizedKeysCommand account. A sandbox that changes PAM, NSS, SELinux/AppArmor, filesystem layout or source address can itself create false results.

## 7. Loopback authentication against the live sshd

This executes the real production listener and therefore gets the real config, libraries, PAM/account policy, filesystem and running daemon. It is excellent evidence for the **particular loopback connection you made**.

It is nevertheless not a universally correct oracle. `from=` is explicitly evaluated using the actual remote host/IP. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c)) The same is true for address-dependent `Match` configuration, which `sshd -T -C` exists partly to model. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8))

A straightforward wrong-answer case is:

```text
from="127.0.0.1" ssh-ed25519 AAAA...
```

**Experiment E8:** authenticate from `127.0.0.1`; then authenticate with the same credential from a second VM/network namespace with a non-loopback source. The former succeeds and the latter is denied by `auth_authorise_keyopts()`. Reverse the CIDR and a loopback test can become a false negative instead. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c))

Temporarily adding a generated root key to the production file is operationally worse: a crash can leave a credential behind, another administrator can race your edit, forced commands/PAM/audit hooks may run, and a session probe can alter the machine. Given that your customers already have root, the threat model is unusual, but your control panel still should not introduce an unnecessary long-lived credential.

## 8. AuthorizedKeysCommand as a “validator”

By itself, it is not one. It is merely another authorized-key **source**. The man page says it is tried after ordinary AuthorizedKeysFile files and isn't run if a matching key was already found there. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd_config.5))

Changing a customer's production sshd configuration just to install a validator command would therefore be a poor fit. It changes production behavior and can be bypassed by an earlier file match.

Its value is as an **injection mechanism for the isolated exact-daemon experiment**. The source confirms that its stdout is parsed by the same authorization path, making it much better than inventing a separate parser. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c))

A safe experiment helper should literally read the candidate from a root-controlled file descriptor/file and emit the bytes to stdout. Do not construct:

```sh
/bin/sh -c "printf '$USER_SUPPLIED_AUTHORIZED_KEYS'"
```

because values such as `command="..."` are untrusted text and must never acquire shell semantics in the validator machinery.

It also won't test `StrictModes` or the ownership/mode of the customer's actual authorized_keys path, because you have deliberately replaced that source.

## 9. An after-write unsigned probe to the production sshd

This deserves separate treatment from a full loopback login. After writing the real entry, an unsigned public-key query to the actual listener asks the real running sshd whether that **exact public key** is allowed in the connection context without possessing or using its private key.

The relevant 10.5p1 server branch calls `mm_user_key_allowed()` and returns PK_OK but does not verify a signature. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkey.c)) This is a strong post-write sanity check.

**Experiment E9:** write a valid entry, send the unsigned query and observe PK_OK. Change only the line to an unknown option and repeat: no PK_OK. Change it to `from="127.0.0.1"` and compare a loopback probe with a probe originating from the control panel's normal network path. The differing result is intentional and demonstrates that the answer is connection-context-specific.

Its side effects are much smaller than an authenticated session, but it is not completely inert: it is an authentication attempt, so expect logging and potentially rate/penalty mechanisms. It still cannot prove signature or session semantics.

## 10. Binary instrumentation and provenance

Hashing the running sshd executable, recording package provenance and `sshd` version are useful for caching results and choosing an explanatory parser. They are not validation themselves. With root customers, neither a package version nor upstream tag establishes that the binary wasn't replaced or patched.

You could attach a debugger, inject a library, trace functions with eBPF/uprobe machinery, or arrange to call internal functions inside the process. In principle that can observe the exact implementation. In practice it is much more dangerous than starting a private sshd: attaching to the production authentication daemon can perturb or crash it, crosses distro/kernel hardening boundaries, and is exceptionally version-dependent. I would reserve such methods for engineering diagnostics.

A useful maintenance technique is differential CI: for every supported upstream tag and important distro build, feed a corpus/fuzzer into your explanatory parser and into an isolated real sshd. That detects parser drift early, but it still is not a per-machine oracle.

---

## What “meaning” actually requires

Even after a line has been accepted, the options don't constitute an isolated policy language. In 10.5p1:

- `restrict` sets per-key forwarding/agent/X11/PTY/user-rc flags in the parser. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth-options.c))
- Runtime forwarding combines those flags with global forwarding policy. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/session.c))
- `command=` can be superseded by server `ForceCommand`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/session.c))
- `from=` is evaluated against connection address/hostname and can reject a perfectly parseable key. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c))
- `expiry-time` is checked against `time(NULL)`, so acceptance changes over time without the file changing. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c))
- Certificate options are separately parsed/authorized and merged with the authorized_keys options, so the meaning of a CA line cannot always be established from that line alone. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/auth2-pubkeyfile.c))

The 10.4→10.5 `restrict` fix demonstrates that even understanding all those fields from the parser does not guarantee that runtime enforcement has no bug. ([OpenSSH](https://www.openssh.org/txt/release-10.5))

## Recommendation after comparing the methods

There is **no single method that can, in general, prove both “this exact entry will authenticate” and “every option will have its intended production effect” without actually exercising the relevant authentication/session behavior in an equivalent production context**. In particular, if you do not possess the customer's private credential, full signed-authentication fidelity is impossible; and address-dependent options make a loopback result inherently contextual.

For a control panel, I would use a layered result rather than one “valid/invalid” boolean:

1. **Use the installed binary as the authority.** Record the actual executable/hash and use `sshd -T -C ...` to obtain the effective configuration for the intended user/address context. Version/package information is advisory and useful for explanations/cache invalidation, not proof.
2. **For pre-write acceptance, launch the exact installed sshd in a tightly isolated one-connection configuration and inject the exact candidate through AuthorizedKeysCommand. Send an unsigned public-key query for the exact key.** This is the best combination of exact-build fidelity, no need for customer private keys, and avoiding modification of the real authorized_keys.
3. **Maintain a parser/model for explanations, not authority.** Use it to turn the accepted line plus effective configuration into statements such as “PTY denied”, “TCP forwarding limited to…”, or “only valid from…”. Test that model differentially against real OpenSSH builds.
4. **For options whose actual enforcement matters, use isolated signed behavioral probes with a disposable panel-controlled key carrying the same option string.** This is especially warranted for forwarding, TUN, forced-command, PTY, environment and future options whose semantics extend outside the parsing code. Mark this as an option-semantics test, not proof about the customer's original cryptographic credential.
5. **After writing, optionally issue an unsigned query to the production listener using the original public key.** This gives a very strong “the running daemon currently authorizes this key from this source/context” check without inserting another private credential or opening a session.
6. Expose the evidence level to the customer: e.g. **“parsed by exact daemon”**, **“authorized for simulated source 203.0.113.x”**, **“authorized by running production daemon from panel source”**, **“signed authentication tested”**, and **“session restrictions actively verified.”** That is more accurate than pretending OpenSSH exposes a comprehensive authorized_keys lint mode.

I would specifically **not** make `sshd -t/-T`, `ssh-keygen`, a version-keyed parser, or a temporary production root key the authoritative validator. The first three provably miss classes of failures; the last obtains fidelity by taking considerably more operational/security risk than the isolated-daemon + unsigned-query design.
