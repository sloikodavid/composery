# Authorized Keys UI Design

Source: https://chatgpt.com/share/6aa8716f-4594-83eb-9309-73b91786147b

---

## Turn 1: User

_2026-09-14T22:01:56.183Z_

Context: A web control panel lets customers manage entries in OpenSSH authorized_keys files on their Linux VPS. Most customers are new to Linux and SSH; some are experts. The panel wants a simple default form and a complete advanced form, both mapping exactly to native OpenSSH options, without inventing semantics or hiding what an entry allows.

Question: How should authorized_keys options be presented so that beginners can add a key safely and experts can use every native option?

Cover: which fields belong in a simple default (for example key, account, and comment) and why; how to group advanced options; conflicts and dependencies between options (for example `restrict` with explicit permits, or `command` with pty options); how to show entries that contain options the form does not understand, or malformed content; how to enter and display time values such as `expiry-time`; how to explain what an entry permits without overstating the protection it gives; and examples from existing products.

Evidence rules: Cite product documentation or screenshots with dates, and OpenSSH man pages for option semantics. Separate evidence from opinion. Name the usability risks of each design you describe.

---

## Turn 2: ChatGPT

_2026-09-14T22:01:56.718Z_

I’ll anchor the option semantics in current OpenSSH documentation, then compare how real control panels expose SSH keys/options. I’ll keep “what the evidence says” separate from the recommended UX, and call out failure modes for each design choice.

---

## Turn 3: ChatGPT

_2026-09-14T22:02:11.456Z_

A key distinction is emerging: most mainstream panels only solve “store/select a public key,” not “edit a native `authorized_keys` line.” That makes them useful examples for the beginner surface, but not precedents for a complete advanced editor; I’m treating those as separate design problems.

---

## Turn 4: ChatGPT

_2026-09-14T22:03:15.226Z_

The OpenSSH details change the form model in an important way: “allow/deny” is not always a single Boolean. `restrict` disables five capabilities, later positive options can re-enable them, and `permitopen`/`permitlisten` only narrow forwarding—they do not themselves re-enable forwarding after `restrict`. A structured editor therefore needs to model effective state and serialize a canonical native option string, not just concatenate checkboxes.

---

## Turn 5: ChatGPT

_2026-09-14T22:05:40.719Z_

A good design is a **two-layer editor over the exact `authorized_keys` line**, not two different permission models. The simple form should create a normal key entry with no hidden options. The advanced form should expose every OpenSSH option, preserve anything it cannot safely understand, and always show the exact line/effect being written.

## Evidence: what OpenSSH actually represents

As of the OpenBSD-current `sshd(8)` manual dated **September 2, 2026**, an `authorized_keys` line has four fields:

`[options] keytype base64-key [comment]`

The options field is optional. The comment has **no authentication meaning**; OpenSSH explicitly says it is unused except as a convenient identifier. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd))

That distinction matters for the UI:

| UI concept | Native meaning |
|---|---|
| Account | **Not part of the line.** It determines whose `AuthorizedKeysFile` the panel edits. |
| Public key | Native key type + key material. |
| Comment | Native trailing comment; informational only. |
| Restrictions | Native comma-separated option field before the key. |

OpenSSH's current documented key options are `agent-forwarding`, `cert-authority`, `command`, `environment`, `expiry-time`, `from`, `no-agent-forwarding`, `no-port-forwarding`, `no-pty`, `no-user-rc`, `no-X11-forwarding`, `permitlisten`, `permitopen`, `port-forwarding`, `principals`, `pty`, `no-touch-required`, `verify-required`, `restrict`, `tunnel`, `user-rc`, and `X11-forwarding`. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd))

