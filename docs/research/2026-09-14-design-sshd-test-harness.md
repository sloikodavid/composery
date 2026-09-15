# Design SSHD Test Harness

Source: https://chatgpt.com/share/6aa87166-d994-83eb-9d35-34014ec7376f

---

**User**

Context: A web control panel edits OpenSSH authorized_keys files on customer Linux machines and claims to support every native option. To keep that claim true as OpenSSH changes, the team wants automated checks that show how real sshd builds treat each entry form.

Question: How should a small, maintainable test harness verify authorized_keys parsing and option behavior against real sshd builds?

Cover: which sshd builds to test (versions and distribution packages) and how to run them reproducibly; how to assert authentication success or failure, and session behavior for each option family (forced commands, forwarding, pty, environment, source address, expiry time, certificate authorities and principals, security-key requirements); how to generate keys and certificates for fixtures; how to structure a corpus so that one fixture answers one question; how long a run takes and what it costs in CI; how to detect a semantic change when a new OpenSSH release appears; and which behaviors cannot be tested automatically.

Evidence rules: Base the design on documented sshd and ssh flags at exact versions. Describe experiments that show each assertion is observable. Compare at least two harness designs and state the tradeoffs. Keep the design as small as the goal allows, and say what a smaller design would miss.

---

**ChatGPT**

I’ll anchor the harness in upstream OpenSSH documentation plus a small distro matrix, then map each option family to an observable client/server experiment. I’ll also separate “must run on real sshd” checks from cases where full automation is inherently limited.

---

**ChatGPT**

A useful boundary has already emerged: OpenSSH 10.3 changed `principals=""` semantics so an empty certificate-principal list no longer behaves like a wildcard, and 10.5 fixed `restrict` so it also constrains tunnel forwarding. Those are exactly the kinds of release-to-release semantic deltas the harness should surface.

---

**ChatGPT**

The smallest design that genuinely supports “every native `authorized_keys` option” is a **black-box compatibility matrix around real `sshd` processes**, not a parser reimplementation. Feed each daemon one deliberately tiny `authorized_keys` file, connect with a controlled OpenSSH client, and assert externally visible authentication/session behavior. Treat daemon logs as diagnostics, not as the oracle.

