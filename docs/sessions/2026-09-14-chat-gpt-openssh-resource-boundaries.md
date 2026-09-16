# OpenSSH Resource Boundaries

Source: https://chatgpt.com/share/6aa774d0-d098-83eb-83bd-dbaf540e2497

---

## Turn 1: User

_2026-09-14T04:04:17.686Z_

We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Determine whether OpenSSH offers a coherent bounded resource suitable for structured authorization management. Compare an authorized-key entry, a configured authorized-key file, and the account's configured authorization sources. Define exactly what each boundary includes and excludes, rather than equating any of them with all SSH access.

Investigate multiple files, path expansion, Match conditions, different daemon instances, AuthorizedKeysCommand, certificate authorities, and account discovery. Can a system enumerate all relevant file entries without claiming to enumerate all effective access? What context is needed to interpret a result? Distinguish a visible entry from an effective authorization.

Provide a resource-and-operation vocabulary suitable for a public API and structured forms, without designing layouts. Explain whether entry origin matters and how duplicate lines affect identity. Identify every assumption needed for a first supported server configuration. Do not assume that exposing more configuration is better, or that hiding it is simpler. Deliver a boundary proposal with counterexamples that would invalidate it.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.
```

---

## Turn 2: ChatGPT

_2026-09-14T04:04:18.434Z_

I’ll separate three layers: what `sshd` is configured to consult, what file-backed entries are visible, and what can actually authenticate. I’ll anchor the result in Ubuntu 24.04’s OpenSSH package plus upstream/OpenBSD documentation and source, then turn that into a bounded public-API vocabulary with failure tests.

---

## Turn 3: ChatGPT

_2026-09-14T04:05:14.166Z_

One decisive point is already clear from the 9.6p1 code path: for a candidate public key, `sshd` checks configured `AuthorizedKeysFile` entries in order, then `TrustedUserCAKeys`, then `AuthorizedKeysCommand`; it stops at the first successful authorization. So “the account’s SSH keys” is not a single native object, and even “all public-key access” is broader than files.

---

## Turn 4: ChatGPT

_2026-09-14T04:07:36.584Z_

A version trap matters for the boundary: Ubuntu 24.04’s baseline is OpenSSH Portable 9.6p1, where `AuthorizedKeysFile` is a finite whitespace-separated path list with `%` expansion; upstream OpenSSH 10.0 (released April 9, 2025) added glob patterns. A parser based on today’s upstream man page would therefore mis-model an unpatched Noble server.

---

## Turn 5: ChatGPT

_2026-09-14T04:11:34.738Z_

## Recommendation

**Yes: OpenSSH has a coherent bounded resource for structured management, but the useful boundary is narrower than “SSH access” or even “the account’s SSH keys.”**

For Composery, I would model **authorized-key file entries as occurrence-level resources within concrete `AuthorizedKeysFile` files**, scoped by a **specific `sshd` daemon configuration, target account, and—where configuration varies—connection context**.

Treat the broader **public-key authorization sources** as an aggregate/read model, not as one homogeneous CRUD collection. It can describe file-backed authorizations, certificate trust and `AuthorizedKeysCommand`, but it should not imply that all sources have the same mutation semantics or that they collectively describe all SSH access.

I would not ship an API named `sshKeys`, `authorizedKeys` at account scope, or `sshAccess` unless its semantics are deliberately narrower than those names normally imply.

### Evidence baseline

The primary implementation baseline here is **OpenSSH Portable 9.6p1**, released **December 18, 2023**. The Portable repository’s 9.6p1 version-crank commit is `8241b9c0529228b4b86d88b1a6076fb9f97e4a99`; Portable OpenSSH is the OpenBSD-derived port used on Linux. ([OpenSSH](https://www.openssh.com/txt/release-9.6))

As checked **September 14, 2026**, Ubuntu 24.04 Noble’s updates archive publishes `openssh-server 1:9.6p1-3ubuntu13.19`. That is the relevant distro family, but Composery must inspect the package actually installed on each VPS rather than assume it is current or unmodified. ([Ubuntu Packages](https://packages.ubuntu.com/noble-updates/openssh-server?utm_source=chatgpt.com))

I used the exact upstream `V_9_6_P1` source for behavior below. I **did not run an Ubuntu VPS experiment**, and I was not able to complete a patch-by-patch audit of Ubuntu's current `-3ubuntu13.19` downstream delta. That delta should therefore remain an explicit verification item before claiming byte-for-byte equivalence with upstream 9.6p1.

There is already a concrete version-dependent difference worth guarding against: OpenSSH 9.6p1 describes `AuthorizedKeysFile` as a whitespace-separated set of paths after token/home expansion, whereas OpenSSH **10.0, released April 9, 2025**, added glob patterns to `AuthorizedKeysFile` and `AuthorizedPrincipalsFile`. The current OpenBSD manual consequently documents wildcard support. Do not implement Noble semantics from OpenBSD-current/current upstream documentation. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))

---

## The three candidate boundaries

| Boundary | Exactly includes | Explicitly excludes | Suitable as CRUD resource? |
|---|---|---|---|
| **Authorized-key entry occurrence** | One non-comment physical line occurrence in one concrete `AuthorizedKeysFile`; its key options, key/CA material, type, comment, raw representation and origin | Other occurrences of the same key; other files; CA files; commands; password/GSSAPI/etc.; whether login ultimately succeeds | **Yes — best primitive** |
| **Authorized-key file** | One concrete filesystem file resolved from an effective `AuthorizedKeysFile` item, plus all its line occurrences and file metadata | Other configured files; `AuthorizedKeysCommand`; `TrustedUserCAKeys`; other auth methods | **Yes**, with filesystem/concurrency constraints |
| **Account public-key authorization sources** | The set/order of positive public-key authorization mechanisms applicable to a daemon/account/context: `AuthorizedKeysFile`, `TrustedUserCAKeys` plus principal policy, and `AuthorizedKeysCommand` | Password, keyboard-interactive, hostbased, GSSAPI; negative policy such as revocation is not itself an authorization source; does not mean “can log in” | **Good aggregate/read resource; poor uniform CRUD resource** |

### 1. Authorized-key entry

This is the cleanest native bounded object.

OpenSSH documents an authorized-keys file as one key per line, ignoring blank/comment lines; a line consists of optional options, key type, base64 key and comment. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd.8))

But “entry” must mean a **physical occurrence**, not “a unique public-key fingerprint.” The same public key can appear several times with different restrictions. OpenSSH scans lines and marks the file successful only when a line both matches the offered credential **and passes its authorization options**. A matching key refused because of `from=`, certificate principal restrictions, expiry or other options does not prevent a later occurrence from succeeding. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))

Therefore:

```text
AuthorizedKeyEntry identity ≠ key fingerprint
```

A key fingerprint is an attribute of key material. Entry identity is an occurrence at an origin.

An authorized-key entry can also be a **CA authorization**, not an individual client key. OpenSSH explicitly matches a presented certificate against the CA signing key when the line has `cert-authority`; `principals=` can further constrain certificates. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))

That makes names such as `SshPublicKey` misleading for the resource. `AuthorizedKeyEntry` or `AuthorizedKeyEntryOccurrence` is accurate.

### 2. Configured authorized-key file

This is also coherent, but distinguish the **configured source expression** from the **concrete file**.

In 9.6p1, `AuthorizedKeysFile` may name multiple whitespace-separated files. Paths undergo supported token expansion and, if relative, are relative to the account home directory. `none` disables file lookup. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))

So there are really two related objects:

```text
AuthorizedKeyFileSource
  configuredExpression
  configPosition
  resolvedPath