A plain key has **no per-key restrictions**. That does not mean every SSH feature will necessarily work: `sshd_config`, certificates, account configuration, filesystem permissions, and other server policy can further restrict it. For example, `AllowTcpForwarding`, `PermitTTY`, `PermitTunnel`, `PermitUserEnvironment`, and `GatewayPorts` impose server-side constraints. ([man7.org](https://man7.org/linux/man-pages/man5/sshd_config.5.html))

## Recommendation: the default form

I would make the default screen essentially:

| Field | Presentation | Why | Main usability risk |
|---|---|---|---|
| **Account** | Existing Unix-account selector; show actual target path underneath | Users primarily need to know *which login account* the key authorizes. It is panel context, not an invented SSH option. | “Account” could be mistaken for something stored in the key line. Say “Install for Unix account …”. |
| **Public key** | Large paste box accepting a complete `.pub` line | This matches how users obtain keys. Parse it immediately and show key type + SHA256 fingerprint. | Accidentally pasting a private key; reject recognizable private-key material prominently. |
| **Comment** | Optional text; populate from pasted `.pub` comment | Native field and useful for recognition. | Users may think it controls access. Label it “Comment — for identification only; OpenSSH does not enforce it.” |
| **Expires** | Optional, initially collapsed as “Add an expiration” | `expiry-time` has understandable, useful safety semantics for temporary access. | Date/timezone ambiguity; see below. |
| **Advanced options** | Expansion/link with a visible summary such as “No per-key restrictions” | Keeps normal key installation simple without concealing capabilities. | “No restrictions” can be misread as “unsafe server.” Phrase it specifically as **per-key** restrictions. |

Do **not** enable `restrict` by default. That would silently change the semantics of a normal SSH public key and can break PTY, agent-forwarding and forwarding-dependent workflows. Conversely, don't call an unrestricted line “Full access”: the server may deny functions elsewhere.

If someone pastes an entire existing `authorized_keys` line containing options into the key box, **never strip the option prefix**. Detect it, parse it, open the advanced state, and say that the pasted entry already contains restrictions. Silently reducing

`restrict,command="backup" ssh-ed25519 AAAA...`

to

`ssh-ed25519 AAAA...`

would be a serious privilege-widening UI bug.

This simple shape has real product precedent. CloudStick's documentation, updated **June 20, 2026**, shows a direct server SSH-key form with **Key Label, System User, and Public Key**, and says it writes the key to the selected user's authorized keys. ([CloudStick](https://cloudstick.io/knowledge-base/how-to-add-an-ssh-key)) DigitalOcean's control panel, documentation last verified **July 13, 2026**, asks for **Public Key** and **Key Name** and shows fingerprints, although that is an account/team key bank used when creating Droplets rather than a full live `authorized_keys` editor. ([DigitalOcean](https://docs.digitalocean.com/platform/teams/how-to/upload-ssh-keys/)) UpCloud similarly uses a key text box plus name in its account-level key manager; its documentation was updated **January 14, 2026**. ([UpCloud](https://upcloud.com/docs/guides/managing-ssh-keys/))

So those products are good precedents for the **beginner surface**, but not evidence that advanced OpenSSH options should be hidden.

## Recommendation: group the advanced form by what OpenSSH controls

Keep the literal native token beside every control, so an expert never has to guess what the panel means.

| Group | Native options | Suggested presentation |
|---|---|---|
| **Where & when this key authenticates** | `from="…"`, `expiry-time="…"` | Pattern/CIDR input and expiration picker. Show exact serialized value. |
| **Certificate authority** | `cert-authority`, `principals="…"` | Explicit “Treat this key as a user CA” mode. Principals as a repeatable/list input. Visually separate because this fundamentally changes what the public key represents. |
| **Forced command** | `command="…"` | Command text field, with exact escaped native preview. |
| **Session capabilities** | `restrict`, `pty` / `no-pty`, `user-rc` / `no-user-rc` | `restrict` as the native bundled restriction, followed by explicit exceptions. |
| **Forwarding** | `agent-forwarding` / `no-agent-forwarding`; `port-forwarding` / `no-port-forwarding`; repeatable `permitopen`; repeatable `permitlisten`; `X11-forwarding` / `no-X11-forwarding` | Capability states plus detailed endpoint lists. Clearly distinguish local (`-L`) and remote (`-R`) forwarding. |
| **Environment** | repeatable `environment="NAME=value"` | Name/value rows. Say that `PermitUserEnvironment` controls whether sshd processes them. |
| **Tunnelling** | `tunnel="n"` | Numeric TUN device field with server-policy warning. |
| **FIDO/security-key behaviour** | `no-touch-required`, `verify-required` | Show for all experts but annotate as applicable to `sk-*` keys. |
| **Native representation** | complete option string + complete line | Read-only live preview by default, with an expert “Edit raw line” mode. |

For the paired capability options, avoid two unrelated checkboxes such as **Allow PTY** and **Disable PTY**. Use a three-state control:

**No per-key option** → **Block in this entry (`no-pty`)** → **Explicitly permit after `restrict` (`pty`)**.

Use the same model for agent forwarding, port forwarding, X11 forwarding and user RC. The wording “Explicitly permit after `restrict`” matters because a key-line option cannot override a server-level denial.

The main risk of an ordinary checkbox design is that it invents a permission hierarchy OpenSSH doesn't have and encourages claims such as “PTY allowed” when `PermitTTY no` may still prevent it.

## Conflicts and dependencies

These should be **visible validation relationships**, not silently “fixed” behind the user's back.

**`restrict` and positive exceptions.** OpenSSH says `restrict` disables port, agent and X11 forwarding, PTY allocation and `~/.ssh/rc`. The corresponding positive options re-enable capabilities disabled by `restrict`. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd)) Current OpenSSH's parser processes these flags sequentially: `restrict` clears the five flags and later positive options can set them again. Therefore a structured serializer should emit `restrict` before its exceptions, e.g. `restrict,pty,…`; OpenSSH itself documents exactly that pattern. ([GitHub](https://github.com/openssh/openssh-portable/blob/master/auth-options.c?utm_source=chatgpt.com))

**Usability risk:** presenting `restrict` as an absolute “lock down this key” toggle. It is a bundle of five specific restrictions, and exceptions can follow it. Show those five effects immediately underneath it.

**`restrict` with `permitopen`/`permitlisten`.** `permitopen` and `permitlisten` limit forwarding destinations/listeners; `port-forwarding` is the option that re-enables forwarding disabled by `restrict`. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd)) Therefore `restrict,permitopen="db:5432"` does not communicate the same thing as `restrict,port-forwarding,permitopen="db:5432"`.

