# OpenSSH Login Discovery

Source: https://chatgpt.com/share/6aa8715d-6728-83eb-b70f-9d36c000f6bd

---

**User**

Context: A web control panel connects over SSH to customer Linux machines where the customer has root and can change the SSH server configuration, the accounts, and even the operating system. The panel wants to show which accounts can sign in with keys and which authorized_keys files apply to each account, discovering this from the live system instead of assuming default paths.

Question: How can a program reliably determine, on a live Linux machine, which accounts can sign in with public keys and which authorized key sources apply to each?

Cover: AuthorizedKeysFile and its tokens, multiple files, Match blocks, Include files, AuthorizedKeysCommand, AuthorizedPrincipalsFile and certificate authorities, StrictModes and file permission requirements, PermitRootLogin, PubkeyAuthentication, AllowUsers and DenyUsers, account shells that forbid login, and PAM effects. Evaluate `sshd -T` with `-C user=,host=,addr=` and its limits, including the difference between the configuration on disk and the settings of the running daemon. Cover machines that run another SSH server (for example Dropbear) or no SSH server. Give the smallest set of commands that answers the question, how to report partial answers, and how each approach fails.

Evidence rules: Cite OpenSSH source and man pages at exact versions. Describe reproducible experiments for runtime claims. Include counterexamples where discovery gives a wrong or incomplete answer.

---

**ChatGPT**

I’ll ground this in specific OpenSSH releases/source, separate “what config files say” from “what the daemon actually enforces,” and then reduce it to a minimal command sequence with explicit confidence/unknown states. I’ll also include experiments that demonstrate the failure modes rather than treating `sshd -T` as an oracle.

---

**ChatGPT**

One important distinction is already clear from OpenSSH 10.5p1: `-T -C` computes an effective configuration for a *synthetic connection* and validates files/keys, but it is a fresh parse by the invoked `sshd`; it does not query the resident daemon. The daemon only rereads config on SIGHUP by re-execing itself, so “on disk now” and “what the listener is enforcing now” can diverge.

---

**ChatGPT**

The other subtle trap is “login shell.” OpenSSH 10.5p1 only rejects a non-chrooted account pre-auth when its shell is missing, non-regular, or has no execute bit; an executable `/usr/sbin/nologin` therefore passes that *account-validity* check and can still reject the session afterward. So the panel should report “public-key authentication eligibility” separately from “interactive shell usability.”

---

**ChatGPT**

There is no single inspection command that can answer this exactly for every live Linux machine. For OpenSSH, the strongest static answer is “what a newly started copy of this exact `sshd` binary would do for this connection context, using the configuration currently on disk.” The strongest runtime answer is an actual authentication attempt against the resident listener. Those are deliberately different claims.

For the OpenSSH details below, I am referring specifically to **OpenSSH portable 10.5p1, tag `V_10_5_P1`**. Its `sshd_config(5)` source is dated August 8, 2026, and its `sshd(8)` source July 11, 2026. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

## The right model

“User X can sign in with a public key” is not really a property of user X. It is a predicate closer to:

```text
may_login(user, remote_addr, remote_hostname,
          local_addr, local_port, offered_key_or_cert,
          time, current_external_policy)
```

`Match Address`, `Match Host`, `AllowUsers user@host`, `authorized_keys` `from=`, certificate validity, key expiry, PAM, and dynamic key commands can all change the answer. Therefore a control panel should either answer **for a specified connection context**—usually “from this panel, to this listener, now”—or display a conditional result rather than one global yes/no.

It is useful to distinguish three questions:

| Question | Can static discovery answer it? |
|---|---|
| Is public-key authentication configured as a possible method for this account/context? | Usually, for OpenSSH |
| What key/certificate sources would `sshd` consult? | Usually, except dynamic sources |
| Would a particular key successfully establish a usable session against the daemon that is running right now? | Only reliably by actually trying it |