AuthorizedKeyFile
  path
  filesystem identity/version
  entries[]
```

For Noble/9.6p1, a configured item resolves to one path. With OpenSSH 10.0+, a configured expression may contain a glob and therefore resolve to zero, one or many files. That is another reason not to conflate “configured source” with “physical file.” ([OpenSSH](https://www.openssh.com/txt/release-10.0))

Presence is not effectiveness. In upstream 9.6p1, the file must open successfully, be a regular file, and—when strict-mode checking is active—pass OpenSSH's safe-path checks; otherwise it is ignored/refused for authentication. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))

### 3. Account's configured authorization sources

This boundary is meaningful only if named more precisely:

**`PublicKeyAuthorizationSources` for `(sshd instance, account, connection context)`**.

It is not an account-global key collection.

For an offered public-key credential, upstream 9.6p1 checks configured `AuthorizedKeysFile` paths until one succeeds, then checks certificate trust through `TrustedUserCAKeys`, then `AuthorizedKeysCommand`; success short-circuits the remaining mechanisms. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkey.c))

The manual independently confirms that `AuthorizedKeysCommand` produces authorized-keys-format lines and is tried after the normal authorized-key files. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))

`TrustedUserCAKeys` introduces a qualitatively different authorization model. A trusted CA can authorize certificates based on principals rather than storing every user's presented public key. `AuthorizedPrincipalsFile` applies to CAs trusted through `TrustedUserCAKeys`, while CA entries placed directly in an authorized-keys file instead use entry options such as `principals=`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))

So this aggregate can truthfully say:

> “These are the configured positive sources OpenSSH may consult for the `publickey` authentication method in this context.”

It cannot truthfully say:

> “These are all keys that can access this server.”

---

# Visible entry versus effective authorization

I recommend making this distinction explicit in the API.

**Verified fact:** a physical line can exist but fail authorization because its key options reject the connection, its certificate constraints fail, the containing file is unusable, or another relevant policy rejects the credential. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))

**Deduction:** a live inventory read can reliably report *presence and parseability* without having enough information to claim *effectiveness*.

Use approximately these terms:

```text
visibleEntry
    A physical entry occurrence observed in a configured file.

