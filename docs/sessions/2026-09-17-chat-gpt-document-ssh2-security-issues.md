# Document ssh2 security issues

Source: https://chatgpt.com/share/6aab2fb0-6498-83eb-89c3-9fcc1d0bd04d

---

## Turn 1: User

_2026-09-17T00:04:10.002Z_

As of September 2026, for the `ssh2` Node.js library (mscdex), document from its repository, issues and changelog: how host key verification must be done correctly and common ways it is done wrongly; which key types and algorithms are supported and which are deprecated; known issues with connection timeouts, keepalives and hung connections; behaviour when a server closes a channel mid-command; handling of large command output; and any security advisories. Report what production users do to work around the library's sharp edges.

---

## Turn 2: ChatGPT

_2026-09-17T00:04:09.882Z_

I’ll synthesize the repository documentation, changelog, issue history, and security/advisory records, then separate “documented behavior” from production workarounds reported by users. I’ll pay particular attention to version/date context so advice that applied to older `ssh2` releases isn’t presented as current.

---

## Turn 3: ChatGPT

_2026-09-17T00:04:22.421Z_

One important distinction is already clear: `ssh2` does **not** verify the server identity unless you provide `hostVerifier`; the documented default is auto-accept. Also, `hostVerifier` can be invoked again on rekey, so a verifier that assumes it runs only once is subtly wrong.

---

## Turn 4: ChatGPT

_2026-09-17T00:06:54.863Z_

The timeout/hang reports are not one bug class. The recurring pattern is that `readyTimeout` only bounds the SSH handshake; keepalives are off by default; and some higher-level operations can remain pending after transport loss. In April 2026, issue #1490 reproduced `sftp.readdir()` never calling its callback after the server disappears, and it remains open.

---

## Turn 5: ChatGPT

_2026-09-17T00:07:34.306Z_