`sshd -T -C ...` is excellent for the first two, but not sufficient for the third.

## What `sshd -T -C` actually gives you

In 10.5p1, `sshd -T` parses the configuration, fills defaults, applies supplied `Match` criteria, prints the effective configuration, performs the additional sanity checks of `-t`, and exits. `-C` accepts `addr`, `user`, `host`, `laddr`, `lport`, and `rdomain`; `host` means the resolved source hostname. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

A good invocation is therefore conceptually:

```bash
/path/to/the-actual-sshd -T \
    <same relevant -f/-o options as the daemon> \
    -C "user=$user,host=$remote_host,addr=$remote_addr,laddr=$local_addr,lport=$local_port,rdomain=$rdomain"
```

Supplying only `user=,host=,addr=` is **not generally enough**. A configuration may contain `Match LocalAddress`, `LocalPort`, or `RDomain`. In test mode, omitted criteria cause such blocks not to match, which can silently produce the wrong effective configuration. `Match Group` is special: 10.5p1 derives membership using an NSS lookup for the supplied `user`; `Match Version` is compared with the version string of the `sshd` binary executing the test. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

For example:

```text
PubkeyAuthentication yes

Match LocalPort 2222
        PubkeyAuthentication no
```

then:

```bash
sshd -T -C user=alice,host=client,addr=192.0.2.1
```

can report `pubkeyauthentication yes`, while adding `lport=2222` reports `no`. That is a straightforward counterexample to treating `-C user,host,addr` as universally sufficient.

`Include` does not need to be separately parsed by your program. OpenSSH follows included files, including globs in lexical order, and `Include` may itself occur inside a `Match` block. Let the server's parser do this instead of attempting to reproduce it. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

There is another subtle limit: `-T` prints such things as `AllowUsers` and `DenyUsers`; it does **not** run the complete login-time `allowed_user()` test for you. Your program still has to evaluate those rules—or classify the account as conditional. In the actual authentication path, OpenSSH checks `DenyUsers` before `AllowUsers` and also checks group restrictions. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth.c))

## Configuration on disk is not the running daemon's configuration

This is probably the most important operational limitation.

A separately executed `sshd -T` reads the configuration files as they exist **now**. The resident listener does not continually reread them. OpenSSH's documented and source-level behaviour is to re-exec itself with its saved original argv when it receives `SIGHUP`; that reload is what picks up configuration changes. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

Consequently:

```text
10:00 daemon starts with PubkeyAuthentication yes
10:05 root edits sshd_config to PubkeyAuthentication no
10:06 your program runs sshd -T
```

At 10:06 `sshd -T` says `no`, while the existing listener continues to enforce the previously loaded `yes` until a reload/restart.

There is no supported OpenSSH command that asks the resident listener to dump its loaded `ServerOptions`. Reading `/proc/$pid/cmdline` helps you discover a custom `-f` and command-line `-o` overrides, but it cannot reconstruct the old contents of a file that has changed since startup. Command-line options matter because they override configuration-file values. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

There is an additional failure mode: `-T` incorporates the sanity testing of `-t`. A daemon may still be running with host keys already loaded in memory after corresponding files were removed or changed, while a fresh `-T` can fail its checks. In 10.5p1, `-G -C` is available as an effective-configuration dump without those extra `-t` checks, but that option should only be used after checking that the installed version supports it. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

So I would attach a provenance to every answer:

```text
effective_config_basis = "current files parsed by OpenSSH 10.5p1"
running_daemon_verified = false
```

unless you have actually probed the listener.

## `AuthorizedKeysFile`: don't construct `~/.ssh/authorized_keys`

For OpenSSH 10.5p1, `AuthorizedKeysFile` may contain **multiple whitespace-separated entries**, each entry may contain glob wildcards, `none` disables file lookup, and relative entries are relative to the target user's home directory. The documented default in this version is `.ssh/authorized_keys .ssh/authorized_keys2`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

