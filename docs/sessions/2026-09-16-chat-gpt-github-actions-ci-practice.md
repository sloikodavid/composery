# GitHub Actions CI Practice

Source: https://chatgpt.com/share/6aab1640-bd20-83ed-bb25-32538353eb66

---

## Turn 1: User

_2026-09-16T22:15:02.580Z_

A private GitHub repository has a twelve-minute test suite that needs Docker and downloads a database binary. Survey current practice for running this in GitHub Actions: caching strategies and what they actually save, concurrency and cancellation of superseded runs, how minutes are consumed on private repositories and what the billing model and spending controls are as of 2026, whether teams run the full suite on every push or only on pull requests, and how scheduled jobs that check for external drift are kept separate from the suite. Include arguments that CI is not worth configuring for a solo developer who already runs the suite locally.

---

## Turn 2: ChatGPT

_2026-09-16T22:15:02.155Z_

I’ll separate “what GitHub officially supports and bills” from “what teams commonly do in practice,” because those are easy to conflate. I’ll also distinguish caches that avoid downloads/builds from changes that actually reduce billed runner time.

---

## Turn 3: ChatGPT

_2026-09-16T22:15:17.216Z_

The billing picture is now clearer: a 12-minute Linux job is roughly a $0.072 metered job after included minutes, and GitHub rounds each job up to a whole minute. The bigger economic question is therefore usually frequency and duplication, not the absolute cost of one run.

---

## Turn 4: ChatGPT

_2026-09-16T22:15:42.595Z_

One important trigger nuance: “PR-only” does **not** mean “once per PR.” By default, `pull_request` runs on `opened`, `reopened`, and `synchronize`, so every new push to an open PR reruns CI; what it avoids is running the expensive suite on pre-PR feature-branch pushes.

---

## Turn 5: ChatGPT

_2026-09-16T22:16:05.680Z_

As of **September 2026**, a twelve-minute Docker/database test suite is quite ordinary for GitHub Actions. The prevailing setup is less “run everything on every push” and more **run the expensive suite on PR updates, validate `main` after merge, cancel obsolete runs, and cache only the expensive setup inputs**. GitHub’s own examples commonly use the `pull_request` + `push`-to-`main` combination. ([GitHub Docs](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments?utm_source=chatgpt.com))

### Caching: what actually helps

GitHub-hosted jobs start on fresh machines, so local dependency caches, downloaded binaries, Docker layers, and Docker volumes do not naturally survive to the next job. GitHub provides explicit caches for exactly this reason. ([GitHub Docs](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching?utm_source=chatgpt.com))

| Thing | Typical 2026 approach | What it really saves |
|---|---|---|
| Language dependencies | `setup-node`, `setup-python`, etc. built-in caching, or `actions/cache` | Network download and sometimes extraction/install work. **Does not save test time.** |
| Downloaded DB binary | `actions/cache`, key including DB version + OS + architecture | Re-downloading and unpacking the DB on every runner. This is probably your highest-value simple cache. |
| Docker image you **build** | Docker Buildx with `cache-from: type=gha` / `cache-to: type=gha` or a registry cache | Re-executing unchanged Dockerfile layers, including package installs/build compilation. ([Docker Documentation](https://docs.docker.com/build/cache/backends/gha/?utm_source=chatgpt.com)) |
| Docker image you merely **pull** | Usually just pull it | BuildKit cache does not magically cache an ordinary `docker pull`. Caching a `docker save` tar is possible, but cache transfer/decompression can erase much of the benefit. |
| Database contents/volumes | Usually recreate them | Persisting test DB state risks contamination and undermines reproducibility. |
| Test logs/results | Upload as artifacts on failure | Debugging convenience; not a speed cache. |

For a binary, a key along these lines is appropriate:

```yaml
- uses: actions/cache@v6
  id: db-cache
  with:
    path: ~/.cache/mydb/1.9.3
    key: db-${{ runner.os }}-${{ runner.arch }}-1.9.3

- if: steps.db-cache.outputs.cache-hit != 'true'
  run: ./scripts/download-db 1.9.3
```

GitHub cache entries are immutable: a miss creates a new entry after a successful job, while exact and prefix matches can restore existing entries. The default cache allowance is currently **10 GB per repository**, with unused entries subject to eviction after seven days; larger configured cache limits can generate storage charges. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching?utm_source=chatgpt.com))

