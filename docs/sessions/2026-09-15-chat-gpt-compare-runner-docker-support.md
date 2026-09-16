# Compare Runner Docker Support

Source: https://chatgpt.com/share/6aa9cd8d-a0bc-83eb-9ac9-ea4ee7f2aede

---

## Turn 1: User

_2026-09-15T22:51:32.433Z_

On GitHub Actions in 2026: which hosted runner images can run Linux Docker containers,
and which cannot? Cover ubuntu, windows and macOS runners, including Apple-silicon macOS.
For each, say how you know. Also: what are the current minute allowances and per-minute
prices for a private repository, and do they differ per runner OS?

---

## Turn 2: ChatGPT

_2026-09-15T22:52:11.601Z_

I’ll cross-check GitHub’s current Actions docs and runner-image repositories, then separate “can execute Linux containers” from “has Docker installed,” since those are not the same thing on Windows/macOS.

---

## Turn 3: ChatGPT

_2026-09-15T22:52:21.222Z_

One important 2026 exception has emerged: `ubuntu-slim` is Linux, but it is not equivalent to the normal Ubuntu VM images for Docker. I’m verifying that against the current image manifests before giving the matrix.

---

## Turn 4: ChatGPT

_2026-09-15T22:52:59.162Z_

The billing side also has a subtle distinction: GitHub publishes one monthly allowance per plan, but Windows/macOS still have OS multipliers when consuming that allowance, while overage is charged at the newer 2026 dollar rates.

---

## Turn 5: ChatGPT

_2026-09-15T22:54:44.285Z_

As of **15 September 2026**, the clean rule is: **use a normal Ubuntu VM runner if you need Linux Docker containers on GitHub-hosted Actions**. GitHub’s own workflow syntax explicitly says Docker container actions, job containers (`container:`), and service containers require a Linux runner, and on GitHub-hosted infrastructure that means an **Ubuntu runner**. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax))

I’m treating “can run Linux Docker containers” as local container execution on the hosted runner—not merely having a `docker` CLI that could connect to some remote daemon.

### Hosted-runner Docker support