The permitted tokens for `AuthorizedKeysFile` are:

```text
%%   literal %
%h   target user's home directory
%U   target user's numeric UID
%u   target username
```

`AuthorizedPrincipalsFile` has the same token set. Commands have a much larger token set because their values may depend on the offered credential and connection. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

You should take the template returned by `sshd -T`, resolve the account through the system identity database, substitute these tokens, prefix the home directory when the result is relative, and then perform glob expansion **as the target user**. This mirrors the 10.5p1 authentication source: it expands `%h/%u/%U`, prefixes `pw_dir` for relative paths, temporarily assumes the user's identity, runs `glob()`, and checks every matching file until it finds the offered key. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth.c))

This means a configuration such as:

```text
AuthorizedKeysFile /srv/sshkeys/%u/*.keys .ssh/admin_keys
```

may resolve for `alice` to several files under `/srv/sshkeys/alice/` plus `/home/alice/.ssh/admin_keys`. Reporting only one path is wrong.

`sshd -T` deliberately prints the configuration templates rather than converting `%u`, `%h`, etc. into per-account filenames; the print path dumps the stored `authorized_keys_files` array directly. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/servconf.c))

## `StrictModes` requires more than checking `chmod 600`

When an authorized-keys or authorized-principals file is opened, 10.5p1 first requires it to be a regular file. With `StrictModes yes`, it then calls `safe_path_fd()`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth2-pubkeyfile.c))

For the user file, `safe_path()` requires the owner to be the target user or an accepted system-directory UID, rejects group/other write bits (`022`), resolves the path with `realpath()`, then walks upward through the canonical parent directories. Those directories likewise must have acceptable ownership and must not be group/world writable. It stops at the canonical home directory when that is encountered, otherwise it can continue to `/`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/misc.c))

Several consequences matter for a discovery implementation:

```text
-rw------- alice alice ~/.ssh/authorized_keys
```

is not sufficient if `.ssh` or the relevant parent path is insecure.

Conversely, “Alice's home is writable by someone else, therefore every Alice key source is invalid” is also too broad. An absolute key source under `/etc/ssh/keys/alice`, whose canonical path does not traverse Alice's home, is checked along that other path.

And with `StrictModes no`, ownership/mode safety is skipped, but the file still has to be openable as the target user and must be a regular file. The source opens these files after temporarily switching to the account's credentials. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth2-pubkeyfile.c))

The same user-file mechanism is used for `AuthorizedPrincipalsFile`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth2-pubkeyfile.c))

Do not apply those exact rules to `AuthorizedKeysCommand`. Its executable has separate requirements: the command must use an absolute executable path, be owned by root, and not be writable by group or others. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

## Dynamic key commands are fundamentally not enumerable

`AuthorizedKeysCommand` is a **program**, not another filename. It runs only for valid users, normally after the file sources fail to authorize the offered key. Its output is parsed as `authorized_keys` data. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

The critical discovery problem is that its arguments may include:

```text
%f   offered key/certificate fingerprint
%k   offered key/certificate itself
%t   key/certificate type
%C   connection endpoints
%D   routing domain
%h %U %u
```

and the principals command has even more certificate-specific substitutions. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

Therefore, “run `AuthorizedKeysCommand` once and enumerate all of its keys” is not generally meaningful. A perfectly valid command can be:

```text
lookup-key --user=%u --fingerprint=%f --source=%C
```

and answer differently for every offered key, client address, database state, or time.

It may also have external side effects. For discovery, report it as a dynamic source:

```text
type: authorized_keys_command
command: ...
run_as: ...
enumerable: false
```

Do not execute it merely to populate the UI. Execute it only as part of an explicit test involving a real candidate credential.

A counterexample is a host with `AuthorizedKeysFile none` and an `AuthorizedKeysCommand` backed by LDAP. Scanning every filesystem key file yields “no keys”; actual key login succeeds.

