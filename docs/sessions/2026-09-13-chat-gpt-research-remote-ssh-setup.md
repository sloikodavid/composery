# Research remote SSH setup

Source: https://chatgpt.com/share/6aa70813-8060-83ed-b160-db73ecc708c0

---

## Turn 1: User

_2026-09-13T20:19:41.328Z_

Research the currently supported ways to configure remote SSH connections in OpenAI’s ChatGPT/Codex desktop apps and Claude Desktop/Claude Code. Our desired experience is: paste a prompt into a local agent, enroll a Linux VPS connection, then select it in the app’s remote-environment UI. Check Windows, macOS, and Linux separately. Identify documented configuration, CLI/API/deep-link support, unavoidable manual steps, remote runtime installation and authentication, and compatibility with administrator accounts. Distinguish SSH command execution from native remote-project integration. Use primary sources, dates, and exact product versions; label undocumented techniques.

---

## Turn 2: ChatGPT

_2026-09-13T20:19:42.675Z_

I’ll separate four things that are easy to conflate: native remote-project enrollment, ordinary SSH command execution, remote runtime/auth bootstrap, and automation surfaces (CLI/API/deep links). I’ll verify each on Windows, macOS, and Linux against current vendor docs/release notes, then flag any community-only or undocumented workarounds explicitly.

---

## Turn 3: ChatGPT

_2026-09-13T20:20:00.979Z_

OpenAI’s current docs already confirm the core flow you want exists natively: SSH aliases are auto-discovered from `~/.ssh/config`, the remote host must have an authenticated `codex` on its login-shell `PATH`, and the desktop app then exposes the host under **Settings → Connections → SSH** for remote projects. I’m now checking the platform/version boundaries and whether any supported non-GUI enrollment path exists.

---

## Turn 4: ChatGPT

_2026-09-13T20:21:09.672Z_

Anthropic now has a directly comparable feature too: current Claude Desktop’s **Code** tab supports **Local / Remote (Anthropic cloud) / SSH** environments; “+ Add SSH connection” accepts `user@hostname` or an `~/.ssh/config` alias, port, and identity file, then persists it in the environment picker. Claude Desktop is explicitly macOS/Windows only; Linux is not supported. The docs require Desktop **v1.2581.0+** for the current workspace/environment UI.

---

## Turn 5: ChatGPT

_2026-09-13T20:29:03.815Z_

Research checked **13 September 2026**. The short answer is that **Claude Desktop is currently closer to your desired “prompt → enroll VPS → pick it in the remote-environment UI” workflow than OpenAI’s ChatGPT/Codex desktop app**. Anthropic exposes the SSH-environment registry as a documented settings structure that an agent can write. OpenAI documents SSH discovery, remote runtime installation/authentication, and the GUI workflow, but still lacks a supported CLI/API for completing desktop remote-project registration.

## Bottom line

| Capability | OpenAI ChatGPT/Codex desktop | Claude Desktop / Claude Code |
|---|---|---|
| Native SSH remote project/session | **Yes, GA** | **Yes** |
| macOS | Yes | Yes |
| Windows | Yes | Yes |
| Linux desktop | **Yes, preview** | **Yes, beta** |
| Discover ordinary `~/.ssh/config` | Yes; concrete `Host` aliases | Yes; can reference config aliases |
| Documented machine-writable SSH registry | **No desktop-remote registry API/config contract** | **Yes: `sshConfigs` in `~/.claude/settings.json`** |
| Supported CLI to “add this VPS to desktop picker” | **No** | No dedicated command, but documented JSON config makes CLI/agent provisioning practical |
| Public API/app-server method for picker registration | None documented | None documented |
| Supported deep link to add SSH target | None documented | None documented |
| Some deep-link functionality | **Undocumented:** existing-alias SSH-add route observed | Documented `claude://code/new`, but no SSH/environment parameter |
| Remote runtime | **You install `codex` yourself** | **Desktop installs Claude Code automatically** |
| Remote runtime authentication | **You authenticate Codex on VPS** | Desktop SSH uses the Desktop/OAuth path; no separate API-key provisioning is normally required |
| Fully unattended native enrollment | **No** | **Almost**: write `sshConfigs`; user still selects environment/project |
| Root/admin remote account | Not prohibited, but OpenAI explicitly recommends least privilege | Root is a poor compatibility target; Bypass is explicitly blocked by the runtime, and Desktop root-SSH regressions are documented in Anthropic's tracker |
| `ssh host command` from agent shell | Works, but **not native remote-project integration** | Works, but **not native SSH-environment integration** |