As of September 2026, I would make **OpenSSH 10.5p1 the reference documentation version** and keep explicit boundary builds where semantics changed. OpenSSH 10.3 changed the meaning of an empty `principals=""` restriction, and 10.5 fixed `restrict` so it applies to tunnel forwarding. Those two fixtures make particularly good permanent canaries for proving the harness really notices semantic change. ([OpenSSH](https://www.openssh.com/releasenotes.html))

## 1. The build matrix

Use two dimensions: exact upstream releases for semantic boundaries, and real distribution packages for backports.

| Lane | Builds I would keep | Why |
|---|---|---|
| Upstream | `V_10_2_P1`, `V_10_3_P1`, `V_10_4_P1`, `V_10_5_P1` | Small consecutive window containing two known `authorized_keys` semantic changes |
| Ubuntu LTS | 24.04 `1:9.6p1-3ubuntu13.19`; 26.04 `1:10.2p1-2ubuntu3.5` on amd64 | Represents a long-lived older fleet and current LTS packaging ([Ubuntu Packages](https://packages.ubuntu.com/noble/openssh-server)) |
| Debian stable | Debian 13 `1:10.0p1-7+deb13u4` | Another materially different downstream patch set ([Debian Packages](https://packages.debian.org/trixie/amd64/net/openssh-server)) |
| RHEL-family | CentOS Stream 10/RHEL10-compatible `9.9p1-29.el10` | Important because downstream has backported forwarding/tunnelling fixes without changing the upstream `9.9p1` version string ([Rpmfind](https://rpmfind.net/linux/RPM/centos-stream/10/baseos/x86_64/openssh-server-9.9p1-29.el10.x86_64.html)) |

That is eight core images. Add Alpine or another distribution only if it is actually in the supported customer fleet. Testing five distributions “just in case” adds maintenance without improving the contractual claim much.

The RHEL-family example is why testing only upstream releases is insufficient: its 9.9p1 package received 2026 fixes for incorrect forwarding/tunnelling option handling. The apparent upstream version does not tell you its semantics. ([Rpmfind](https://rpmfind.net/linux/RPM/centos-stream/10/baseos/x86_64/openssh-server-9.9p1-29.el10.x86_64.html))

For upstream builds, compile once from the exact release tarball/tag, verify the published checksum/signature, and push the resulting OCI image under an immutable digest. For distro builds, install the exact package NEVRA/version once and freeze that image by digest. At the beginning of every job, record and verify `sshd -V`; the 10.5p1 `sshd(8)` explicitly documents `-V` as “display the version number and exit.” ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8))

Do **not** `apt upgrade` or equivalent on every test invocation. Image refresh should be a deliberate event that creates a new result baseline.

## 2. Harness shape

Run a fixed OpenSSH 10.5p1 “driver” container against each server image. A fixed client is preferable because the thing being compared is server-side `authorized_keys` semantics; changing client and server simultaneously makes a difference harder to attribute.

The client should start with something equivalent to:

```sh
ssh -F none \
  -o BatchMode=yes \
  -o PasswordAuthentication=no \
  -o KbdInteractiveAuthentication=no \
  -o PreferredAuthentications=publickey \
  -o IdentitiesOnly=yes \
  -i "$IDENTITY" \
  -p "$PORT" \
  test@"$SERVER" ...
```

In 10.5p1, `ssh -F none` explicitly means no configuration files are read, so host CI configuration cannot leak into the experiment. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh.1)) `BatchMode=yes` removes interactive questions. Give the driver a generated `known_hosts` file rather than disabling host verification.

Run each `sshd` as PID 1/foreground with `-D -e -f <case-config>`, under a rootful container so it can change to an ordinary unprivileged test account. Keep that account's home, `.ssh`, and `authorized_keys` ownership/modes realistic rather than defeating `StrictModes`.

The server baseline should disable unrelated authentication methods and PAM, enable public-key authentication, and otherwise leave the feature under test enabled administratively. A fixture may alter exactly one prerequisite such as `PermitUserEnvironment yes`, `X11Forwarding yes`, or `PermitTunnel yes`.

At 10.5p1, the documented file grammar is one key per line with optional comma-separated options before the key type; option keywords are case-insensitive, and spaces in option values require quoting. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) This gives you the parser-level corpus in addition to behavioral tests.

## 3. Make every assertion observable

An “authentication succeeded” assertion should mean **a fresh SSH connection authenticated and a deterministic remote probe executed**. Do not infer success merely because the client did not print an error.

For a positive case, have `/usr/local/libexec/ak-probe` emit something like:

```text
nonce=8b21...
tty=0
env=
original_command=...
display=
agent_socket=
```

and require the expected nonce plus exit status zero.

For a negative authentication case, require `ssh` exit status 255. Before running corpus cases against an image, run one baseline `plain-key` self-test so a broken daemon is not misclassified as “correctly rejected.” Keep `DEBUG3` server logs as failure artifacts, but do not assert exact log text because that is substantially less stable than protocol behavior.

The main experiments should be:

| Family | Actual experiment | Observable assertion |
|---|---|---|
| Plain/parser | Connect using the exact candidate line | Valid baseline executes nonce; malformed/unknown-option line cannot authenticate |
| `command=` | Client requests `echo REQUESTED`; authorized line forces `ak-probe forced` | Probe runs instead of requested command and reports `SSH_ORIGINAL_COMMAND=echo REQUESTED`. `sshd(8)` documents both behaviors. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) |
| `no-pty`, `pty` | Connect with `ssh -tt` and probe `[ -t 0 ]` | `no-pty` gives no tty; `restrict,pty` gives a tty. `-t`/`-tt` explicitly force allocation requests. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh.1)) |
| `environment=` | Line supplies `environment="AK_CASE=abc"` | With `PermitUserEnvironment yes`, probe sees `abc`; with it disabled, authentication still succeeds but variable is absent. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) |
| `from=` | Give driver a fixed bridge/netns IP | Matching exact IP/CIDR succeeds, nonmatching address cannot authenticate. Core tests should use IP/CIDR rather than external DNS. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) |
| `expiry-time=` | Generate one line far in the future and one far in the past, always UTC `Z` | Future line authenticates; expired line does not. Avoid an “expires this second” race. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) |
| `permitopen`, `no-port-forwarding`, `port-forwarding` | Start server-side nonce TCP service; request `ssh -N -L ...`; then connect through the local listener | Allowed case returns nonce end-to-end; denied case cannot pass bytes |
| `permitlisten` | Start client-side nonce service and request `ssh -N -R ...` | Server can connect to permitted remote listener and receive nonce; prohibited listen address/port is rejected |
| Agent forwarding | Start a disposable `ssh-agent`, add one generated key, connect with `-A` | Allowed case has usable `SSH_AUTH_SOCK` and `ssh-add -L`; `no-agent-forwarding`/`restrict` does not |
| X11 forwarding | Supply a controlled fake DISPLAY/xauth setup and request `-X` | Allowed policy creates remote `DISPLAY`; `no-X11-forwarding`/`restrict` does not. This tests policy, not a real desktop |
| `user-rc` / `no-user-rc` | `.ssh/rc` writes a nonce marker | Marker exists only where rc execution is permitted |
| `tunnel=` / `restrict` | Privileged lane with `/dev/net/tun`; request `ssh -w` | TUN creation/data path succeeds or is denied as expected. This is the canary that distinguishes the pre-10.5 `restrict` bug from 10.5. ([OpenSSH](https://www.openssh.com/releasenotes.html)) |
| `cert-authority` | Put CA public key in authorized_keys and authenticate with a CA-signed user certificate | Correctly signed certificate authenticates; certificate signed by another CA does not |
| `principals=` | CA line names `principals="ops"`; make matching and nonmatching certs | Matching principal succeeds; mismatch fails. The option is documented as requiring one of the named principals. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) |
| SK `no-touch-required` | Use OpenSSH's software SK provider with a signature lacking user-presence | Default server policy rejects it; line with `no-touch-required` accepts it |
| SK `verify-required` | Produce signatures with and without the user-verification flag | Only verified signature succeeds when `verify-required` is present. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8)) |