## Certificates require two distinct CA models

There are two ways an OpenSSH user certificate may become trusted, and they should not be collapsed.

A `cert-authority` entry may live directly in an `AuthorizedKeysFile`—or in `AuthorizedKeysCommand` output. On such a line the `principals=` authorized-keys option may constrain which certificate principals are valid. `AuthorizedPrincipalsFile` is **not** consulted for this type of CA. The `sshd(8)` authorized-keys format explicitly supports `cert-authority` and `principals=`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

Separately, `TrustedUserCAKeys` names a system CA-key file. A certificate signed by one of those CAs may authenticate a user when the certificate has an acceptable principal. If neither `AuthorizedPrincipalsFile` nor `AuthorizedPrincipalsCommand` is configured, the target username itself must appear in the certificate principals. If either is configured, a certificate principal must match that source. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

`AuthorizedPrincipalsFile` may itself use `%h/%u/%U/%%` and wildcards; 10.5p1 actually performs `glob()` on the expanded path as the user. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

So a useful source report might look conceptually like:

```text
alice
  direct key files:
    /srv/keys/alice/a.keys
    /home/alice/.ssh/authorized_keys

  dynamic key source:
    /usr/local/libexec/ssh-key-lookup ...     [not enumerable]

  certificate source:
    trusted CA file: /etc/ssh/user_ca_keys
    principal files: /etc/ssh/principals/alice
    principal command: none
```

An account with no ordinary key lines can therefore still be fully usable through certificates.

The source ordering in 10.5p1 is also illuminating: it checks configured authorized-key files, then `TrustedUserCAKeys` certificate authorization, then `AuthorizedKeysCommand`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth2-pubkey.c))

## Public-key enabled does not mean login allowed

`PubkeyAuthentication yes` only enables that authentication method; it is not an account verdict. Its upstream default is `yes` in 10.5p1. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

`AuthenticationMethods` is an easy-to-miss second gate. `any` permits a single enabled method. A setting such as:

```text
AuthenticationMethods publickey,password
```

means a public key can be accepted but does **not** complete login by itself. `publickey,publickey` requires two different public keys. If none of the allowed method sequences begins with or contains publickey in an applicable position, having `PubkeyAuthentication yes` does not make public-key login useful. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

I would therefore expose two flags such as:

```text
public_key_method_usable
public_key_alone_sufficient
```

rather than one Boolean.

Also look at `RefuseConnection`; in 10.5p1 it can unconditionally terminate a matching connection. `RevokedKeys`, algorithm restrictions, minimum RSA size, FIDO verification requirements, certificate validity, and per-key `from=` or `expiry-time=` conditions can make individual credentials fail even though the account-level configuration looks permissive. An unreadable `RevokedKeys` file is especially significant: the man page says that it disables public-key authentication for all users. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

## Root is special

Do not interpret `PermitRootLogin prohibit-password` as “root cannot use SSH.” In 10.5p1 it explicitly permits public-key authentication while disabling password and keyboard-interactive authentication. The source's `auth_root_allowed()` allows `publickey` in this mode. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

The statuses are approximately:

| `PermitRootLogin` | Public-key result |
|---|---|
| `yes` | ordinary rules |
| `prohibit-password` | public key may authenticate |
| `forced-commands-only` | conditional: only a key/certificate producing a forced command |
| `no` | root denied |

For `forced-commands-only`, you cannot classify root as generally key-login-capable merely because an authorized-keys file exists; the actual matching credential must carry the necessary restriction. The 10.5p1 source checks the effective authentication options for a forced command. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth.c))

## `AllowUsers`, `DenyUsers`, and identity enumeration

`AllowUsers` can contain `USER@HOST` forms and CIDR address restrictions; `DenyUsers` takes precedence. The actual account check also applies `AllowGroups` and `DenyGroups`, so a reliable implementation should not omit those just because the UI requirement mentions only users. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