### 1. OpenAI ChatGPT/Codex

OpenAI made **Remote SSH generally available on May 14, 2026**. Its announcement says the desktop app auto-detects hosts from SSH configuration and lets users create projects and run threads inside remote machines. Remote SSH is available on all plans. ([OpenAI](https://openai.com/index/work-with-codex-from-anywhere/))

The current native flow is explicitly:

1. Put a **concrete** alias in `~/.ssh/config`.
2. Verify `ssh devbox` works.
3. **Install and authenticate Codex on the remote host**.
4. In the desktop app, go to **Settings → Connections**, add/enable the SSH host, then select a remote project folder.

Codex resolves SSH entries using OpenSSH; pattern-only `Host *`-style entries are not enrolled as selectable hosts. The application starts a **remote Codex App Server over SSH using the remote user's login shell**, so `codex` must be on that user's `PATH`. ([ChatGPT Learn](https://learn.chatgpt.com/docs/remote-connections))

That is genuine native remote integration: the project is associated with the remote host; reads, writes and commands happen on its filesystem/shell, and Codex can later hand a chat between a local and compatible saved remote project. ([ChatGPT Learn](https://learn.chatgpt.com/docs/remote-connections))

The latest stable Codex CLI I could verify is **0.154.0, released September 9, 2026**. OpenAI's current SSH documentation does **not** state a minimum ChatGPT/Codex desktop-app build for Remote SSH, so assigning a desktop version number to the feature would be guesswork. ([GitHub](https://github.com/openai/codex/releases))

#### Remote authentication

For a headless Linux VPS, OpenAI's preferred ChatGPT-login mechanism is currently:

```bash
codex login --device-auth
```

Device-code authentication is still labelled beta and must be permitted in the user's ChatGPT security settings or workspace permissions. The documented fallback is to authenticate elsewhere and copy `~/.codex/auth.json`; OpenAI warns that this file contains access tokens and must be treated like a password. ([ChatGPT Learn](https://learn.chatgpt.com/docs/auth))

This distinction matters: **authenticating your local ChatGPT desktop app does not eliminate the requirement to provision/authenticate the remote Codex runtime**. Native SSH starts that remote runtime.

#### Can a local agent enroll the VPS completely?

It can automate nearly everything *before* the desktop registry step: provision the VPS, create a key, write `~/.ssh/config`, populate `known_hosts`, install Codex, authenticate it, clone the repo, etc.

It currently cannot use a **supported** CLI/API to create/enable the desktop remote project. Open issue `openai/codex#21554`, opened **May 7, 2026** and still open when checked, describes exactly your workflow and says the final registration remains GUI work: refresh Connections, enable the host, create a remote project, choose host, choose path. It reports no public app-server method for doing this. ([GitHub](https://github.com/openai/codex/issues/21554))

This is also independently reflected in DigitalOcean's own current **CodexPlugin**: it automates Droplet creation, key generation, SSH config, host-key scanning and readiness but explicitly labels the final Codex registration **“the one manual step”**, because “there is no supported CLI to register a desktop remote SSH project.” ([GitHub](https://github.com/digitalocean/CodexPlugin))

So for your desired flow, OpenAI currently bottoms out at something like:

```text
Prompt local agent
    ↓
Provision VPS
    ↓
write ~/.ssh/config
    ↓
install/authenticate codex remotely
    ↓
[MANUAL] Settings → Connections → enable/add host
    ↓
[MANUAL] New remote project → host → folder
```

#### OpenAI CLI/API/deep links

There is one interesting but **undocumented** partial shortcut. A June 23, 2026 feature request in OpenAI's own Codex repository states that the application already recognizes:

```text
codex://settings/connections/ssh/add?name=devbox
```

where `devbox` must already be an SSH `Host` alias. The same issue asks OpenAI to add hostname/user/key parameters and a remote-folder/thread route, which means those richer forms are **not currently supported**. ([GitHub](https://github.com/openai/codex/issues/29726))

I would classify that alias link as **UNDOCUMENTED / NON-CONTRACTUAL**. It is mentioned by a contributor/user in OpenAI's tracker, not in the product documentation. It may save a navigation step but is unsuitable as the foundation of an automation product.

Similarly, modifying:

```text
~/.codex/.codex-global-state.json
```

to inject `remote-projects`, selected host IDs, etc. is **UNDOCUMENTED AND UNSUPPORTED**. The open feature request reports that the app can overwrite such external edits from in-memory state and that the representation is app-version-sensitive. ([GitHub](https://github.com/openai/codex/issues/21554))

I would not ship either technique as a supported integration.

### 2. OpenAI by local OS

**macOS:** This is a first-class supported desktop configuration. Have the provisioning agent create a concrete entry in the local user's `~/.ssh/config`, ensure OpenSSH can log in non-interactively or with whatever user interaction you accept, bootstrap/authenticate Codex remotely, then do the desktop add/enable/project-folder step. No local Administrator/root privilege is inherent in enrollment. ([ChatGPT Learn](https://learn.chatgpt.com/docs/remote-connections))

**Windows:** Native Remote SSH is likewise supported. Conceptually the same `~/.ssh/config` requirement applies. An important operational point is that the desktop app is a Windows application: don't assume an alias that exists only in a WSL user's Linux home is visible to the Windows app. OpenAI says it reads `~/.ssh/config` and resolves through OpenSSH; use the SSH configuration visible to the Windows desktop application's user context. That's an inference from the documented mechanism rather than an explicitly documented WSL warning. ([ChatGPT Learn](https://learn.chatgpt.com/docs/remote-connections))

**Linux:** ChatGPT Desktop is now an official **preview**, rather than nonexistent. The current Linux page supports Ubuntu **24.04/26.04**, Debian **13**, and Fedora **43/44**, x64 and ARM64. The generic current desktop Remote SSH guide does not exclude Linux. Installation itself uses elevated package-manager privileges, but normal application/SSH use is user-level. ([ChatGPT Learn](https://learn.chatgpt.com/de-DE/docs/linux/linux-app))

For all three, therefore, the automation limitation is the same: **SSH configuration is automatable; native remote-project registration is not yet exposed as a supported automation surface.**

---

## 3. Claude Desktop / Claude Code

Anthropic's current SSH model is materially friendlier to your provisioning scenario.

The live Claude Code Desktop documentation says the Code-tab environment picker can select Local, Cloud, SSH, and—on Windows—WSL. To add SSH manually, choose **Environment → + Add SSH connection** and provide a friendly name, `user@hostname` or an SSH-config alias, optional port, and optional identity file. Once selected, Claude operates against the remote machine's files and tools. The SSH target must be **Linux or macOS**. ([Claude](https://code.claude.com/docs/en/desktop))

Crucially:

> **Desktop installs Claude Code on the remote machine automatically the first time you connect.**

That removes OpenAI's explicit “install the remote CLI and authenticate it yourself” bootstrap requirement. ([Claude](https://code.claude.com/docs/en/desktop))

Anthropic also exposes the environment registry as documented configuration:

```json
{
  "sshConfigs": [
    {
      "id": "shared-dev-vm",
      "name": "Shared Dev VM",
      "sshHost": "user@dev.example.com",
      "sshPort": 22,
      "sshIdentityFile": "~/.ssh/id_ed25519"
    }
  ]
}
```

Administrators can distribute that through managed settings, **and individual users may put the same `sshConfigs` array in `~/.claude/settings.json`**. Anthropic explicitly says that is also where connections created through the GUI are stored. ([Claude](https://code.claude.com/docs/en/desktop))

That is the key architectural difference.

A local Claude Code/Codex/script can therefore make a supported edit to:

```text
~/.claude/settings.json
```

and enroll the VPS without driving the Add SSH Connection dialog.

Anthropic doesn't document a dedicated `claude ssh add ...` command, but you don't particularly need one because the persistence format itself is documented.

For your desired flow:

```text
Prompt local agent
    ↓
Provision VPS + key + SSH access
    ↓
write ~/.ssh/config if desired
    ↓
write documented sshConfigs to ~/.claude/settings.json
    ↓
Claude Desktop shows connection
    ↓
[MANUAL] select it in Environment picker + choose project
    ↓
Desktop bootstraps remote Claude Code automatically
```

One qualification: the documentation says the user settings file is supported storage for these connections, but I found **no documented guarantee that an already-running Desktop instance live-reloads an externally modified `sshConfigs` immediately**. A reload/restart may therefore sometimes be operationally necessary; I would not advertise hot reload unless you test the specific app build.

### Authentication difference

Current Anthropic authentication docs distinguish the terminal CLI from Desktop. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `apiKeyHelper` are supported credential mechanisms for CLI/wrapping surfaces, while **Claude Desktop uses its OAuth credential path** except for specifically configured third-party inference deployments. ([Claude](https://code.claude.com/docs/en/team))

That means you shouldn't provision a native Desktop SSH environment by dropping `ANTHROPIC_API_KEY` onto the VPS and expect Desktop to consume it the same way as terminal Claude Code.

For a **standalone Claude Code CLI running over an ordinary shell/SSH session**, the rules are different: CLI browser/OAuth login works, including the copy-code fallback commonly needed over SSH; API keys, auth tokens and `claude setup-token` can also be used for supported CLI/headless automation. ([Claude](https://code.claude.com/docs/en/team))

That is another case where **“Claude Code over SSH” and “Claude Desktop native SSH environment” are different products/workflows**.

The latest official Claude Code release page currently marks **v2.1.269, September 11, 2026**, as latest. Anthropic's current Desktop SSH reference does not declare a minimum build specifically for SSH. It does say its newer pane/workspace UI requires Desktop **v1.2581.0+**, and the managed setting `disableDesktopLocalSessions`—useful for forcing managed machines to SSH/cloud—is supported from **v1.37937.0+**. ([GitHub](https://github.com/anthropics/claude-code/releases))

### 4. Claude by local OS

**macOS:** Fully documented. Local user `~/.claude/settings.json` can carry `sshConfigs`; standard SSH aliases and identity files work. Native SSH remote machines may be Linux or macOS. ([Claude](https://code.claude.com/docs/en/desktop))

**Windows:** Fully documented. The environment selector separately exposes **WSL and SSH**—WSL is not the remote-VPS mechanism. Use SSH for the VPS. User settings are under the user's Claude configuration/home context, and Windows credentials for terminal Claude Code are normally under `%USERPROFILE%\.claude`; native Desktop itself uses its OAuth flow. ([Claude](https://code.claude.com/docs/en/desktop))

**Linux:** This changed recently enough that stale search results are misleading. Anthropic's current documentation says **Claude Desktop for Linux is beta**, installed through apt/.deb on Ubuntu/Debian; its Help Center lists Ubuntu **22.04 LTS+** and Debian **12+**, x64/ARM64. The current Desktop reference includes SSH environments without excluding Linux. Computer Use remains a separate macOS/Windows-only feature, but that doesn't affect SSH Code sessions. ([Claude](https://code.claude.com/docs/en/desktop))

Thus the same documented `sshConfigs` approach can be used on all three local OS families.

---

## 5. Deep links: useful, but not enough

Anthropic has a **documented** cross-platform `claude://` URL scheme, published **June 30, 2026**, for macOS, Windows and Linux. For Code:

```text
claude://code/new?q=Fix%20the%20failing%20test&folder=...
```

can prefill a prompt and local folder. The folder is treated as untrusted and requires confirmation. The published parameter list does **not** include SSH connection ID, environment, hostname, identity file or remote project path. ([Claude Help Center](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link))

So a supported automation can plausibly:

1. update `sshConfigs`,
2. open Claude Code with a prefilled prompt,

but it **cannot use the documented deep-link interface to preselect that SSH environment**.

For OpenAI, as described above, the SSH-add deep link is currently **undocumented**, alias-only and incomplete. There is no documented remote-folder/thread deep link. ([GitHub](https://github.com/openai/codex/issues/29726))

In other words, neither vendor currently supplies a fully supported URL equivalent to:

```text
open-agent://new?
  ssh=vps-123&
  folder=/srv/project&
  prompt=...
```

Anthropic gets much closer because the connection itself can be provisioned through documented JSON.

---

## 6. Administrator/root accounts

This needs two separate answers: **local administrator privilege** and **remote root login**.

For OpenAI, native Remote SSH is specified in terms of the “remote user” and that user's login shell; I found no documented ban on `root`. But the official SSH documentation specifically says to use **“least-privilege accounts.”** Therefore `root@vps` should be classified as **not explicitly prohibited, but not the supported/recommended deployment target**. A dedicated Unix account with narrowly scoped `sudo` is the safer compatibility baseline. ([ChatGPT Learn](https://learn.chatgpt.com/docs/remote-connections))

Local Administrator/root rights aren't normally required to enroll SSH connections. OS package installation is a separate matter—for example, installing ChatGPT's Linux `.deb`/`.rpm` naturally requires package-manager elevation. ([ChatGPT Learn](https://learn.chatgpt.com/de-DE/docs/linux/linux-app))

Claude has a stronger issue around remote `root`. The current docs equate Desktop's **Bypass permissions** with CLI `--dangerously-skip-permissions` and recommend Bypass only inside sandboxed containers/VMs. ([Claude](https://code.claude.com/docs/en/desktop))

Claude Code also enforces a runtime restriction preventing `--dangerously-skip-permissions` under root/sudo. Anthropic's issue tracker contains reproductions, and a May 11 issue documents this behavior in Claude Code **2.1.139** and was closed “not planned.” ([GitHub](https://github.com/anthropics/claude-code/issues/58150))

More importantly for native Desktop SSH, a March 20 report against Claude Desktop **1.1.7714 / Claude Code 2.1.78** documented a regression where Desktop's remote runtime invocation included the dangerous-permissions flag, causing root SSH sessions to exit. ([GitHub](https://github.com/anthropics/claude-code/issues/36739))

Those tracker reports are **not equivalent to current product documentation**, so I would not claim “current Claude Desktop can never SSH as root.” But I would classify root as **not a supportable compatibility target** for this architecture. Especially if you want unattended/high-autonomy sessions, provision a non-root service/developer account and grant only the `sudo` rights your workload needs.

The tracker also discusses environment-variable/wrapper workarounds that suppress the root guard. Those are **UNDOCUMENTED techniques and should not be used as an enrollment design**. ([GitHub](https://github.com/anthropics/claude-code/issues/9184))

---

## 7. Ordinary SSH command execution is not remote-project integration

This distinction matters a lot for product design.

A local Codex or Claude Code agent can plainly execute something such as:

```bash
ssh my-vps 'cd /srv/app && git status'
```

or run rsync/scp/SSH scripts. That is merely **a shell tool making an outbound SSH connection**. The agent's session/environment remains local; the desktop application has not registered `my-vps` as a remote project.

Anthropic makes this distinction unusually explicit: its administrator `sshHostAllowlist` controls which hosts **Claude Desktop's native SSH feature** can connect to, but **does not restrict `ssh` commands run through Claude's Bash tool**. ([Claude](https://code.claude.com/docs/en/desktop))

OpenAI's native mode similarly launches a remote Codex App Server and associates the conversation/project with the remote filesystem. That's categorically different from the local agent calling the `ssh` executable. ([ChatGPT Learn](https://learn.chatgpt.com/docs/remote-connections))

So when evaluating an automation/demo, a successful:

```text
Agent → ssh → VPS → command worked
```

does **not** demonstrate that the VPS has been enrolled in either application's remote-environment picker.

## Recommended architecture for your target UX

For **Claude**, your proposed experience is supportable today with only the final user selection left interactive: have the local agent provision a non-root account/key, verify SSH, then merge a uniquely identified object into documented `~/.claude/settings.json → sshConfigs`. The app's native SSH session will bootstrap its own remote runtime. You can optionally invoke the documented `claude://code/new?q=...` link afterward, but today it cannot select the SSH environment for you. ([Claude](https://code.claude.com/docs/en/desktop))

For **OpenAI**, automate VPS/key/SSH-config/Codex-install/device-auth completely, but stop at the documented boundary and tell the user to enable/add the discovered alias and pick the remote folder. Do **not** write `.codex-global-state.json`. If you are willing to accept an explicitly experimental integration, the alias-only `codex://settings/connections/ssh/add?name=...` route is worth testing, but it should be feature-flagged and labelled unsupported. ([GitHub](https://github.com/openai/codex/issues/21554))

The practical ranking for a product that needs **“one prompt provisions the connection, then it appears in the app picker”** is therefore:

**Claude Desktop: supported configuration path exists → good fit.  
ChatGPT/Codex Desktop: provisioning is automatable, desktop enrollment still has a supported-interface gap → partial fit.**

If you require **zero clicks all the way through opening a native remote project**, neither vendor currently exposes a fully documented end-to-end interface.