| Hosted runner/image | Linux Docker containers? | How we know |
|---|---|---|
| **Ubuntu x64:** `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04`, `ubuntu-26.04` | **Yes** | GitHub explicitly supports hosted container jobs/services on Ubuntu. The actual Ubuntu manifests contain both **Docker Client and Docker Server**; e.g. Ubuntu 24.04 currently has Docker 28.0.4, and Ubuntu 26.04 has Docker 29.4.2. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)) |
| **Ubuntu arm64:** `ubuntu-24.04-arm`, `ubuntu-22.04-arm`, `ubuntu-26.04-arm` | **Yes** | They are standard Ubuntu Linux runners, so the same Actions Linux-container support applies. GitHub introduced the arm64 standard runners specifically citing containerized services and native multi-architecture builds as use cases. ([The GitHub Blog](https://github.blog/changelog/2026-01-29-arm64-standard-runners-are-now-available-in-private-repositories/?utm_source=chatgpt.com)) |
| **`ubuntu-slim`** | **No, not for local Docker/DinD** | This is the exception. `ubuntu-slim` is itself an **unprivileged container on a shared VM**. GitHub explicitly says operations such as **Docker-in-Docker are unsupported**. ([GitHub Docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)) |
| **Windows x64:** `windows-latest`, `windows-2025`, `windows-2022` | **No for Linux containers / Actions `container:`** | The Actions container machinery is Linux-only. Interestingly, x64 Windows images *do* contain Docker—Windows 2025 currently lists Docker 29.7.2—but that does not turn them into Linux Docker hosts or make `container:`/`services:` work. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)) |
| **Windows arm64:** `windows-11-arm`, `windows-11-vs2026-arm` | **No** | Same non-Linux restriction, and the current Windows ARM image manifest does not list Docker at all. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)) |
| **macOS Intel:** `macos-15-intel`, `macos-26-intel` | **Not natively/supported; manual workaround possible** | GitHub’s `container:`/services support still rejects non-Linux runners. Docker is not a stock macOS service. There is evidence from GitHub’s runner-image issue tracker that installing a Linux-VM backend such as Colima has worked on **x86_64 macOS hosted runners**, so raw `docker run` can be made to work manually—but this is not a supported GitHub Actions container environment. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)) |
| **macOS Apple Silicon:** `macos-latest`, `macos-14`, `macos-15`, `macos-26`, `xcode-27` | **No** | Besides the generic non-Linux restriction, Apple-Silicon hosted runners currently lack usable Hypervisor.framework virtualization inside the hosted VM. A Jan. 2026 runner-images report shows `kern.hv_support` unavailable, and GitHub closed the request to enable it as **not planned**. That prevents the nested Linux VM normally needed by Docker Desktop/Colima. ([GitHub](https://github.com/actions/runner-images/issues/13505)) |

GitHub’s current standard-runner table confirms that `macos-latest` is now the **3-core M1/arm64** class, alongside `macos-14`, `macos-15`, `macos-26`, and `xcode-27`; Intel is explicitly selected with labels such as `macos-26-intel`. ([GitHub Docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners?utm_source=chatgpt.com))

So, for a workflow such as:

```yaml
jobs:
  test:
    runs-on: ubuntu-24.04
    container: node:24
    services:
      postgres:
        image: postgres:18
```

normal Ubuntu is the supported choice. Windows/macOS aren't alternate hosts for that job syntax.

### Private-repository minutes and prices

The **included monthly allowance is determined by the account/organization plan**, not by an individual private repository:

| Plan | Standard hosted-runner minutes/month |
|---|---:|
| GitHub Free | 2,000 |
| GitHub Pro | 3,000 |
| GitHub Free for organizations | 2,000 |
| GitHub Team | 3,000 |
| GitHub Enterprise Cloud | 50,000 |

These reset monthly. Larger runners are a separate case: they are always charged and don't get covered by this standard-runner allowance. ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions))

**Overage prices absolutely do differ by runner OS and architecture in 2026:**

| Standard hosted runner | Current USD/min |
|---|---:|
| `ubuntu-slim`, Linux x64 1-core | **$0.002** |
| Ubuntu/Linux x64 2-core | **$0.006** |
| Ubuntu/Linux arm64 2-core | **$0.005** |
| Windows x64 2-core | **$0.010** |
| Windows arm64 2-core | **$0.010** |
| macOS Intel or M1 standard | **$0.062** |

GitHub rounds each job's partial minute up to a whole minute. These lower rates took effect on **January 1, 2026**. ([GitHub Docs](https://docs.github.com/en/billing/reference/actions-runner-pricing))

There is one billing wrinkle worth calling out: the **included-minute pool is also OS-weighted**. GitHub's current REST documentation still explicitly says raw workflow usage does **not include the Windows/macOS multiplier**, confirming that the multiplier is applied separately. GitHub's documented factors are **Linux 1×, Windows 2×, macOS 10×**. Thus, for example, 3,000 included minutes can cover 3,000 wall-clock Linux minutes, about 1,500 Windows minutes, or about 300 macOS minutes if used exclusively on that OS. ([GitHub Docs](https://docs.github.com/en/rest/actions/workflows))

One caution on that last point: GitHub's redesigned 2026 billing page no longer displays the multiplier table prominently even though its current REST API documentation still references the Windows/macOS multipliers. The **dollar rates above are unequivocally current** and should not be inferred from the multipliers—the January 2026 price cuts changed the rates without making them simple 1×/2×/10× dollar ratios. ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions))

**Bottom line:** if Linux Docker is a requirement, choose a regular `ubuntu-*` runner—x64 or arm64. Don't choose `ubuntu-slim`, Windows, or Apple-Silicon macOS; treat Intel macOS Docker as an unsupported/manual workaround rather than a portable Actions capability.