This also explains why a bare “alice: yes” result is misleading: Alice might be allowed from `192.0.2.0/24` and denied from everywhere else.

Account discovery itself has a separate problem. Use NSS (`getpwnam`, `getpwent`, or `getent passwd`), not just `/etc/passwd`; OpenSSH itself uses the system account lookup functions. But **NSS enumeration is not guaranteed to list every resolvable account**. For example, SSSD explicitly supports operation with enumeration disabled; its documentation notes that `getent passwd` may display no domain users while named lookups such as `getent passwd alice` remain the appropriate test. ([SSSD](https://sssd.io/troubleshooting/basics.html?utm_source=chatgpt.com))

Thus on a host with `passwd: files sss`, the honest result may be:

```text
local accounts enumerated: yes
all possible directory accounts enumerated: unknown
```

A UI claiming “these are all SSH accounts” from `getent passwd` alone is not reliable across enterprise Linux systems.

## Shells and “logged in” are different from authentication

OpenSSH 10.5p1's pre-auth account check rejects a non-chrooted user if its configured shell does not exist, is not a regular file, or has no execute bit. An empty shell becomes `/bin/sh`. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth.c))

It does **not** ask whether the executable is semantically a “no login” program. Therefore an executable `/usr/sbin/nologin` passes this particular pre-auth check. Authentication can succeed, after which `nologin` terminates an attempted shell or command. OpenSSH's documented login processing invokes the user's configured shell after successful authentication. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

So report something like:

```text
key_authentication: potentially_allowed
interactive_session: shell_declares_nologin
```

rather than declaring the account incapable of key authentication.

`/etc/shells` is not part of the core check above. PAM can impose additional shell policy, e.g. through an appropriate PAM module.

There is also `/etc/nologin`: OpenSSH's documented post-auth login process checks it and quits for non-root users if present. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.8))

With `ChrootDirectory`, even the pre-auth shell check differs: the core code skips the host-side shell existence check when chrooting because the execution environment is different. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth.c))

## PAM prevents a complete static answer

`UsePAM yes` is particularly important. OpenSSH 10.5p1 documents that PAM **account and session processing applies to all authentication types**, including public-key authentication. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

The source calls `pam_acct_mgmt()` and regards ordinary PAM account failures as denial. PAM modules may consult account expiry, time of day, host or source address, SSSD/LDAP policy, local files, network services, or arbitrary site-specific code. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth-pam.c))

Consequently:

```text
PubkeyAuthentication yes
valid authorized key
```

still does not imply successful login if:

```text
UsePAM yes
```

and the PAM account stack rejects the user.

Another interesting source detail: the OpenSSH-native “locked account” check is performed when `UsePAM` is off; with PAM enabled the result can instead depend on the PAM account policy. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth.c))

PAM session modules are also invoked. In 10.5p1, failure of `pam_open_session()` causes OpenSSH to restrict the session rather than being reducible to the same simple pre-auth Boolean. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth-pam.c))

Therefore `UsePAM yes` should normally lower a static result from “yes” to something like **“configuration permits; PAM account policy not evaluated”**. Parsing `/etc/pam.d/sshd` does not fix this generally because PAM modules are executable code.

## The smallest defensible command set

If the panel already has privileged command execution on the machine, this is about as small as I would make the external-command portion:

1. Identify the server that actually owns the SSH connection/listener, rather than assuming that an installed `/usr/sbin/sshd` is relevant:

   ```bash
   ss -H -ltnp
   ```

   Then inspect the relevant PID's `/proc/$pid/exe` and NUL-separated `/proc/$pid/cmdline`. Also inspect the ancestor chain of the panel's current SSH session, because inetd/systemd/socket-activated configurations may not have `sshd` itself owning the listening socket. Capture the implementation/version from that executable, e.g. the version option supported by that implementation.

