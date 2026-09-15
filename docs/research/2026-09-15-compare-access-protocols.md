# Compare Access Protocols

Source: https://chatgpt.com/share/6aa8b136-f93c-83eb-88df-f98d8a7408fc

---

**User**

Context: A customer of a VPS control panel wants an AI coding agent, running on their own computer, to connect to their server over SSH. The customer is signed in to the panel and copies a prepared prompt into the agent. The agent has a terminal and can generate its own key pair. The panel wants the flow to need no further human action, while the customer keeps a clear way to see and revoke what the agent obtained.

Question: What protocols exist for granting a program access on a person's behalf with no interactive approval step, and what are their real security properties?

Compare at least: a short-lived single-use bearer token carried in the prompt; a device or code flow where the program shows a code and the person approves in a browser; the program submitting its own public key for later approval; a downloaded credential file; a local helper the person installs; and any protocol used by current developer tooling for the same purpose. For each: what an attacker who reads the prompt obtains, what an attacker who intercepts the network obtains, what the person must do, and what a log or an AI provider retains.

Also cover how a prompt can carry a secret so that a cooperating program does not print it and does not send it to a model, and whether such conventions can be relied on.

Evidence rules: cite specifications, product documentation, and source with dates. Distinguish what a protocol guarantees from what it merely encourages. Give the failure case for each option, including where the person is careless.

---

**ChatGPT**

I’ll separate “zero-click after paste” mechanisms from flows that deliberately require a second approval, then compare their attacker model and audit/revocation properties. I’ll ground the protocol claims in RFCs and current tooling docs/source, and call out where a property is convention rather than enforcement.

---

**ChatGPT**

One key boundary is already clear: a device/code flow cannot satisfy “no further human action” by design—the browser approval is the security boundary. To get true zero-click after paste, the system must either transfer a capability in the prompt or rely on trust/credentials established earlier on that computer.

---

**ChatGPT**

The other important distinction is bearer vs proof-of-possession. A short TTL or “single use” changes *how long* a stolen bearer works; it does not change *who may use it*. DPoP/mTLS and SSH public-key auth add a cryptographic key-possession check, but they only help if the private key is not stolen alongside the token.

---

**ChatGPT**

There is no protocol that simultaneously gives an arbitrary, previously untrusted program fresh authority “as the user,” requires no post-paste user interaction, and reveals no transferable authority to either the program or something already trusted on the machine. The authorization has to come from somewhere.

For the VPS-panel case, that leaves two fundamentally different zero-click designs: put a narrowly scoped capability in what is pasted, or rely on a credential/broker that was established on the computer beforehand. Everything else—device codes, browser OAuth, approving a public key—is deliberately interactive.