The important economic point is that cache transfer itself consumes runner time. If your database download takes 90 seconds and restoration takes 10 seconds, caching is clearly useful. If downloading it takes 12 seconds and restoring the cache takes 9 seconds, the complexity has bought almost nothing. A recent 2026 practitioner discussion also illustrates that cache and container startup latency can itself occasionally be troublesome, so I would measure the uncached and warm-cache setup separately rather than assuming a cache is a win. ([Reddit](https://www.reddit.com/r/devops/comments/1wfw0o1/what_github_actions_issues_do_you_run_into/?utm_source=chatgpt.com))

And GitHub bills **each job rounded up to a whole minute**. Saving 20 seconds therefore sometimes saves zero billable minutes; saving two full minutes generally does. ([GitHub Docs](https://docs.github.com/en/enterprise-cloud%40latest/billing/reference/actions-runner-pricing?utm_source=chatgpt.com))

### Superseded runs: cancellation is well worth using

For a long PR suite, current practice strongly favors concurrency groups:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

GitHub then allows only the newest run in that group to continue. By default only one pending run is retained; `cancel-in-progress: true` additionally kills an already-running obsolete run. Include the workflow name in the key so your CI workflow cannot accidentally cancel an unrelated scheduled/deployment workflow. ([GitHub Docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency?utm_source=chatgpt.com))

Cancellation does **not** refund time already used. If an obsolete job ran for five minutes before a new commit arrived, those minutes have been consumed; cancellation merely avoids paying/waiting for the remaining seven. GitHub likewise documents that a job that fails after five minutes consumes those five minutes. ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions?utm_source=chatgpt.com))

For rapid push/fix/push cycles, this is frequently a bigger saving than elaborate caching.

### Private-repository billing in 2026

Current included GitHub-hosted Actions minutes are:

| Account plan | Included private-repo minutes / month |
|---|---:|
| GitHub Free, personal | 2,000 |
| GitHub Pro | 3,000 |
| GitHub Free, organization | 2,000 |
| GitHub Team | 3,000 |
| GitHub Enterprise Cloud | 50,000 |

([GitHub Docs](https://docs.github.com/en/billing/reference/product-usage-included?utm_source=chatgpt.com))

After the allowance, standard hosted-runner pricing is currently **$0.006/min for 2-core x64 Linux**, **$0.005/min for 2-core ARM Linux**, **$0.010/min for Windows**, and **$0.062/min for standard macOS**. A nominal twelve-minute x64 Linux run therefore costs about **$0.072 after the allowance**; 12:01 of runtime would round to 13 minutes, or $0.078. ([GitHub Docs](https://docs.github.com/en/enterprise-cloud%40latest/billing/reference/actions-runner-pricing?utm_source=chatgpt.com))

One detail worth noticing for a Docker-heavy suite: the normal `ubuntu-latest` runner for a **private** repository currently has only **2 CPUs and 8 GB RAM**. The equivalent public-repository standard runner gets 4 CPUs/16 GB. So a twelve-minute local test is not necessarily a twelve-minute private GitHub job, especially if the DB and application compete for CPU. ([GitHub Docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners?utm_source=chatgpt.com))

The resulting costs are often surprisingly modest. At 220 twelve-minute Linux runs per month, you use about 2,640 minutes: that fits inside Pro/Team's 3,000-minute allowance and exceeds the Free allowance by 640 minutes, about **$3.84**. But accidentally running both `push` and `pull_request` workflows for every PR update can roughly double the compute; 5,280 minutes would put a Pro/Team account 2,280 minutes over its allowance, about **$13.68** at today's Linux rate.

GitHub now uses **budgets and alerts** rather than relying on an open-ended spending limit. A personal account or organization can create an Actions product-level or SKU-level budget, get alerts at 75/90/100%, and—where supported—select **“Stop usage when budget limit is reached.”** If there is no valid payment method, GitHub blocks additional hosted-runner usage when the included quota is exhausted. ([GitHub Docs](https://docs.github.com/en/billing/how-tos/set-up-budgets?utm_source=chatgpt.com))

Self-hosted runners don't consume GitHub-hosted Actions minutes, although obviously you then own the machine cost, maintenance, isolation and security burden. ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions?utm_source=chatgpt.com))

### Every push versus pull requests

There are three recognisable patterns:

| Trigger design | Where it tends to make sense | Consequence |
|---|---|---|
| `push` on every branch | Very fast suites, or teams deliberately wanting feedback before a PR exists | Maximum feedback, maximum CI volume. |
| `pull_request` + `push` only on `main` | Very common for nontrivial suites | No expensive remote run while casually developing; every update after the PR opens is tested; merged `main` is independently verified. |
| Manual/release/main-only | Solo projects or particularly costly suites | Local testing carries most of the assurance; remote CI is only a backstop. |

The middle configuration is particularly relevant here:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:
```

A `pull_request` workflow already fires whenever the PR head is updated (`synchronize`), so you still test every push **once the PR exists**. ([docs.github.com](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows?utm_source=chatgpt.com))

That also avoids a common mistake:

```yaml
on:
  push:
  pull_request:
```

For a branch with an open PR, one commit can generate a push run **and** a PR run. The duplicate-work problem is well known in practice; limiting `push` to `main` is the straightforward fix. ([Stack Overflow](https://stackoverflow.com/questions/74441152/how-to-avoid-the-duplicated-job-in-github-action-like-build-image?utm_source=chatgpt.com))

For a twelve-minute suite I'd generally treat PR + `main` as the conventional full-suite setup, while allowing much faster lint/type/unit checks to run more frequently if they provide useful sub-minute feedback.

### Keep external-drift checks out of normal CI

The clean architecture is **separate orchestration, shared test code**.

Normal PR CI should pin the database binary/container/API assumptions so that the same commit gives you a repeatable result. A separate `.github/workflows/external-drift.yml` deliberately asks a different question: “Does the current code still work against whatever changed outside this repository?”

For example:

```yaml
name: External drift

on:
  schedule:
    - cron: "17 3 * * 1"
  workflow_dispatch:

concurrency:
  group: external-drift
  cancel-in-progress: true

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      # discover latest external DB/API version
      # run targeted compatibility test or the suite against it
      # report failure
```

GitHub scheduled workflows run from the latest default-branch commit and only run if the workflow exists on the default branch. GitHub specifically warns that top-of-hour schedules can be delayed under load, so `03:17` rather than `03:00` is sensible. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows?utm_source=chatgpt.com))

The scheduled workflow should have a different workflow name/concurrency group and normally should **not** be a required PR status check. It can still invoke the same `./scripts/test` command or reusable workflow as CI; what stays separate is the trigger, external-version selection, failure reporting and branch-protection semantics. GitHub supports reusable workflows precisely so deterministic workflow logic doesn't have to be duplicated. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations?utm_source=chatgpt.com))

That gives a useful distinction:

```text
PR CI:       pinned DB 1.9.3 → "Did this change break our supported environment?"
Drift job:   latest DB       → "Did the outside world break us?"
```

A drift failure therefore doesn't turn every unrelated PR red.

### The case for not configuring CI at all

For a solo developer, the anti-CI argument is stronger than CI advice sometimes admits.

- If you reliably run the exact twelve-minute suite locally before merging/releasing, CI may initially duplicate twelve minutes of work without discovering anything new. You have no second contributor whose machine or habits you need to police.
- Docker already provides much of the environment consistency that CI would otherwise add. If the same containerized suite is trivial to reproduce locally, “clean machine” verification has less incremental value.
- GitHub Actions itself becomes another piece of software to maintain: YAML, permissions, action-version upgrades, caches, runner-image changes, secrets, transient network failures and CI-only failures. 2026 practitioner discussions still regularly cite slow feedback, flaky infrastructure, cache problems and workflow debugging as real overhead. ([Reddit](https://www.reddit.com/r/devops/comments/1rdrpzz/whats_your_biggest_frustration_with_github/?utm_source=chatgpt.com))
- A twelve-minute remote loop is poor interactive feedback. The local run may start immediately and exploit a warm Docker/package cache; a hosted run has provisioning/setup/network latency on every job.
- The dollar amount may be tiny, but the configuration and attention cost is not. Spending several hours optimizing a pipeline to save cents per run can be irrational for a one-person repository.
- CI becomes much more compelling when it provides something you **cannot already get locally**: a protected merge gate, cross-platform testing, reproducibility on a clean machine, automated releases, collaborators, or scheduled external-drift detection.

That leaves a particularly reasonable solo-developer compromise: **keep the full suite local during ordinary development; add one simple PR/main workflow with cancellation and only the obvious DB/dependency caches; put external drift in a separate scheduled workflow.** There is little reason to build an elaborate CI platform around a twelve-minute test suite unless measurements show that it is solving an actual problem.

In other words, the 2026 GitHub economics don't force aggressive optimization: at $0.006/Linux-minute and thousands of included private-repo minutes, avoiding duplicated runs and keeping the configuration simple matters more than shaving every possible second. ([GitHub Docs](https://docs.github.com/en/enterprise-cloud%40latest/billing/reference/actions-runner-pricing?utm_source=chatgpt.com))

---

If you want, I can:

- Explain concurrency and cancellation in GitHub Actions for this test suite
- Describe billing details and spending controls for private repo Actions
- Outline recommended CI trigger strategies for this test suite