2. Enumerate the identity database as far as the system permits:

   ```bash
   getent passwd
   ```

   Use named `getent passwd "$candidate"`/`getpwnam()` lookups for users discovered elsewhere. Treat enumeration as incomplete when an NSS directory backend can resolve non-enumerated users.

3. For every OpenSSH candidate account and every connection context you intend to answer for, invoke the **same implementation/binary** and replay its relevant `-f` and `-o` configuration arguments:

   ```bash
   /proc/$pid/exe -T \
     -f /the/actual/config \
     ...original -o overrides... \
     -C "user=$u,host=$h,addr=$a,laddr=$la,lport=$lp,rdomain=$rd"
   ```

   If this panel's current connection is the scope, `$SSH_CONNECTION` conveniently provides client IP/port and server IP/port. The hostname component still needs to be treated according to `UseDNS`/OpenSSH hostname resolution semantics.

4. Everything after that should preferably be program logic/syscalls, not more shell parsing: expand `%h/%u/%U/%%`, glob as the target user, `open`/`fstat`/`realpath` the files, reproduce the StrictModes path walk, evaluate `PermitRootLogin`, `AllowUsers`/`DenyUsers` and group rules, shell state, `AuthenticationMethods`, and attach `unknown/conditional` for PAM or commands. Do **not** execute dynamic key/principal commands merely to discover their contents.

That is not an exact query of the resident daemon. No inspection-only command sequence can provide that guarantee when the running process may have old configuration in memory or its policy delegates to arbitrary PAM/key-command code.

## How to report partial answers

I would make uncertainty first-class rather than squeezing the result into yes/no. A per-account result could carry:

| Field | Example |
|---|---|
| `scope` | `addr=203.0.113.8,laddr=10.0.0.4,lport=22` |
| `server` | `OpenSSH_10.5p1`, PID 123 |
| `config_basis` | `current_on_disk`, not runtime snapshot |
| `account_resolution` | resolved / enumeration incomplete |
| `pubkey_method` | enabled / disabled |
| `auth_completion` | key alone / key + password / conditional |
| `account_policy` | allowed / denied / conditional |
| `key_files` | expanded paths plus secure/readable/absent state |
| `key_command` | none / dynamic |
| `trusted_ca` | path and readability |
| `principal_source` | username / file / dynamic command |
| `shell` | usable / nologin-like / missing / unknown-in-chroot |
| `pam` | off / on, account result unknown |
| `runtime_confidence` | static-effective / actually probed |

A useful top-level status vocabulary is **`denied`**, **`possible`**, **`conditional`**, and **`unknown`**. Reserve an unqualified **`verified`** for an actual successful authentication to the running listener using the stated credential/context.

In particular, never turn “no valid file sources found” into “no public-key login” when an `AuthorizedKeysCommand` or trusted CA remains. Never turn `PubkeyAuthentication yes` into “can log in” when PAM, account restrictions, `AuthenticationMethods`, root policy, or StrictModes are unresolved.

## Other SSH servers

Presence of the `sshd` executable does not establish that OpenSSH is serving the connection. An especially simple counterexample is a machine with OpenSSH installed but **Dropbear** listening on port 22.