For forwarding, **actually send traffic through the channel**. `ExitOnForwardFailure=yes` alone is insufficient for local forwarding: the 10.5p1 client documentation says it covers failure to set up requested forwarding but not failure of a later connection to the ultimate forwarding destination. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh_config.5)) That distinction is easy for an apparently sensible test to miss.

Likewise, test `localhost` and an explicit `127.0.0.1` separately where `permitlisten` matters; current documentation gives them distinct semantics. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8))

The current 10.5p1 option inventory that the corpus should account for includes the positive and negative forwarding/PTY/X11/user-rc forms, `cert-authority`, `command`, `environment`, `expiry-time`, `from`, `permitlisten`, `permitopen`, `principals`, `restrict`, `tunnel`, `no-touch-required`, and `verify-required`. Extract the inventory from the exact tagged `sshd.8`, rather than hard-coding the belief that this list is forever complete. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/sshd.8))

## 4. Keys and certificates should be generated, not checked in

Use ephemeral fixtures so the repository contains no private key material:

```sh
ssh-keygen -q -t ed25519 -N '' -f user
ssh-keygen -q -t ed25519 -N '' -f wrong_user
ssh-keygen -q -t ed25519 -N '' -f ca
ssh-keygen -q -t ed25519 -N '' -f wrong_ca

# User certificate with one principal and a comfortably wide validity period.
ssh-keygen -q -s ca -I case-principal \
  -n ops -V -5m:+1h user.pub

# Different CA for the negative fixture.
ssh-keygen -q -s wrong_ca -I case-wrong-ca \
  -n ops -V -5m:+1h wrong_user.pub
```

The exact 10.5p1 `ssh-keygen(1)` syntax documents `-s` for signing, `-I` for certificate identity, `-n` for principals and `-V` for the validity interval. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh-keygen.1)) The client can explicitly pair `-i user` with `CertificateFile=user-cert.pub`; the 10.5p1 client documentation describes that separation. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh_config.5))