applicableEntry
    An entry whose key/certificate form and entry options match a
    particular offered credential and connection context.

publicKeyAuthorization
    Acceptance of a concrete offered credential by OpenSSH's
    "publickey" authentication method in a concrete context.

sshAuthentication / login
    Broader result after the complete configured authentication
    sequence and account/session policy.
```

RFC 4252 makes this distinction at the protocol level. Public-key authentication requires proving possession of the private key and server acceptance of the public key, but the server may still require additional authentication. OpenSSH's `AuthenticationMethods`, for example, can require `publickey,password`. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4252.txt))

Therefore a successful public-key authorization is still not synonymous with “SSH login succeeds.”

---

## Can Composery enumerate all relevant file entries?

**Yes, with a bounded completeness claim.**

A defensible statement is:

> “For this identified `sshd` instance, target account, effective connection context, supported OpenSSH configuration and filesystem snapshot, Composery enumerated every entry occurrence in every resolved `AuthorizedKeysFile` source.”

That is materially different from:

> “Composery enumerated everyone who can SSH to this account.”

The first is feasible. The second is not implied.

The enumeration result should carry coverage, e.g.:

```ts
fileEntryCoverage: "complete" | "partial" | "unsupported"
publicKeySourceCoverage: "files-only" | "includes-non-file-sources"
effectiveAuthorization: "not-evaluated"
```

A configured but absent file can still count as **accounted for**: represent the source with `state: "absent"` rather than silently dropping it.

`AuthorizedKeysCommand` does not make the file enumeration incomplete; it means that **files are not the whole public-key authorization universe**.

Likewise, CA trust does not prevent complete enumeration of `AuthorizedKeysFile` entries. It prevents equating those entries with every credential that may authenticate.

---

# Context necessary to interpret a result

The minimum interpretation scope is broader than `(server, username)`.

### Daemon identity

`sshd` can be started with an alternate configuration using `-f`, arbitrary configuration overrides using `-o`, and different listening ports with `-p`. Two daemon instances on the same machine can therefore give the same Unix account different authorization behavior. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd.8))

So the root identifier should be something like:

```text
SshDaemon
  executable
  runningVersion
  argv/configOrigin
  listeners
