# Recommend Enrollment Flow

Source: https://chatgpt.com/share/6aa758c8-57f8-83eb-a9d4-2c2bb3a0791b

---

**User**

Design the smallest practical browser-to-local-agent enrollment handoff for a VPS product. The user is authenticated on our website. Their desktop coding agent can execute local commands on Windows, macOS, or Linux. We want a short-lived, single-use enrollment token consumed by a local process without putting its value in the prompt, model-visible tool output, command arguments, or logs. The process generates and retains an ordinary SSH private key locally and submits the public key.

Evaluate a downloaded enrollment file first, but challenge it against simpler alternatives. Do not assume a preinstalled application, browser extension, fixed Downloads path, or that avoiding model-visible secrets requires a second authorization step. We are not trying to isolate secrets from an agent with filesystem access.

Ground browser behavior, file handling, OpenSSH availability, helper distribution, interrupted enrollment, duplicate execution, and cleanup in primary documentation. Distinguish demonstrated behavior from assumptions. Recommend one complete flow, identify unavoidable user interactions, and provide small cross-platform experiments to verify the uncertain parts. Avoid designing a general agent integration framework.

---

**ChatGPT**

I’m going to compare the downloaded-file handoff against localhost, custom-scheme/native-host, and device-style approaches, then pin the recommendation to documented browser/OS behavior. I’ll also separate what can be demonstrated from what still needs a small experiment on your supported agent runtimes.

---

**ChatGPT**

One concrete simplification is emerging: make the enrollment file **data, not an executable helper**, and make it directly consumable as a `curl --config` file. Then the agent’s visible command contains only the file path and public-key path; the bearer token stays in the file and curl reads it internally. I’m checking whether that survives Windows/macOS/Linux availability and retry semantics before recommending it.

---

**ChatGPT**

A better variant than “the file is a curl config” is to make the file contain **only one HTTP header**: `Authorization: Bearer …`. curl has supported `-H @file` since 7.55.0, and its own documentation explicitly recommends retrieving sensitive data from a file rather than putting it in a command line. That sharply reduces what the downloaded file can instruct curl to do.

---

**ChatGPT**

## Recommendation

Use a **downloaded, inert enrollment file whose contents are exactly one HTTP authorization header**, and have the local agent invoke the platform's existing `ssh-keygen` plus `curl`, passing only filenames on the command line.

The file should contain:

```text
Authorization: Bearer <opaque-short-lived-token>
```

Not JSON, not a shell script, not a helper executable, and preferably not a full curl config file.