The UI should warn “This list has no effect while this entry blocks port forwarding” and offer an explicit control for `port-forwarding`. Do not silently add it.

**Usability risk:** an expert thinks they have allowed one safe destination when they have actually allowed none—or, worse, a UI automatically enables broader forwarding without making that transition obvious.

**`command` and PTY.** These are not conflicting options. OpenSSH says the forced command runs on a PTY if the client requests one and PTY allocation is permitted. It even documents `restrict,pty,command="nethack"` as a valid example. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd))

Do not automatically add `no-pty` to every forced command. Instead explain the resulting combination.

More importantly, a forced command is **not a forwarding sandbox**: OpenSSH explicitly warns that TCP and X11 forwarding remain possible unless separately prohibited. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd))

**Usability risk:** wording like “This key can only run `/usr/bin/backup`” overstates the restriction if forwarding remains available.

**`principals` and `cert-authority`.** The man page defines `principals` in the context of a `cert-authority` line. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd)) Current OpenSSH also performs a consistency check and refuses authentication when principals are attached to a non-CA key. ([GitHub](https://github.com/openssh/openssh-portable/blob/master/auth2-pubkeyfile.c?utm_source=chatgpt.com)) In the structured form, make `principals` dependent on CA mode rather than permitting a configuration likely to deny authentication.

**FIDO options.** `no-touch-required` and `verify-required` only make sense for the FIDO `sk-*` algorithms. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd)) Disable or annotate them for other parsed key types, but do not delete them from imported raw content.

**`environment`.** OpenSSH processes it only according to `PermitUserEnvironment`; the server default is no, and the `sshd_config` manual warns that environment processing can bypass restrictions in some configurations, for example through `LD_PRELOAD`. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd))

**`tunnel`.** Its usefulness also depends on `PermitTunnel` and access to the selected TUN device. ([man7.org](https://man7.org/linux/man-pages/man5/sshd_config.5.html))

**`permitlisten`.** `GatewayPorts` may further restrict remote-listen addresses. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd))

These are cases where the UI should say **“server policy may further restrict this”**, not synthesize an “effective yes” from the line alone.

## Unknown options and malformed lines

This is where many GUI editors become dangerous.

Use three states for existing lines:

**Structured** — every component is understood and can be round-tripped losslessly.

**Preserved raw** — it resembles a valid key entry but contains an option/key type/syntax your panel version does not understand. Show the literal line and something like: “This entry contains syntax this panel does not understand. It will be preserved exactly.”

**Malformed/unparseable** — show the literal line, file and line number and say: “This panel cannot parse this line. It has not been modified.”

For the latter two, disable destructive structured editing. Allow **Delete line** and **Edit raw line**, and allow conversion to structured form only after a successful parse.