For the 10.2→10.3 canary, create a certificate with an empty principals section and use an authorized line containing `cert-authority,principals=""`. The expected observation is version-specific: the old behavior treated the empty list as matching any principal; 10.3 deliberately stopped doing so. ([OpenSSH](https://www.openssh.com/releasenotes.html))

For security-key cases, do not require USB hardware in ordinary CI. Build the `sk-dummy` provider shipped with the OpenSSH regression tree and use the 10.5p1 driver:

```sh
ssh-keygen -q -t ed25519-sk \
  -w "$SK_DUMMY" \
  -O no-touch-required \
  -N '' -f sk_no_touch

ssh-keygen -q -t ed25519-sk \
  -w "$SK_DUMMY" \
  -O verify-required \
  -N '' -f sk_verified
```

Current `ssh-keygen(1)` documents the FIDO provider selection and the `no-touch-required` / `verify-required` key properties. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/ssh-keygen.1)) This exercises whether `sshd` enforces the signature flags; it does **not** prove a physical authenticator actually required a finger, PIN, or biometric.

## 5. Corpus structure

Do not make one monster authorized_keys entry that combines eight options. A failure then tells you almost nothing.

A fixture should answer exactly one question:

```yaml
id: pty.no-pty
question: "Does no-pty suppress a forced PTY request?"

authorized_key: 'no-pty ${USER_PUB}'

server: {}

client:
  args: ["-tt"]
  command: "/usr/local/libexec/ak-probe tty"

expect:
  auth: success
  tty: false
```

Another:

```yaml
id: forwarding.permitopen-deny
question: "Does permitopen reject a destination not listed?"

authorized_key: 'permitopen="127.0.0.1:9001" ${USER_PUB}'

services:
  server_echo: "127.0.0.1:9002"

client:
  local_forward: "127.0.0.1:${LOCAL}:127.0.0.1:9002"

expect:
  auth: success
  forwarded_nonce: false
```

A practical tree is:

```text
fixtures/
  parse/
  command/
  pty/
  environment/
  source/
  expiry/
  forwarding/
  agent/
  x11/
  user-rc/
  tunnel/
  certificates/
  security-key/

goldens/
  upstream-10.2p1.json
  upstream-10.3p1.json
  upstream-10.4p1.json
  upstream-10.5p1.json
  ubuntu-24.04-9.6p1-3ubuntu13.19.json
  ...
```

Each fixture gets one authorized-key line and one semantic proposition. Shared echo servers, keys, CA material, users and the probe binary are infrastructure, not part of the proposition.

For undocumented edge cases such as duplicate singleton options or strange quoting combinations, label the fixture `compatibility-observation`, not `documented-contract`. You still want to know when real OpenSSH changes, but the product should not promise that an undocumented quirk is guaranteed forever.

## 6. Detecting a new semantic change

When a new OpenSSH release appears, do not start by updating expected results.

First, build the new tag into a new immutable image. Then extract the set of option names from that tag's `AUTHORIZED_KEYS FILE FORMAT` section and compare it with the fixture manifest. A documented option with no fixture is a hard CI failure: **“new native option lacks coverage.”**

Next, run the complete existing corpus and produce a normalized observation record such as:

```json
{
  "fixture": "cert.empty-principals",
  "build": "OpenSSH_10.6p1",
  "auth": "denied",
  "exit": 255,
  "tty": null,
  "forwarding": null
}
```

Compare that vector with the preceding upstream release. Any difference is a review event, not an automatic failure-to-bless. Read the new version's tagged `sshd(8)`, `ssh(1)`, `ssh_config(5)`, `ssh-keygen(1)` and release notes, then either classify it as an intended semantic change and add the new golden, or file it as a regression.