```

Do not make authorization a server/account-global resource unless your supported configuration guarantees one relevant daemon.

### Connection context and `Match`

`sshd -T -C` exists specifically because effective configuration may depend on `Match`; the supported connection parameters include source address, user, resolved source host, local address, local port and routing domain. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd.8))

Thus an account may have one `AuthorizedKeysFile` when connecting from one network and another from elsewhere.

For an API with no connection context, the safe v1 rule is to require the authorization-source configuration you manage to be invariant across applicable `Match` branches.

### Account identity

Upstream 9.6p1 resolves the requested username through `getpwnam()`, not by scanning `/home`. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth.c)) GNU libc describes that function as looking up the system user database. ([Sourceware](https://sourceware.org/glibc/manual/2.39/html_node/Lookup-User.html?utm_source=chatgpt.com))

Therefore:

- `GET account/{name}` should use OS account resolution equivalent to the daemon.
- `/home/*` is not account discovery.
- Home directory and UID used in path expansion should come from the resolved account record.
- If you provide `listAccounts`, its completeness across arbitrary NSS/network identity providers is a separate question. For the first Ubuntu image, restricting enumeration to the known local-account configuration would remove that ambiguity.

RFC 4252 independently requires nonexistent usernames never to authenticate. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4252.txt))

---

# Public API vocabulary

I would use these domain resources:

```text
SshDaemon
SshAccount

PublicKeyAuthorizationView
PublicKeyAuthorizationSource
  - AuthorizedKeyFileSource
  - TrustedUserCaSource
  - AuthorizedKeysCommandSource

AuthorizedKeyFile
AuthorizedKeyEntry

AuthorizationContext
AuthorizationCoverage
```

`PublicKeyAuthorizationView` is a live aggregate, not a database inventory.

For `AuthorizedKeyEntry`, useful semantic fields are:

```ts
{
  id: OpaqueOccurrenceRef,
  origin: {
    daemonId,
    account,
    configuredSourceIndex,
    path,
    // line/spans may be diagnostic attributes, not permanent IDs
  },

  raw: string,

  parsed: {
    kind: "key" | "certificate-authority",
    options: ...,
    keyType: ...,
    publicKey: ...,
    fingerprint: ...,
    comment: ...
  } | {
    kind: "unparsed"
  }
}
```

### Why origin matters

It matters for three independent reasons:

1. configured files are searched in order;
2. entries inside files are searched in order;
3. two occurrences of the same key can have different authorization options.

The code stops scanning after the **first successfully authorizing occurrence**, not merely the first matching fingerprint. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))

So duplicates must remain distinct resources.

I would make occurrence IDs **snapshot-relative opaque IDs**, not promise a permanent UUID for text OpenSSH never gave an identity to. For example, derive an internal reference from file version/inode where appropriate + byte range/line + line hash. Native edits can legitimately invalidate it.

### Operations

A small public operation set is enough:

```text
getSshDaemon
getSshAccount
readPublicKeyAuthorization

listAuthorizedKeyFiles
listAuthorizedKeyEntries
validateAuthorizedKeyEntry

createAuthorizedKeyEntry
replaceAuthorizedKeyEntry
deleteAuthorizedKeyEntry
```

All mutations should use an expected file/snapshot version. Avoid `setKeys()` or “replace authorized keys” APIs: those encourage clobbering native comments, unknown syntax, ordering and concurrent edits.

Creating a missing `.ssh` directory or authorized-key file is a **filesystem provisioning operation**, not merely “create entry”; its ownership and mode semantics deserve separate handling.

---

# First supported server configuration: explicit assumptions

For a bounded v1 I would require or detect all of the following.

### Platform/runtime assumptions

1. **Ubuntu 24.04 only**, with installed OpenSSH Portable version/package explicitly allowlisted. Current Noble updates expose 9.6p1-based `1:9.6p1-3ubuntu13.19`; do not assume a particular patch revision without inspecting it. ([Ubuntu Packages](https://packages.ubuntu.com/noble-updates/openssh-server?utm_source=chatgpt.com))
2. The managed daemon's executable and startup arguments are known; no unsupported/custom `sshd` binary.
3. Composery binds the feature to **one identified daemon instance/listener**. Other daemon instances are outside that resource.
4. The agent has sufficient OS privilege to read configuration/account metadata and safely mutate the selected files.

### Configuration assumptions

5. Configuration, including all `Include`s, parses successfully using the same binary/config invocation as the running daemon. `Include` itself supports wildcards and may be conditional, so reading only `/etc/ssh/sshd_config` is insufficient. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))
6. If the API does not take a connection context, `AuthorizedKeysFile` must be invariant across relevant `Match` cases. Prefer rejecting mutation when this cannot be proved rather than sampling a few `sshd -T -C` combinations.
7. For the Noble/9.6p1 implementation, only that release's `AuthorizedKeysFile` expansion semantics are supported. Do not silently accept 10.0 glob semantics. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))
8. `PubkeyAuthentication` must be enabled if the product operation is called “authorize”; otherwise entries can still be inventoried but are not an active authorization source.

### Account/filesystem assumptions

9. The target username resolves through the OS account database and yields a stable UID/home for the duration of an operation. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth.c))
10. Every file used for mutation resolves to a supported regular filesystem object. OpenSSH itself ignores a non-regular authorization file. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))
11. V1 should reject symlink-backed mutation unless you deliberately specify symlink replacement semantics. Reading and editing-through-symlink versus atomic replacement are different filesystem operations.
12. Existing file ownership/mode are preserved; unsafe permission states are reported rather than “fixed” as an incidental side effect.
13. Mutations are optimistic-concurrency protected and atomic from the reader's perspective.

### Syntax/source assumptions

14. Unknown or unsupported lines are preserved byte-for-byte. Do not rewrite an entire native file merely because only some lines are structurally understood.
15. Duplicate key material is supported and not deduplicated automatically.
16. `cert-authority` entries must either be modeled explicitly or marked unsupported for structured mutation; never display them as ordinary end-user keys.
17. `AuthorizedKeysCommand`, `TrustedUserCAKeys`, `AuthorizedPrincipals*`, revocation and similar policy must be detected if present and reflected in coverage. They need not all become editable.
18. V1 makes **no “can login” claim** from file inventory alone.

If Composery instead promises **complete public-key authorization management**, the support constraints become much stricter: you must either model command/CA/principal sources and relevant policy or refuse that promise whenever they are active.

---

# Counterexamples that invalidate broader boundaries

These should become tests, not just documentation.

```text
Match Address 10.0.0.0/8
    AuthorizedKeysFile .ssh/internal_keys
```

Invalidates an account-only file resource: source address changes the file set.

```text
/usr/sbin/sshd -f /etc/ssh/alternate.conf -p 2222
```

Invalidates a host/account resource: another daemon may use different authorizations.

```text
AuthorizedKeysCommand /usr/local/bin/lookup-keys
```

A key absent from every configured file can still be accepted. OpenSSH explicitly allows the command to emit authorized-keys-format entries. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))

```text
TrustedUserCAKeys /etc/ssh/user_ca_keys
```

A user's presented key need never appear in an account's file; a valid CA-signed certificate can authorize it.

```text
cert-authority,principals="ops" ssh-ed25519 AAAA...
```

One file entry may authorize a potentially large set of certificates. It is not a “user's public key.” ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd.8))

```text
from="203.0.113.0/24" ssh-ed25519 AAAA...
ssh-ed25519 AAAA...
```

Same key, two distinct entry identities. The first may fail on source restrictions and the second succeed. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c))

```text
AuthenticationMethods publickey,password
```

The key can be successfully accepted while login still requires another authentication step. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))

And on OpenSSH 10.0+:

```text
AuthorizedKeysFile .ssh/authorized_keys.d/*
```

A single configured expression can represent a changing set of physical files. That invalidates a version-independent assumption that one config item means one file. ([OpenSSH](https://www.openssh.com/txt/release-10.0))

---

# Strongest simpler alternative

The strongest simpler alternative is **support exactly one known `AuthorizedKeysFile` configuration and refuse structured management outside it**.

For a Composery-provisioned Ubuntu image, for example, configure one deterministic native path and define v1 as:

> Composery manages entries in this particular OpenSSH authorized-key file. If the daemon's effective configuration no longer matches the supported profile, the structured management operation becomes unsupported.

This is simpler than discovering arbitrary OpenSSH authorization topologies, while preserving the important product property that ordinary OpenSSH works without Composery being online. The server file remains authoritative and clients keep their private keys.

It is preferable if:

- Composery controls initial provisioning;
- supporting arbitrary hand-customized `sshd_config` is not a launch requirement;
- the feature promise is “manage these native SSH authorizations,” not “understand every way this server can authenticate users.”

A variant is a **dedicated Composery `AuthorizedKeysFile`** alongside customer-managed native files. That gives even stronger ownership/isolation, but it changes the product semantics: Composery would manage *its* native authorization namespace rather than surfacing the customer's whole configured file state.

`AuthorizedKeysCommand` backed by the control plane is simpler from a database perspective but weaker against your independence requirement: authentication acquires a runtime dependency unless you build a local authoritative cache. I would not choose it merely to simplify CRUD.

A certificate-CA model becomes attractive if the future requirement is centralized, short-lived access issuance rather than native per-key editing; it is not the simpler answer to the current requirement.

---

# Pass/fail checks for v1

| Check | PASS | FAIL / downgrade |
|---|---|---|
| **Version** | live daemon/package belongs to tested allowlist | custom/unsupported OpenSSH → no mutation |
| **Daemon scope** | concrete executable, args/config and listener identified | ambiguous multiple daemon scope |
| **Config** | same daemon invocation can produce valid effective config | inaccessible include, parse failure, unknown startup override |
| **Match** | managed source configuration is provably invariant, or caller supplies complete context | context-sensitive source with context-free request |
| **Account** | OS lookup resolves username/UID/home | unresolved account |
| **Sources** | every configured `AuthorizedKeysFile` target is resolved/accounted for | unsupported source expression/version semantics |
| **Read coverage** | every applicable existing file read; missing targets explicitly recorded | unreadable/unresolved source → `partial` |
| **Entry parse** | supported lines parsed; unknown lines preserved | parser would destroy or normalize unknown data |
| **Mutation** | exact file version still current; ownership/mode preserved; atomic write possible | concurrent/native modification → conflict |
| **Completeness claim** | result says “all configured AuthorizedKeysFile entries” | never upgrade this to “all SSH access” merely because enumeration succeeded |
| **Effectiveness claim** | concrete daemon, user, connection context, time and credential are available and all relevant semantics supported | otherwise `effectiveAuthorization = notEvaluated` |

A reproducible, non-secret initial probe on Noble can include:

```bash
dpkg-query -W -f='${Package} ${Version}\n' openssh-server
/usr/sbin/sshd -V

# Identify the actual parent/listening sshd and its argv separately.

sudo /usr/sbin/sshd -T \
  -C user=example,addr=198.51.100.10,laddr=192.0.2.10,lport=22

getent passwd example
```

The important qualification is that invoking bare `/usr/sbin/sshd -T` is insufficient if the running daemon was launched with `-f`, `-o`, or other material startup arguments; reproduce its invocation. `-T -C` is specifically provided to print effective configuration after applicable `Match` handling. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd.8))

---

## Verified facts, deductions, recommendations, unknowns

**Verified:** OpenSSH 9.6p1 supports multiple `AuthorizedKeysFile` paths; file entries can directly authorize keys or act as certificate authorities; `TrustedUserCAKeys` and `AuthorizedKeysCommand` provide additional public-key authorization mechanisms; authorization varies with concrete connection/configuration context; duplicate occurrences are semantically distinct; OpenSSH account lookup uses the system user database. ([GitHub](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd_config.5))

**Deduction:** a complete inventory of configured `AuthorizedKeysFile` occurrences is achievable without—and should explicitly avoid—claiming complete effective SSH access. The natural native management primitive is the line occurrence plus its file/source origin.

**Recommendation:** make the public mutable boundary `AuthorizedKeyEntry` / `AuthorizedKeyFile`; make `PublicKeyAuthorizationView` a live aggregate with coverage metadata; bind everything to an identified `SshDaemon` and `SshAccount`; initially reject source-changing `Match` configurations rather than attempting to abstract them away.

**Unknown:** I have not verified whether Ubuntu's `1:9.6p1-3ubuntu13.19` downstream patch series changes any of the exact authorization paths cited from upstream `V_9_6_P1`. Before production support, reproduce the analysis against Ubuntu's source package:

```bash
apt source openssh=1:9.6p1-3ubuntu13.19
```

then inspect `debian/patches/series` and diff the relevant `auth2-pubkey.c`, `auth2-pubkeyfile.c`, `auth.c`, `servconf.c` and man pages against upstream `V_9_6_P1`.

The main product decision evidence cannot make for you is the **promise level**: whether v1 means **“structured management of configured native AuthorizedKeysFile entries”** or **“exhaustive management of public-key authorization.”** The evidence strongly favors the first boundary for Composery's initial scope; the second is a substantially different feature, not just a more complete implementation of the same resource.