As of **17 September 2026**, the latest published npm release of `mscdex/ssh2` is **1.17.0**. The repository’s `master` has moved beyond the published package—for example, `master` now documents Node 16+ whereas the npm 1.17.0 page still documents Node 10.16+—and the project does not maintain conventional GitHub release notes; the v1 rewrite/status issue, commit history, README, issues and PRs effectively serve as the changelog. ([npm](https://www.npmjs.com/package/ssh2?utm_source=chatgpt.com))

## 1. Host-key verification: the easy place to make `ssh2` insecure

The most consequential default is that **`ssh2` accepts any server host key unless you configure `hostVerifier`**. Authentication with a private key does *not* authenticate the server to the client; without `hostVerifier`, a MITM server can present its own host key and the library will accept it. `hostVerifier` receives either the raw SSH public-key blob as a `Buffer`, or—if `hostHash` is configured—a **hexadecimal** digest. ([GitHub](https://github.com/mscdex/ssh2?utm_source=chatgpt.com))

Since the v1 rewrite, the verifier is deliberately invoked on **every SSH handshake, including rekeys**, because a server can offer a different host key during a later rekey. A verifier that says “I already checked this connection, return true” after the first invocation defeats that protection. ([GitHub](https://github.com/mscdex/ssh2/issues/935))

For a fixed fleet, pinning the exact public key or an OpenSSH-format SHA-256 fingerprint is straightforward:

```js
const { createHash } = require('node:crypto');

const allowedFingerprints = new Set([
  'SHA256:REPLACE_WITH_EXPECTED_FINGERPRINT'
]);

function hostVerifier(rawHostKey) {
  const fp =
    'SHA256:' +
    createHash('sha256')
      .update(rawHostKey)
      .digest('base64')
      .replace(/=+$/, '');

  return allowedFingerprints.has(fp);
}

conn.connect({
  host,
  username,
  privateKey,
  // deliberately do NOT set hostHash here:
  hostVerifier
});
```

An even cleaner scheme when you provision keys centrally is to store the actual OpenSSH public-key blob and compare `Buffer`s. The base64 key field in an ordinary `known_hosts` entry represents that blob.

The common mistakes are:

- leaving `hostVerifier` undefined, returning `true` unconditionally, or accepting an unknown key merely because authentication credentials subsequently work;
- checking only that the algorithm is `ssh-ed25519`/RSA/etc., instead of checking the **actual key**;
- setting `hostHash: 'sha256'` and comparing the result against an OpenSSH `SHA256:base64...` fingerprint. `ssh2` gives you **hex** in this mode, so the encodings do not match;
- running `ssh-keygen -H/-F/-l` and comparing its entire output with the verifier argument. Issue #869 is essentially this confusion in the wild; ([GitHub](https://github.com/mscdex/ssh2/issues/869?utm_source=chatgpt.com))
- treating `known_hosts` as merely a fingerprint file. Proper OpenSSH semantics include hostname/port matching, `[hostname]:port`, aliases and hashed hostnames. `ssh2` exposes the verification hook; it does not itself give `hostVerifier` full OpenSSH `known_hosts` policy semantics;
- failing open if an asynchronous verifier/database lookup errors or stalls;
- not planning key rotation. Production pin sets normally contain *current + next* keys for a controlled overlap, with unexpected keys rejected and logged.

A useful example of what an application built on `ssh2` adds around the primitive is WebSSH2: it can use a persistent host-key database, distinguish known/mismatched/unknown keys, reject unknown keys in strict mode, and impose a 30-second verification timeout. ([GitHub](https://github.com/billchurch/webssh2/blob/main/README.md?utm_source=chatgpt.com))

## 2. Key types and transport algorithms

The current repository defaults are broader than what “modern only” might imply.

| Area | Default in current `ssh2` README | Supported but off-default / legacy |
|---|---|---|
| Server host keys | `ssh-ed25519`; ECDSA P-256/384/521; `rsa-sha2-512`; `rsa-sha2-256`; **`ssh-rsa`** | `ssh-dss` |
| KEX | Curve25519; ECDH P-256/384/521; DH group-exchange SHA-256; groups 14/15/16/17/18 with SHA-256/512 | group-exchange-SHA1; group14-SHA1; group1-SHA1 |
| Ciphers | ChaCha20-Poly1305; AES-GCM; AES-CTR | CBC AES, 3DES-CBC, RC4/arcfour, Blowfish-CBC, CAST128-CBC |
| MAC | SHA-2 EtM; SHA-1 EtM; SHA-2; SHA-1 | MD5, truncated SHA-1/SHA-2/MD5, RIPEMD160 variants |
| Key generation | RSA, ECDSA (256/384/521), Ed25519 | No DSA generation |

([GitHub](https://github.com/mscdex/ssh2))

“Supported” should not be read as “recommended.” The README itself labels many of these only as “other supported names.” OpenSSH disables `diffie-hellman-group1-sha1` and `ssh-dss` by default because they are weak, and explicitly recommends enabling legacy algorithms only selectively rather than replacing modern defaults. ([OpenSSH](https://www.openssh.com/legacy.html))

One particularly important distinction is **RSA key vs. `ssh-rsa`**. An RSA public key is not obsolete merely because `ssh-rsa` is. The protocol name `ssh-rsa` denotes RSA signatures using **SHA-1**. The same RSA key can use `rsa-sha2-256` or `rsa-sha2-512`. OpenSSH disabled RSA/SHA-1 by default in 8.8 while explicitly saying RSA keys themselves generally need not be replaced. `ssh2` added RSA/SHA-2 support in its v1 work. ([OpenSSH](https://www.openssh.com/txt/release-8.8))

For production configuration, therefore, prefer Ed25519 or RSA/SHA-2 and leave `ssh-rsa`, DSA, SHA-1 KEX and the legacy ciphers disabled unless a specific old appliance needs them. When supporting such a device, use the `append` mechanism **for that destination**, rather than replacing the whole secure default list globally. This mirrors OpenSSH's own recommended legacy-compatibility pattern. ([GitHub](https://github.com/mscdex/ssh2?utm_source=chatgpt.com))

There are several 2026 capability gaps worth knowing. FIDO/U2F security-key support, SSH-certificate authentication and `mlkem768x25519-sha256` post-quantum KEX all remain in open PRs as of September 2026, so they should not be treated as features of published 1.17.0. ([GitHub](https://github.com/mscdex/ssh2/pulls))

There is also a real-world **ECDSA P-521 interoperability edge**. Issue #1472 reports signature-verification failures against Huawei switches when `ecdsa-sha2-nistp521` is selected; moving P-521 later in the host-key preference allowed the connection to negotiate another key type. The issue and a corresponding fix PR remain open. For affected network hardware, production users are demoting/removing P-521 rather than disabling host-key verification. ([GitHub](https://github.com/mscdex/ssh2/issues/1472?utm_source=chatgpt.com))

RSA failures are sometimes server policy rather than `ssh2`: issue #1380 includes a case where a 1024-bit RSA authentication key failed on Fedora but changing it to 2048 bits fixed the problem; Ed25519 also worked. ([GitHub](https://github.com/mscdex/ssh2/issues/1380?utm_source=chatgpt.com))

## 3. Connection timeout, keepalive and “hung connection” behaviour

`readyTimeout`, default **20 seconds**, is specifically the maximum time for the SSH handshake. It is not a command deadline, SFTP-operation timeout or general idle timeout. SSH-level keepalives are **disabled by default** (`keepaliveInterval: 0`); once enabled, `keepaliveCountMax` defaults to 3 unanswered probes. ([GitHub](https://github.com/mscdex/ssh2?utm_source=chatgpt.com))

So simply changing:

```js
readyTimeout: 120000
```

is not a general cure for hangs. Historical issues show handshake timeouts caused by very different things: algorithm/vendor incompatibilities, execution environment/network policy, and cases where the same connection works in an isolated script but not in the full application. ([GitHub](https://github.com/mscdex/ssh2/issues/1071?utm_source=chatgpt.com))

Aggressive keepalives can themselves cause trouble. In issue #474, a user operating across roughly 350 ms latency with substantial forwarded traffic got `No response from server` with a **1-second** keepalive; increasing the interval to **10 seconds** stopped the disconnects. ([GitHub](https://github.com/mscdex/ssh2/issues/474?utm_source=chatgpt.com))

The 2025 DigitalOcean production report is also instructive: development worked, production timed out before completing the handshake. The external platform discussion points to outbound port-22/network-policy restrictions. In other words, debug output that never gets beyond the TCP/early-handshake stage should trigger network-policy investigation before arbitrary `readyTimeout` increases. ([GitHub](https://github.com/mscdex/ssh2/issues?utm_source=chatgpt.com))

More serious is loss **after** connection establishment. Issue #1490, open since April 2026, reproduces high-level SFTP calls such as `readdir()` whose callback can disappear when the server/TCP connection dies during the request. An older #1175 described essentially the same failure mode. PR #1491 attempts to fix cleanup of requests added recursively during disconnect cleanup and is still open. ([GitHub](https://github.com/mscdex/ssh2/issues/1490?utm_source=chatgpt.com))

Consequently a robust wrapper does something like:

```text
operation =
  race(
    ssh/sftp operation,
    explicit 30s/60s operation deadline,
    client "error",
    client "end"/"close",
    channel "close"
  )

on timeout/transport loss:
  reject every outstanding application promise
  destroy/end the client
  establish a fresh connection before retrying
```

Do not assume every callback in `ssh2` will eventually fire.

For long-running remote processes there is another distinction: **closing an SSH channel is not the same thing as killing the OS process**. Issue #382 shows a remote process continuing even after a `KILL` signal request/channel closure, and the README explicitly notes that some servers ignore SSH signal requests. For SIGINT, it even suggests writing `\x03` when `signal('INT')` does not work. ([GitHub](https://github.com/mscdex/ssh2/issues/382?utm_source=chatgpt.com))

Production systems that require hard runtime guarantees therefore usually impose the limit **on the remote side**, e.g. a `timeout` wrapper or controlled process group, rather than assuming `client.end()` is a process supervisor.

There is also an open Node-version performance report: #1452 measured connection/SFTP/listing operations becoming materially slower on Node 21/22/23 than Node 20. If a deployment develops “near timeout” behaviour only after a Node upgrade, testing the same workload on Node 20 is a useful diagnostic, though this is an open performance issue rather than proof of a correctness bug in newer Node. ([GitHub](https://github.com/mscdex/ssh2/issues/1452?utm_source=chatgpt.com))

## 4. What if the server closes a channel halfway through a command?

This needs careful handling because SSH exit status is optional.

An `exec()` channel is a Node `Duplex`. Its `close` event means the SSH channel has been completely closed. An `exit` event **may** precede it with the exit code or signal, but the README explicitly says the SSH2 specification makes the exit notification optional. If an `exit` event was received, `close` is given the same arguments as a convenience. ([GitHub](https://github.com/mscdex/ssh2))

Therefore:

```js
stream.on('close', (code, signal) => {
  // code === undefined does NOT mean exit 0.
});
```

If the server closes a command channel midway and supplied no `exit-status`, you have **partial output plus an indeterminate result**, not success.

A common bug is:

```js
if (code) {
  // error
} else {
  // success   <-- undefined lands here
}
```

Production code should record independently:

```js
let gotExitStatus = false;
let exitCode;
let exitSignal;

stream.on('exit', (code, signal) => {
  gotExitStatus = true;
  exitCode = code;
  exitSignal = signal;
});

stream.on('close', () => {
  if (!gotExitStatus) {
    // command outcome unknown / interrupted
  } else if (exitCode !== 0) {
    // definite command failure
  } else {
    // definite exit 0
  }
});
```

Keep whatever stdout/stderr was already received, but only automatically retry if the operation is idempotent or otherwise retry-safe. There are still open 2026 PRs around close ordering, including avoiding `windowAdjust` after `CHANNEL_CLOSE` and changing SFTP subsystem exit/EOF/close ordering, which reinforces the value of treating channel termination defensively. ([GitHub](https://github.com/mscdex/ssh2/pulls))

## 5. Large command output is an application responsibility

The v1 rewrite deliberately removed `ssh2`'s old **internal backpressure** mechanism. The maintainer explained that Node never standardized a “drain” equivalent after `Readable.push()` returned false, the machinery complicated the implementation, and the new protocol parser made internal backpressure even harder. ([GitHub](https://github.com/mscdex/ssh2/issues/935))

That means this is dangerous:

```js
let output = '';

stream.on('data', chunk => {
  output += chunk.toString();
});
```

for a command whose output is unbounded or controlled by the remote side. Besides the bytes themselves, repeated string concatenation and decoded strings can increase memory consumption considerably.

The production pattern is to stream into a bounded destination: file/object storage, a streaming parser, hash, capped buffer, or a fixed-size ring buffer containing only the last N KiB for diagnostics. If full in-memory output really is required, impose a maximum byte count and terminate the operation when exceeded.

A useful real production example is WebSSH2, which builds on `ssh2` and adds exactly the safeguards absent from the low-level library: its default maximum buffered `exec` output is **10 MiB**, it can rate-limit shell output, and it pauses/resumes SSH streams according to downstream buffer pressure. It separately puts a 30-second timeout on SFTP operations. ([GitHub](https://github.com/billchurch/webssh2/blob/main/DOCS/configuration/ENVIRONMENT-VARIABLES.md?utm_source=chatgpt.com))

This becomes more important in light of a July 2026 security report, discussed below, showing that a malicious peer can currently defeat the intended SSH receive-window bound and drive memory usage upward. ([GitHub](https://github.com/mscdex/ssh2/issues/1505))

## 6. Security advisories and currently open security reports

There are three public CVE-level items I would put on a production inventory.

| Issue | Affected | Status / significance |
|---|---|---|
| **CVE-2020-26301 / GHSA-652h-xwhf-q4h6** | `<1.4.0` | Windows ssh-agent command injection; fixed in 1.4.0. ([CVE](https://www.cve.org/CVERecord?id=CVE-2020-26301&utm_source=chatgpt.com)) |
| **CVE-2023-48795 – Terrapin** | `ssh2 <1.15.0` | SSH prefix-truncation attack; `ssh2` 1.15.0 added the strict-KEX mitigation. ([CVE](https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2023-48795&utm_source=chatgpt.com)) |
| **CVE-2025-70034** | CVE record identifies `1.17.0` | CWE-1333 inefficient-regex/ReDoS, CVSS 7.5 in public databases; published March 2026. ([CVE](https://www.cve.org/CVERecord?id=CVE-2025-70034&utm_source=chatgpt.com)) |

The last one deserves qualification. As of September 2026, npm still shows **1.17.0 as the latest release**, while the public CVE specifically names 1.17.0. I did not find an upstream release that claims to fix CVE-2025-70034, so a production team should not treat “upgrade to latest” as sufficient remediation without verifying a specific patch/commit or vendor statement. ([npm](https://www.npmjs.com/package/ssh2?utm_source=chatgpt.com))

Separately, two significant **open GitHub security reports from July 2026** are not, in the material I found, established CVE/GitHub-Advisory entries. They should therefore be described as reported vulnerabilities, not as maintainer-confirmed advisories:

**#1504 — peer `max_packet_size=0` CPU DoS.** A malicious authenticated SSH server can advertise a zero channel maximum packet size. On the next channel write, `ssh2`'s synchronous send loop can make zero progress forever, pinning the Node event loop near 100%. The issue is still open. ([GitHub](https://github.com/mscdex/ssh2/issues/1504))

**#1505 — channel receive-window memory exhaustion.** The report demonstrates that `ssh2` rejects incoming channel data only when its receive window is exactly zero; an oversized packet can make the window negative, after which subsequent packets bypass that guard and continue buffering. The reporter demonstrated memory growth after sending far beyond the advertised 2 MiB receive window. It too remains open. ([GitHub](https://github.com/mscdex/ssh2/issues/1505))

Those two matter particularly for applications that connect to **untrusted or user-selected SSH servers**. Until fixes are released, process/container isolation, resource limits and killing a worker on an application deadline provide stronger containment than trying to recover inside the same Node event loop: #1504 can synchronously wedge it, so no JavaScript timer can save that process once triggered.

## 7. What production deployments actually do around `ssh2`

The recurring production pattern is to treat `ssh2` as a fairly low-level SSH protocol implementation rather than as a fully opinionated reliability/security layer:

1. **Pin host identity explicitly.** Pre-provision keys for managed servers or persist TOFU state; mismatches fail closed. Do not rely on the auto-accept default. WebSSH2's persistent host-key store is a concrete example. ([GitHub](https://github.com/billchurch/webssh2/blob/main/README.md?utm_source=chatgpt.com))
2. **Leave modern algorithm defaults intact and add legacy compatibility per host.** Don't replace the whole algorithm array just to reach one ancient switch. For the Huawei P-521 problem, users demote that host-key algorithm so another supported host key wins negotiation. ([GitHub](https://github.com/mscdex/ssh2/issues/1472?utm_source=chatgpt.com))
3. **Use multiple independent deadlines:** handshake deadline, command/SFTP-operation deadline, and optionally idle/output-progress deadline. A timed-out operation causes the connection to be discarded rather than returned to a pool.
4. **Use conservative keepalives.** Tens of seconds is a more realistic starting point than sub-second probes; #474 demonstrates the latter producing false disconnections under latency/load. ([GitHub](https://github.com/mscdex/ssh2/issues/474?utm_source=chatgpt.com))
5. **Race every outstanding operation against connection/channel termination.** In particular, don't depend solely on SFTP callbacks until #1490/#1491 is resolved. ([GitHub](https://github.com/mscdex/ssh2/issues/1490?utm_source=chatgpt.com))
6. **Bound output and stream it.** Enforce maximum stdout/stderr bytes, rate limits and downstream backpressure; never concatenate arbitrary remote output indefinitely. WebSSH2's 10 MiB cap is a concrete implementation. ([GitHub](https://github.com/billchurch/webssh2/blob/main/DOCS/configuration/ENVIRONMENT-VARIABLES.md?utm_source=chatgpt.com))
7. **Treat `close` without an exit status as “unknown outcome.”** Retry only when the operation is safe to repeat. ([GitHub](https://github.com/mscdex/ssh2))
8. **Enforce remote execution time remotely.** SSH channel closure or `signal()` is not a reliable process-kill primitive across SSH servers. ([GitHub](https://github.com/mscdex/ssh2/issues/382?utm_source=chatgpt.com))
9. **Capture `debug` negotiation logs when diagnosing interoperability**, but sanitize them before central logging. “Handshake timeout” is often the symptom, not the cause.
10. **For hostile endpoints, isolate SSH work in expendable workers** with OS/container CPU and memory limits. That is particularly justified while #1504/#1505 remain open.

### Bottom line

For a controlled server fleet, `ssh2` 1.x can be operated reliably, but the safe wrapper around it is substantially stricter than the README's simplest examples: **explicit host-key pinning, per-operation deadlines, bounded output, careful channel-close semantics, conservative keepalives, per-host algorithm exceptions, and destruction of questionable connections rather than reuse**.

For connections to arbitrary/untrusted SSH servers, the September 2026 picture is more concerning. The current npm release is still 1.17.0, a public ReDoS CVE names that version, and two July 2026 open reports describe peer-triggered CPU and memory DoS paths. ([npm](https://www.npmjs.com/package/ssh2?utm_source=chatgpt.com)) In that threat model I would put `ssh2` execution behind a disposable worker/container boundary in addition to the normal application-level safeguards.

---

If you want, I can:

- Explain in detail how to implement robust host key verification in ssh2
- Describe practical strategies to handle ssh2 connection timeouts and keepalive settings
- Summarize production workarounds for ssh2's large command output handling and security issues