A useful baseline: with correctly authenticated TLS, an ordinary network attacker should learn traffic metadata but not HTTP plaintext; TLS 1.3 specifies confidentiality and integrity even against an attacker controlling the network. A TLS-terminating proxy, compromised endpoint, or application logger is different: it sees plaintext. ([RFC Editor](https://www.rfc-editor.org/info/rfc8446/?utm_source=chatgpt.com))

## Comparison

| Mechanism | Attacker who reads the prompt | Network interceptor | What the person must do | What tends to be retained | Principal failure case |
|---|---|---|---|---|---|
| **Short-lived, single-use bearer bootstrap token in prompt** | Gets a real capability. Until it expires or is consumed, the attacker can race the legitimate agent. “Single use” does not identify the rightful user. | With proper HTTPS, no token. At TLS endpoints/proxies, token is visible. Putting it in a URL is particularly bad because URLs are commonly logged. | Nothing after paste. | Prompt/chat/clipboard may contain the token; panel should log only a token ID/hash, not value. If the prompt goes to an AI provider, the provider receives the token. | Prompt copied to the wrong agent, chat, support ticket, telemetry system, or attacker; thief wins redemption race. |
| **OAuth Device Authorization Grant** | Normally gets no credential from the prepared prompt. If attacker sees the displayed `user_code`, that code is distinct from the high-entropy `device_code` the client polls with. | TLS protects both legs. An endpoint compromise can obtain device authorization state. | Visit verification URL, authenticate, verify code/context, approve. | Agent/model logs can contain the user code and URL, but not necessarily the eventual token. Auth server records the authorization. | User approves an authorization initiated by an attacker—remote device-flow phishing. |
| **Agent generates public/private key; submits public key; user later approves it** | Public key is intentionally non-secret. Prompt reader gets no SSH authority. | HTTPS protects substitution; SSH subsequently authenticates by proving possession of the private key. | Review request/fingerprint and approve it. | Public key/fingerprint and request metadata are safe to retain. Private key should remain local and never appear in logs/model context. | User blindly approves the attacker's substituted/separate key, or private key is later stolen. |
| **Downloaded credential file** | If prompt contains only a pathname, prompt reader does not automatically get the credential. If file contents are pasted, it collapses to bearer/file-key semantics. | Download over HTTPS is protected from network-only attacker. | Download/save the file and make it available to the program—unless that was done before the paste. | Credential remains on disk, possibly Downloads/backups. Provider sees it if the agent reads/prints it into model context. | File is copied, synced, backed up, uploaded, left world-readable, or `cat`ed into an AI transcript. |
| **Installed local helper / credential broker / `ssh-agent`-style design** | Prompt contains an opaque request or handle, not the user's panel credential. | HTTPS to panel remains protected; local IPC becomes the key boundary. | One-time installation/login beforehand; ideally nothing on each subsequent grant. | Helper/keychain retains long-lived credential; model sees only operations/results if isolation is correctly implemented. | Malware or another same-user process can invoke an unattended helper; an overpowered helper becomes a signing/authorization oracle. |
| **Browser OAuth Authorization Code + PKCE** | Prompt reader gets at most public authorization information. The locally held PKCE verifier prevents an intercepted authorization code from being redeemed by another client. | TLS plus PKCE protects against authorization-code interception. | Browser authentication/consent. | Browser/auth-server/CLI keep OAuth state/tokens; model need not receive them. | User approves a malicious app/site; compromised client can still misuse credentials after authorization. |
| **OAuth Token Exchange / pre-existing delegated credential** | Prompt need contain no new secret if the machine already possesses a suitable subject credential. | HTTPS. | No new approval can be necessary—but only because consent/trust happened earlier. | Existing credential plus resulting delegated token live in the trusted component. | Theft of the original subject credential or overly broad token-exchange policy. |

### 1. Bearer bootstrap token

RFC 6750, October 2012, defines the crucial property: *any party possessing a bearer token can use it*; there is no cryptographic proof that the caller is the party to whom it was intended. It also requires TLS and warns against tokens in URI query parameters because URLs are likely to be logged. ([RFC Editor](https://www.rfc-editor.org/info/rfc6750/?utm_source=chatgpt.com))

So a panel could mint something like:

`grant = random-256-bit-value; expires=120s; operation=register-one-agent-key; server=123`

The agent generates an SSH key locally and atomically redeems the grant with its public key. That can be quite safe operationally if the scope is extremely narrow, but the exact guarantee is:

**anyone who has the prompt during those 120 seconds may perform that one registration.**

Single-use helps after the legitimate redemption and reduces the attack window. It does not protect against a thief who gets there first. Even supposedly single-use authorization artifacts require careful atomic enforcement; RFC 9449 discusses practical replay windows when distributed authorization systems do not enforce one-time consumption strictly. ([RFC Editor](https://www.rfc-editor.org/info/rfc9449/?utm_source=chatgpt.com))

The token should therefore authorize **only creation of a particular derived credential**, never act as SSH credentials itself and never expose general panel APIs. It should be invalid after redemption and have a very short lifetime.

There is also an important revocation subtlety: revoking the bootstrap grant after it was used does not revoke whatever it created. GitHub's credential documentation provides a concrete analogue: revoking a fine-grained token does not necessarily invalidate SSH keys previously created through it. ([GitHub Docs](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/github-credential-types?utm_source=chatgpt.com)) Your panel must explicitly model the derived SSH credential and revoke that credential.

### 2. Device/code flow

OAuth Device Authorization Grant is RFC 8628, August 2019. The client obtains a private-ish `device_code`, a human-readable `user_code`, and a verification URL. The person authenticates separately and approves or declines; the client polls until authorization completes. The codes are explicitly limited in lifetime. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8628.html?utm_source=chatgpt.com))

This gives an important security property absent from prompt bearer tokens: merely compromising the program's initial request does not grant the attacker's account access. The authorization server gets an independent authenticated interaction with the person.

But the approval step is not incidental; it is the point of the protocol. RFC 8628 explicitly identifies **remote phishing**: an attacker can initiate their own device authorization and trick the victim into entering/approving the attacker's code. The mitigation is partly human—tell the user what device/client they are approving and provide enough context to notice a mismatch. Those mitigations are `RECOMMENDED`/`SHOULD`, not a cryptographic guarantee that a careless person cannot approve the wrong request. ([RFC Editor](https://www.rfc-editor.org/info/rfc8628/?utm_source=chatgpt.com))

Therefore device flow is excellent if the panel will tolerate one browser approval, but it fails the stated zero-further-action requirement.

### 3. Public key first, approval later

This is particularly clean cryptographically.

The agent creates a key pair, keeps the private key locally, and submits only the public key. Reading the prompt or the request does not let an attacker authenticate. SSH public-key authentication requires the server to decide that the key is acceptable and then verify a signature from the corresponding private key; RFC 4252, January 2006, makes those checks mandatory. ([RFC Editor](https://www.rfc-editor.org/info/rfc4252/?utm_source=chatgpt.com))

After approval, the panel can either put the key into `authorized_keys` or, better for managed infrastructure, sign the agent's key with an OpenSSH user CA. OpenSSH certificates can have explicit validity intervals, and KRLs can revoke certificate serials/key IDs. Raw authorized keys can also carry an `expiry-time` and restrictions such as disabling forwarding. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.7/ssh-keygen.1?utm_source=chatgpt.com))

The weakness is not disclosure; it is **approval correctness**. If Alice has three pending requests and approves Mallory's key because she does not check the fingerprint/device label, the protocol correctly grants Mallory access. The protocol guarantees proof of possession of *the approved key*, not that the human approved the intended program.

It also necessarily requires that approval.

### 4. Credential file

A credential file is more of a transport/container than a protocol. Its security is exactly the security of what is inside it.

A downloaded file containing a bearer token is a bearer token with better separation from the chat prompt. A file containing a private key and certificate is a proof-of-possession credential, but stealing the file generally steals both the token/key and the ability to prove possession. A file containing only an opaque bootstrap handle can be much weaker in authority.

The benefit is primarily **channel separation**: the credential does not have to appear in natural-language context. The costs are file lifecycle and discoverability. Downloads directories, backup software, cloud sync, malware and overly broad permissions all become relevant. If a coding agent executes `cat ~/Downloads/panel-credential.json`, the separation disappears because terminal output is likely to become model input.

So "download a file instead of putting a token in the prompt" can reduce accidental model disclosure, but is not intrinsically stronger cryptography.

### 5. Local helper

This is the strongest way to get **both zero-click per use and no transferable secret in the prompt**, provided you can accept a one-time setup beforehand.

The customer installs `panel-agent-helper`, authenticates it once, and the helper keeps its refresh/session credential in the OS credential store. The coding agent then asks something like:

`panel-helper grant-ssh --server 123 --public-key ~/.ssh/agent.pub`

The helper performs the authenticated API operation without ever releasing its panel credential to the coding agent.

`ssh-agent` demonstrates this general pattern. Its documentation says private keys and passphrases do not traverse the network: requesters get signing operations instead. But its Unix socket is accessible to the current user and is explicitly described as readily abusable by root or another process running as that user. ([man7.org](https://man7.org/linux/man-pages/man1/ssh-agent.1.html?utm_source=chatgpt.com))

That is the real property of a zero-confirmation helper: **credential non-extractability does not imply authorization isolation**. If any process running as David can ask the helper to create a VPS grant, malware running as David may be able to do the same.

The remedy is to make the helper a very narrow capability broker. It should expose "register this public key for this server under this user" rather than "give me the panel OAuth token". It can enforce maximum TTLs, server scope and permitted operations locally. Stronger OS identity/sandboxing can further limit callers.

### 6. What current developer tools actually do

Current tools overwhelmingly choose interactive browser authorization or an explicitly supplied credential rather than hiding a user credential inside prose.

GitHub CLI's current `gh auth login` documentation says its default is a web/browser flow; afterward it stores the token in the system credential store, falling back to a plaintext file if secure storage is unavailable. For explicit token injection, `--with-token` reads the token from **standard input**, not a natural-language prompt. ([GitHub CLI](https://cli.github.com/manual/gh_auth_login?utm_source=chatgpt.com))

AWS CLI changed its SSO default in v2.22.0 on **November 18, 2024** to OAuth Authorization Code + PKCE; device authorization remains available with `--use-device-code`. ([Amazon Web Services, Inc.](https://aws.amazon.com/about-aws/whats-new/2024/11/aws-command-line-interface-pkce-single-sign-on/?utm_source=chatgpt.com)) This follows the native-app OAuth best practice: RFC 8252, October 2017, requires public native clients to use PKCE and an external user-agent. PKCE itself, RFC 7636 from September 2015, makes a stolen authorization code useless without the client's locally generated verifier. ([RFC Editor](https://www.rfc-editor.org/info/rfc8252/?utm_source=chatgpt.com))

Current OpenAI Codex source likewise exposes browser login, device-code login, and explicit API/access-token input. The CLI deliberately reads API/access tokens from stdin; its current device-code implementation displays a one-time code, warns the user to continue only if they initiated the login, and imposes a 15-minute timeout. ([GitHub](https://github.com/openai/codex/blob/main/codex-rs/cli/src/main.rs?utm_source=chatgpt.com))

That is a useful industry signal: **stdin/keychain/browser OAuth are treated as credential channels; the LLM prompt is not.**

OAuth Token Exchange, RFC 8693 from January 2020, is also relevant where a trusted local component already has a credential. It can exchange a `subject_token` representing the person for a narrower delegated token without doing another consent ceremony. But it merely delegates existing trust; it does not solve first-time authorization. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8693.html?utm_source=chatgpt.com))

The historical alternative—giving the application the person's username/password so it can authenticate noninteractively—is now explicitly prohibited by OAuth Security BCP RFC 9700, January 2025: the Resource Owner Password Credentials grant **MUST NOT** be used. ([RFC Editor](https://www.rfc-editor.org/info/rfc9700/?utm_source=chatgpt.com))

## Sender-constraining the bootstrap token

One can improve on a pure bearer token using DPoP or mTLS.

DPoP, RFC 9449 from September 2023, binds OAuth tokens to a client's public key. A stolen access token alone cannot be used without signatures from the corresponding private key. Mutual-TLS certificate-bound tokens provide a similar property at the TLS layer. ([RFC Editor](https://www.rfc-editor.org/info/rfc9449/?utm_source=chatgpt.com))

This does **not**, by itself, eliminate the vulnerable initial handoff in your proposed UX. If the panel generates a secret prompt before it knows the agent's newly generated public key, an attacker stealing that bootstrap can potentially redeem it while binding the resulting credential to the attacker's own key.

To get an end-to-end key-bound grant, the panel first needs the agent's key/commitment, or an already trusted local component has to attest/bind that key. That brings you back to either a second round/approval or a local helper.

RFC 9700 also explicitly cautions that sender-constrained tokens stop helping when the attacker obtains both token and corresponding key material. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc9700.html?utm_source=chatgpt.com))

## Can a prompt contain a secret without sending it to the model?

Yes, but **only with client-side enforcement outside the LLM**.

Suppose the pasted material contains:

`<local-secret id="vps-bootstrap">abc123...</local-secret>`

A cooperating agent application can parse the pasted text **before constructing the model request**, remove the value, put it into a local secret store, and send the model only something like:

`A secret named vps-bootstrap is locally available.`

The model can then request a local operation such as `redeem_vps_grant(secret_handle, public_key)`. The trusted tool runner substitutes the real token directly into an HTTPS `Authorization` header or stdin. The model never receives the bytes. Exact-value redaction can additionally keep accidental tool output out of transcripts.

That can be a real security boundary if implemented in code.

A statement *inside the prompt* such as "the following token is secret; never repeat it and don't send it to the model" has **no such property**. If the model can read that instruction, the token has already been sent to the model. Base64, XML tags, Markdown comments, `SECRET=` prefixes and "don't log this" prose do not change that fact.

Likewise, post-hoc output redaction is defense in depth, not a reliable confidentiality mechanism. A malicious/compromised program could print the secret one byte at a time, encode it, hash portions of it, write it to a file, or make arbitrary network calls. The guarantee must come from the component that controls model input and tool execution.

The safest version therefore gives the model **a non-exportable capability handle**, not a hidden string it can retrieve.

## AI-provider and logging consequences

If the literal bootstrap token is part of the LLM request, you must treat the AI provider as having received the credential, irrespective of whether the model obediently refrains from echoing it.

Retention varies by product. As one concrete example, current OpenAI API documentation says abuse-monitoring logs may contain prompts and responses and are retained for up to **30 days by default**, with approved Modified Abuse Monitoring/Zero Data Retention configurations altering that behavior. ([OpenAI Platform](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint?utm_source=chatgpt.com)) Anthropic's commercial-product policy dated **July 1, 2026** says Anthropic API inputs and outputs are normally deleted within 30 days, subject to stated exceptions and contractual/ZDR arrangements; consumer/chat coding-session retention differs. ([Anthropic Privacy Center](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data?utm_source=chatgpt.com))

So “the model won't print it” and “the provider won't retain it” are completely separate questions.

Application logs need similar discipline. RFC 6750's warning about tokens in query strings is directly applicable: use an authorization header or request body, redact that field before HTTP tracing, and log a grant identifier/hash rather than the credential value. ([RFC Editor](https://www.rfc-editor.org/info/rfc6750/?utm_source=chatgpt.com))

## What I would use for this VPS panel

For a first-time flow that **absolutely must be zero-click after paste**, I would use a deliberately constrained version of the bearer-bootstrap design, while describing it accurately to users rather than implying that it cryptographically identifies their agent:

1. The panel creates a cryptographically random, 1–5 minute, atomically single-use bootstrap capability. Its *only* permission is `create agent SSH credential for server X`, under a predetermined Unix account/role.
2. The coding-agent client locally strips that credential from model input and exposes it only through a dedicated local redemption tool. If an agent does not implement this facility, warn that the pasted secret will be disclosed to its AI provider.
3. The agent generates an Ed25519 key locally and redeems the bootstrap over authenticated HTTPS. The private key never leaves the computer.
4. Prefer issuing a short-lived OpenSSH user certificate to that key, or install a separately identified authorized key with an expiry. Do not make the bootstrap token itself an SSH password.
5. In the panel, show a first-class credential record: **AI agent / server / Unix user / public-key fingerprint / created / expires / last used / source / revoke**. Revocation acts on the *derived SSH credential*, not merely the spent bootstrap.
6. Make the SSH authority no broader than necessary—e.g. disable agent/X11/port forwarding if the coding use case does not need them. OpenSSH supports these key restrictions. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.5/sshd.8?utm_source=chatgpt.com))
7. For customers willing to install something once, offer the local-helper route instead. That removes reusable authority from future prompts entirely.

That architecture has an intelligible security statement: **“Whoever obtains the one-time prompt before redemption can race to create one narrowly scoped credential; after redemption or expiry the prompt is useless. The resulting SSH credential is separately visible, expiring, and revocable.”**

That is substantially stronger and more honest than claiming that “single-use” somehow makes a bearer token safe from a party that sees it.