The permanent 10.2/10.3 empty-principals and 10.4/10.5 `restrict`+tunnel fixtures are especially valuable because they prove that this mechanism would actually have caught two real changes. ([OpenSSH](https://www.openssh.com/releasenotes.html))

For distro images, compare by **package revision**, not merely `OpenSSH_9.9p1`; the CentOS/RHEL example shows why. ([Rpmfind](https://rpmfind.net/linux/RPM/centos-stream/10/baseos/x86_64/openssh-server-9.9p1-29.el10.x86_64.html))

## 7. Two reasonable harness designs

| Design | Strengths | Weaknesses | Recommendation |
|---|---|---|---|
| **OCI black-box matrix**: actual distro/upstream `sshd`, fixed client, real TCP connections | Small; observable; package backports included; easy to parallelize; close to what customers exercise | Does not reproduce systemd/PAM/SELinux/customer DNS; TUN needs privileged lane | **Use this as the main harness** |
| **Full VM per distro**: boot a real OS image and its service manager | Tests PAM, SELinux, distro crypto policy, systemd service files and real host networking too | Much slower; image lifecycle/security maintenance; harder static addressing; much more CI cost; most of this is outside `authorized_keys` semantics | Use only if your support claim includes whole-host integration |
| **OpenSSH upstream regress suite** | Very fast for upstream source changes; already contains infrastructure such as the dummy SK provider | Primarily tests OpenSSH itself rather than your emitted authorized_keys lines; doesn't represent downstream packages/backports | Borrow components from it; don't make it the product compatibility oracle |

The OpenSSH portable tree itself supports a source/regression-test workflow, so a source-only harness is attractive technically. But it does not answer the question “does the exact Ubuntu/RHEL package my customers run interpret the line my control panel emitted this way?” The black-box container design does.

## 8. Runtime and CI cost

With roughly 40–60 single-purpose fixtures, there is no reason for this to be a large test system. SSH handshakes and local nonce transfers are cheap; image startup/pulling is likely to dominate.

With prebuilt images, I would budget roughly **1–2 minutes per image warm, up to ~3 minutes cold**, so an eight-way parallel matrix normally has a **2–4 minute wall time** and about **16–24 Linux runner-minutes**. That is an engineering budget, not a benchmark; measure it once in your CI and enforce an upper bound.

GitHub currently prices its baseline 2-core x64 Linux runner at **$0.006/minute**, so 16–24 billable minutes above included quota is approximately **$0.10–$0.14 per full matrix run**. ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) The privileged TUN job may add another minute or two.

Do not recompile eight versions on every pull request. Build a new source/package image only when a version changes. Normal PR CI pulls immutable images and runs tests.

A sensible cadence is: current upstream + two primary fleet distros on every PR; the full eight-image matrix on merges/nightly; and the full matrix automatically whenever a server-image digest changes.

## 9. What the harness cannot honestly prove

Most `authorized_keys` semantics are fully machine-observable. The irreducible limitations are physical/security-environment properties.

Actual FIDO **human presence and human verification** cannot be established by a software dummy provider: CI can prove that `sshd` accepts/rejects the UP/UV flags correctly, but not that a particular YubiKey really required touch, PIN, fingerprint, or user intent. Similarly, the X11 test can prove forwarding policy and `DISPLAY` setup, but not that an arbitrary customer's desktop X server behaves securely. `from=` can be tested exactly with controlled IPs/CIDRs and controlled DNS, but not against every customer's broken split-DNS/rDNS environment. Tunnel behavior is automatable only on runners that expose TUN and the needed capabilities. PAM, SELinux, FIPS/crypto-policy interactions, systemd sandboxing, NFS home permissions, LDAP accounts, and similar host integration are deliberately outside the small container harness; use a VM/integration lane if those are part of the product claim.

Do not test exact expiry boundaries at wall-clock zero; clock scheduling makes that intrinsically flaky. Test comfortably past and future times instead.

## Bottom line

I would keep the core at **one small driver, eight pinned real `sshd` images, roughly fifty single-question fixtures, and externally observable assertions**. Extract the documented option inventory from each new tagged `sshd.8`, and refuse to call a new release supported until every new keyword has an experiment and every changed observation has been reviewed.

The tempting smaller design—one current upstream `sshd`, parser-only tests, and checking SSH exit codes—would miss all three of the important classes here: downstream backports, session-level restrictions that authenticate successfully but alter capabilities, and version transitions such as `principals=""` and `restrict`+tunnel. That is too small to substantiate the “every native option” claim.