Current OpenSSH treats an invalid key option string/bad key options as a nonmatching unusable candidate and continues processing the `authorized_keys` file rather than treating that bad line as authorization. ([GitHub](https://github.com/openssh/openssh-portable/blob/master/auth2-pubkeyfile.c?utm_source=chatgpt.com)) But the panel should not say “OpenSSH ignores this” merely because *its own* parser failed; the installed server may understand syntax newer than the control panel.

That distinction is especially important as OpenSSH evolves—the current manual, for example, includes the newer `ssh-mldsa44-ed25519` key type. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd))

**Usability risk:** parsing an unfamiliar line and then rewriting only the fields the UI knows can silently drop restrictions. Preservation should win over normalization.

For understood lines, I would also preserve the original line unchanged until the user actually changes a structured control. Once changed, generate a canonical line and show the before/after diff.

## `expiry-time`: make timezone semantics explicit

OpenSSH accepts:

`YYYYMMDD[Z]`

or

`YYYYMMDDHHMM[SS][Z]`.

Without `Z`, it uses the **server's system timezone**; with `Z`, it uses UTC. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd))

For newly created entries, I recommend a normal date/time picker plus timezone, but serialize a full **UTC `Z` value**, for example:

`14 Sep 2026, 22:30 UTC`  
`expiry-time="20260914223000Z"`

Show both representations.

For imported entries without `Z`, do not silently convert them unless the user edits the value. Display:

“15 Sep 2026 00:00 — server timezone (Europe/Dublin)”  
`expiry-time="20260915000000"`

assuming you actually know the server timezone.

Date-only values deserve extra care. OpenSSH's documented time examples use a `YYYYMMDD` endpoint as **midnight at the beginning of that date**, not “through the end of that day.” ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.7/ssh-keygen.1?utm_source=chatgpt.com)) So don't present `expiry-time="20260915"` merely as “Expires Sep 15”; say “Expires at 00:00 at the start of Sep 15.”

**Usability risk:** conventional date pickers make users expect end-of-day expiration, while no-`Z` values can shift meaning after server timezone changes or when customers mentally interpret the value in their own timezone.

## Explain capabilities without claiming more security than OpenSSH provides

I would label the summary **“What this authorized-key entry does”**, not “Permissions” or “Security.”

For a plain entry, an honest summary would be:

> Authorizes this public key to authenticate as `deploy`.  
> This entry itself does not restrict commands, PTY allocation, forwarding, X11 forwarding, agent forwarding, or `~/.ssh/rc`. Server SSH configuration and account policy may impose additional restrictions.

For a constrained entry:

> Authorizes this key as `backup`.  
> Forces `/usr/local/bin/backup`.  
> PTY: blocked by this entry.  
> Agent forwarding: blocked by this entry.  
> TCP forwarding: blocked by this entry.  
> X11 forwarding: blocked by this entry.  
> User SSH RC: blocked by this entry.  
> Valid until 14 Sep 2026, 22:30 UTC.

Use **“blocked by this entry”**, **“not blocked by this entry”**, and **“limited by this entry to…”** rather than absolute **Allowed/Denied** whenever you haven't evaluated the effective `sshd_config`.

There is another reason not to overstate the protection: OpenSSH's `sshd_config` documentation explicitly notes that disabling TCP forwarding does **not** improve security when the user still has shell access, because the user can run their own forwarders. ([man7.org](https://man7.org/linux/man-pages/man5/sshd_config.5.html)) Restrictions on SSH protocol features are not equivalent to sandboxing the Unix account.

If your panel can query the target server, it can add a **second**, clearly separate layer:

**Per-key rules** — exactly what this line says.  
**Current server policy** — what the present `sshd_config` additionally permits or denies.

Do not merge those into a single supposedly timeless “effective permissions” result: configuration, source address, certificates and account state can change.

## The design I would ship

The governing rule would be:

**Simple mode creates a normal native OpenSSH entry; advanced mode edits native OpenSSH semantics; the summary never hides native options; raw data is never discarded merely because the UI does not understand it.**

The most important safeguards are that the panel never silently adds `restrict`, never silently removes existing options, never calls a forced command a sandbox, never describes a per-key positive option as overriding `sshd_config`, and never rewrites unknown or malformed lines through a lossy structured representation.

That gives beginners roughly the CloudStick-style experience—**account, public key, human identifier**—while experts still get all 22 currently documented option types and the exact serialized `authorized_keys` line.