This is the smallest design I would ship. It requires no installed app, extension, protocol handler, localhost daemon, fixed download directory, clipboard integration, or second browser authorization. It also gives you a straightforward way to keep the bearer value out of prompts, argv/process listings, normal command output, and normal shell tracing: curl itself reads the header file. curl explicitly supports `-H @filename`, and its documentation recommends retrieving sensitive values from files rather than putting them on the command line. ([cURL](https://curl.se/docs/manpage.html))

### Browser → disk

The authenticated web page has a **Download enrollment file** button that performs a CSRF-protected `POST` to something like:

```text
POST /vps/{vps-id}/enrollment
```

The server creates a cryptographically random opaque token, stores only an appropriate server-side representation/hash, and binds it to the authenticated account, the selected VPS, and exactly one operation: register one SSH public key. Something around a 10-minute lifetime is reasonable; the exact TTL is a product decision.

Return the token directly as the response body rather than putting it into page JavaScript:

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="acme-vps-enrollment.enroll"
Cache-Control: no-store
X-Content-Type-Options: nosniff

Authorization: Bearer vpsenr_<random>
```

`Content-Disposition: attachment` is specifically defined to cause local saving rather than normal processing, with `filename` only advisory. ([RFC Editor](https://www.rfc-editor.org/info/rfc6266/)) `Cache-Control: no-store` should also be set; it reduces intermediary/browser cache retention, though it is not a promise of forensic erasure.

Do **not** put the token in the download URL, filename, fragment, query parameter, or redirect target. RFC 6750 specifically calls out the high likelihood of access tokens in URLs being logged and recommends the Authorization header instead. ([RFC Editor](https://www.rfc-editor.org/info/rfc6750/))

Do not assume `~/Downloads`. Chrome, for example, explicitly lets users change the default download directory or enable “Ask where to save each file”; it also exposes “Show in Folder.” That is enough to rule out a fixed Downloads-path design. ([Google Help](https://support.google.com/chrome/answer/95759?hl=en-u))

One browser detail I would classify as **needs demonstration, not assumption**: whether your exact authenticated-POST implementation gives the desired UX without changing the page in every browser/version you support. `Content-Disposition` specifies disposition semantics, but not every detail of contemporary browser UI. Test the actual button flow.

### Disk → local agent

The user gives the coding agent **the pathname**, not the file contents:

> Use `/Users/david/Downloads/acme-vps-enrollment.enroll` to enroll this machine. Do not display or read its contents into the conversation.

The pathname can safely appear in the prompt/tool transcript. Do not tell users to paste the token, and do not attach the file to an agent chat unless you have demonstrated that such attachments remain filesystem references rather than becoming model-visible content.

The local procedure first probes dependencies **without touching the token**. On Windows explicitly invoke `curl.exe`, not `curl`, because PowerShell historically has had a conflicting alias; the curl project documents this distinction. Current Windows 10/11 installations include Microsoft's curl build. ([cURL](https://curl.se/windows/microsoft.html))

Do not make the same assumption about OpenSSH. Microsoft documents OpenSSH as a feature-on-demand on Windows 10 1809+ and explicitly identifies `ssh-keygen` as one of its components. That alone means probing is necessary. ([Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_overview)) On macOS and Linux I would also probe rather than encode OS-version/package assumptions into the protocol.

If either required binary is unavailable, don't consume the enrollment. Tell the user what is missing. The downloaded token may expire while they install it, in which case they simply download another enrollment file.

### SSH key

For the smallest and most retry-safe design, use **one product-specific local machine key**, for example:

```text
~/.ssh/acme_vps_ed25519
~/.ssh/acme_vps_ed25519.pub
```

If the private key exists, reuse it. If it doesn't, generate it once. This makes duplicate enrollment executions naturally submit the same public key instead of generating orphan keys.

OpenSSH documents Ed25519 generation, `-f` for the output file, `-N` for the passphrase, and the normal behavior of storing the public key beside the private key with `.pub` appended. ([OpenBSD Manual Pages](https://man.openbsd.org/OpenBSD-7.8/ssh-keygen.1))

Conceptually:

```text
ssh-keygen -q -t ed25519 -N <empty> -C acme-vps-agent -f <key-path>
```

I would use a fixed comment such as `acme-vps-agent`, rather than OpenSSH's/default environment-derived information, so you aren't unnecessarily sending a local username or hostname to your control plane.

For a fully noninteractive coding agent, an empty passphrase is the simplest behavior. If your security policy requires encrypted private keys, that is an additional user/key-agent interaction and should be treated as a separate product requirement rather than smuggled into enrollment.

The exact representation of the empty `-N` argument on Windows PowerShell is one item I would verify experimentally under the precise PowerShell versions/harnesses you support instead of asserting that POSIX quoting transfers unchanged.

### Token consumption

The local command should be approximately:

```sh
curl -q -sS -f \
  -H "@<enrollment-file>" \
  -H "Content-Type: text/plain" \
  --data-binary "@<public-key-file>" \
  https://api.example.com/v1/enrollment/consume
```

On PowerShell use `curl.exe`; the underlying curl options can otherwise be the same.

There are several deliberate details here. `-H @file` causes curl itself to read headers from the file, so the bearer value never becomes argv. `--data-binary @file` similarly reads the public key from disk. ([cURL](https://curl.se/docs/manpage.html))

Put `-q` **first**. curl normally reads the user's curl configuration; its manual says that `-q` as the first argument disables that behavior. This matters because a user's `.curlrc` could otherwise enable verbose/trace output or alter the request. ([cURL](https://curl.se/docs/manpage.html))

Do not use `-v`, tracing, shell command substitution, an environment variable holding the bearer token, or a shell variable populated by reading the file. Do not follow redirects. curl itself warns that custom headers and redirects need special care; your consumption URL should therefore be a fixed HTTPS endpoint that never redirects. ([cURL](https://curl.se/docs/manpage.html))

A successful endpoint can return `204 No Content`, which is particularly clean: nothing secret—or really anything—needs to return to model-visible tool output.

The server's Authorization-header redaction is still your responsibility. Reverse proxies, APM agents, debug middleware, request dumpers, and application logs must not record it. That is an **implementation assumption until verified in your deployment**, not something the curl design can guarantee.

## Why a header file, rather than the obvious alternatives?

| Handoff | Extra installed component? | Additional user authorization? | Main problem | Verdict |
|---|---:|---:|---|---|
| **Downloaded one-header file** | No | No | User has to identify the downloaded pathname | **Recommend** |
| Full downloaded curl config | No | No | File is much more expressive than necessary; can alter URL/options/file reads | Works, but unnecessarily powerful |
| Clipboard bearer token | No | No | Shared clipboard persistence; reliable programmatic clipboard access differs by OS/session/Linux desktop | Simpler-looking, less robust |
| Browser → localhost listener | Requires something locally listening | Often browser permission | Port/rendezvous/CORS/browser-local-network behavior | More machinery |
| Custom URI / browser extension / native messaging | Yes | Usually | Explicitly requires preinstallation/registration | Ruled out |
| OAuth-style device flow | No | **Yes** | Reverses the flow and adds code/approval/polling | Too much for this use case |
| Downloaded executable helper | No preinstall, but new executable | OS trust prompts possible | Distribution/signing/notarization/architecture | Worse than using existing tools |

The localhost idea deserves particular scrutiny because it initially appears even cleaner than a file: start `127.0.0.1:<random-port>` and let the authenticated page POST the token straight into it. But Chrome's Local Network Access model now explicitly covers requests from public sites to servers running on the user's own machine and requires site permission. That introduces another browser permission interaction, in addition to requiring you to solve local server startup, port discovery, origins/CORS, and cross-browser differences. ([Chrome for Developers](https://developer.chrome.com/blog/local-network-access)) It may be appropriate once you already ship a native client; it is not the smallest no-preinstall bootstrap.

A device flow is robust for a real installed CLI, but RFC 8628 deliberately consists of a device/user code, a verification URI, user interaction, and client polling; even its optimized flow retains confirmation behavior. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc8628.html)) Your authenticated browser has already made the authorization decision, so adding that ceremony merely to avoid model-visible secrets solves a problem the downloaded file already solves.

I would also avoid shipping a one-shot helper executable. Windows SmartScreen explicitly checks downloaded executables and unknown/new binaries can trigger reputation warnings; Apple Gatekeeper checks downloaded apps/installers and requests approval before initially running downloaded software. ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)) An inert `.enroll` data file plus existing command-line utilities sidesteps that distribution problem.

## Interrupted enrollment and “single use”

A literally single-presentation server—“the token is dead the instant I receive the first request, and all subsequent presentations fail”—has a distributed-systems problem.

Suppose your server successfully installs/records the public key, marks the token spent, and then the TCP connection dies before curl receives the response. The client cannot tell whether the enrollment happened. If a retry simply says “spent,” you've turned an ordinary lost response into a support incident.

So define **single use as single authorization effect**, not necessarily single packet presentation.

The consume transaction should atomically bind the token to the submitted public-key fingerprint and durable enrollment result. On first valid presentation, perform the one permitted state transition. On another presentation of the same token with the **same public key**, return the already-recorded result without performing another mutation. A different public key with that token gets a conflict/rejection. Parallel requests produce one mutation. Keep the consumed record long enough to cover retry ambiguity.

This is exactly the reason idempotent request semantics matter: RFC 9110 explains that requests designed to have the same intended effect when repeated can safely recover from communication failures, and even notes that a POST can be retried when the application knows its semantics are idempotent. ([RFC Editor](https://www.rfc-editor.org/info/rfc9110/?utm_source=chatgpt.com))

If VPS-side propagation is asynchronous, the token transaction should durably record **desired authorized-key state** in your control plane before returning. Don't consume the token and then make success depend on an ephemeral SSH/provisioning call. A retry can then report `pending` or the stable result.

Cleanup follows directly from those semantics. After a confirmed success, delete the `.enroll` file and retain the SSH key pair. After a transport error or retryable 5xx, retain both and retry with the same key. After a definitive expired/revoked-token response, delete the enrollment file and obtain a new one; the ordinary SSH key can remain for the next attempt.

There is no need for a cross-platform “secure shred” mechanism here: by the time ordinary deletion occurs after success, the credential's authorization effect has already been spent, and its original lifetime was short. Don't claim stronger erasure guarantees than the filesystem/storage stack provides.

## What is demonstrated versus assumed?

| Property | Status |
|---|---|
| Browser download destination cannot be assumed | **Demonstrated.** Chrome explicitly supports custom destinations and per-download “ask where to save.” ([Google Help](https://support.google.com/chrome/answer/95759?hl=en-u)) |
| `Content-Disposition: attachment` means save locally | **Standards-defined.** RFC 6266. ([RFC Editor](https://www.rfc-editor.org/info/rfc6266/)) |
| curl can read an HTTP header from a file | **Demonstrated.** `-H @filename`. ([cURL](https://curl.se/docs/manpage.html)) |
| Secret need not be argv | **Demonstrated at curl interface level.** curl itself recommends file-based retrieval for sensitive data. ([cURL](https://curl.se/docs/manpage.html)) |
| User curl configuration can be disabled | **Demonstrated.** `-q` first skips curlrc. ([cURL](https://curl.se/docs/manpage.html)) |
| Windows has `curl.exe` | **Documented for Windows 10/11 by curl.** ([cURL](https://curl.se/windows/microsoft.html)) |
| `ssh-keygen` can be assumed on Windows | **False.** Microsoft's documented OpenSSH install state requires probing. ([Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_overview)) |
| The coding-agent harness will not surface bytes read by a child process | **Runtime-specific assumption. Must test.** |
| Your proxies/APM never log Authorization | **Deployment-specific assumption. Must test.** |
| Direct authenticated POST → attachment has exactly the desired UX in every supported browser | **Needs browser experiment.** |
| Exact Windows empty-passphrase `ssh-keygen` quoting works in every shell/harness | **Needs Windows experiment.** |

That distinction is important: the OS and curl can keep the token out of argv and output, but only your actual coding-agent runtime can establish that a child process reading a file does not get its input copied into model-visible tool telemetry.

## Unavoidable user interactions

In the normal successful case I think there are only **two** fundamental interactions: the user clicks **Download enrollment file**, and the user tells the local agent where that file was saved. A browser configured to ask for every download adds its own save-location selection; that is browser policy, not part of your authorization protocol. Chrome explicitly documents both automatic default-location saving and the ask-each-time mode. ([Google Help](https://support.google.com/chrome/answer/95759?hl=en-u))

There is no security requirement for a second “Approve this agent” browser step here. The authenticated download action can itself authorize creation of the narrowly scoped bearer token. Avoiding model visibility does not imply a device-code ceremony.

## Experiments I would run before freezing the design

1. **Browser handoff matrix.** Put a sentinel—not a real credential—in a staging attachment returned by the exact authenticated `POST`. Test current Chrome/Edge, Firefox, and Safari with both normal download settings and “ask where to save.” Record whether the page remains usable, whether a save dialog appears, how duplicate filenames are handled, and whether your custom `.enroll`/octet-stream file is ever automatically opened. The expected invariant is only “a local file exists and its path may be arbitrary.”

2. **Agent secret-visibility test.** Put `Authorization: Bearer SENTINEL_UNIQUE_123...` in a file, then have every supported coding-agent runtime execute the real curl shape against a staging endpoint. While curl is blocked for several seconds, inspect its process command line (`ps` on macOS/Linux; `Get-CimInstance Win32_Process` on Windows), then search the agent transcript/tool logs and your normal shell logs for the sentinel. It should exist only in the source file and the staging server's deliberately instrumented receive path. Also put `verbose` in a temporary `.curlrc` and verify that putting `-q` first suppresses it.

3. **Tool availability and quoting.** On the Windows images, macOS versions, and representative Linux distros you actually support, probe `ssh-keygen` and `curl`; record curl versions and verify `-H @file`. Test the exact no-passphrase `ssh-keygen` invocation under Windows PowerShell, PowerShell 7, and whatever shell abstraction the agent uses. Treat this test matrix—not an OS-family assumption—as the compatibility contract.

4. **Lost-response/idempotency test.** Instrument staging so the server commits the public key and deliberately closes the connection before returning its response. Rerun the exact same request: it must report the existing success without adding another key. Fire two copies concurrently: one state transition only. Then reuse the same token with a different public key: it must fail. Finally, verify that success deletes only the enrollment file, while an ambiguous network failure preserves the file and the existing SSH key for retry.

### Bottom line

The downloaded file survives the challenge against the “simpler” alternatives because it exploits something all three desktop OSes and all browsers already know how to do: **save opaque bytes to a user-selected filesystem location**. The local side then exploits a narrowly constrained curl feature specifically intended to read headers from a file.

I would ship **one-line header file → existing `ssh-keygen` → `curl -q -H @file --data-binary @pubkey` → atomic same-key-idempotent consume → delete enrollment file on confirmed success**.

The only bespoke protocol is one download endpoint and one consume endpoint. Everything else—native helper distribution, localhost rendezvous, browser extension machinery, device authorization, general agent integration—can stay out of v1.