As a concrete versioned example, **Dropbear 2026.94** has different discovery semantics. Its `-D authorized_keys_dir` option changes the directory containing `authorized_keys`; the default is `~/.ssh`. Its manual requires the authorized-keys file and containing directory to be writable only by the user, `-w` forbids root login, and `-t` requires both public-key and password authentication. It also supports inetd-style `-i` operation. ([GitHub](https://raw.githubusercontent.com/mkj/dropbear/DROPBEAR_2026.94/manpages/dropbear.8))

There is no basis for applying OpenSSH's `AuthorizedKeysFile`, `Match`, `Include`, `sshd -T`, `TrustedUserCAKeys`, etc. to such a process. The correct architecture is a **server adapter**:

```text
OpenSSH -> OpenSSH introspector
Dropbear -> Dropbear argv/build semantics
unknown server -> unsupported/unknown, not ~/.ssh/authorized_keys guessed
```

If no SSH server is accepting connections, configuration files and binaries merely describe a hypothetical server. “`sshd -T` says pubkeyauthentication yes” on a host with no listener does not mean any account can presently sign in.

For socket/inetd activation, “no `sshd` listener PID” does not by itself mean no SSH service either; inspect the socket owner/supervisor and the program it launches. Dropbear explicitly supports this mode. ([GitHub](https://raw.githubusercontent.com/mkj/dropbear/DROPBEAR_2026.94/manpages/dropbear.8))

## Reproducible tests for the important runtime failures

The running-vs-disk distinction is easy to demonstrate in a disposable VM. Create a test account and key, start a second OpenSSH daemon on `127.0.0.1:22222` with a private config containing:

```text
Port 22222
ListenAddress 127.0.0.1
HostKey /tmp/ssh-test/hostkey
PidFile /tmp/ssh-test/pid
UsePAM no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
```

Verify the generated test key logs in. Then edit only the file to `PubkeyAuthentication no` without signalling the process:

```bash
/usr/sbin/sshd -T -f /tmp/ssh-test/sshd_config \
  -C user=sshdisc,host=127.0.0.1,addr=127.0.0.1,laddr=127.0.0.1,lport=22222 \
  | grep '^pubkeyauthentication'
```

It reports `no`, while another connection using the existing daemon still succeeds. Send the listener `SIGHUP`; subsequent connections fail. That experiment follows the documented/source re-exec-on-SIGHUP behaviour. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd.c))

To demonstrate that `-T` does not validate per-user StrictModes eligibility, return the test configuration to `PubkeyAuthentication yes`, verify login, then:

```bash
chmod 0666 /home/sshdisc/.ssh/authorized_keys
```

`sshd -T` will still report the same `AuthorizedKeysFile` and `StrictModes yes`, but actual key authentication is rejected. Restore mode `0600` and it succeeds again. This corresponds directly to `auth_openfile()` calling `safe_path_fd()` only while processing the offered key, not while dumping configuration. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth2-pubkeyfile.c))

For PAM, on a disposable PAM-equipped host create a separate test PAM service whose account stack uses `pam_deny.so`, then run the isolated daemon with:

```text
UsePAM yes
PAMServiceName sshd-discovery-deny
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
```

The same authorized key is discoverable and `sshd -T` reports public-key authentication enabled, but login is rejected when `pam_acct_mgmt()` runs. This directly demonstrates why `-T` cannot turn PAM into an account-level Boolean. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/auth-pam.c))

A dynamic-command counterexample is similarly simple: set `AuthorizedKeysFile none` and install a root-owned `AuthorizedKeysCommand` that emits the test public key only when its `%f` fingerprint argument matches. A filesystem scanner reports no authorized key; a real connection succeeds. The command-token semantics and authentication order are exactly what make the static conclusion incomplete. ([GitHub](https://raw.githubusercontent.com/openssh/openssh-portable/V_10_5_P1/sshd_config.5))

## Recommendation for the panel

The most robust design is to treat OpenSSH as the parser of its own configuration, not reimplement `sshd_config`. Identify the real server first; for OpenSSH invoke that server version's effective-config mode for a concrete connection context; then separately reproduce the small amount of per-account runtime policy that `-T` does not execute—NSS identity, allow/deny policy, path/token expansion, file accessibility/StrictModes, root policy and shell state.

Keep dynamic programs, PAM, incomplete NSS enumeration, and running-vs-disk divergence visible as uncertainty. If an exact answer is required for a particular credential, the final authority is a controlled authentication attempt against the **actual listener**, from the relevant source address. Even that proves only that particular key/certificate, account, source, and point in time; it does not enumerate every possible authorized source.
