# GitHub Actions Cache Comparison

Source: https://chatgpt.com/share/6aa9cd9f-e4f8-83eb-95fd-e16d01344af8

---

**User**

A test suite downloads a pinned server binary and builds a Docker image from a pinned
base. On GitHub Actions, what are the current recommended ways to cache each of those
between runs, and what are the documented failure modes of those caches (eviction, key
collisions, cross-branch access, size limits)?

---

**ChatGPT**

I’ll separate this into two cache layers: a file cache for the pinned server binary, and a BuildKit layer cache for the Docker image. I’ll also call out the failure modes that matter operationally, because the two caches behave differently even when both use GitHub’s cache service.

---

**ChatGPT**

The current GitHub docs have changed in one important way: the cache quota is no longer simply a hard universal “10 GB max.” The default repository allowance is still 10 GB, but GitHub now lets eligible repositories raise it; eviction still applies at the configured repository limit.

---

**ChatGPT**

For a pinned binary, I would avoid broad fallback keys entirely: an exact cache miss should trigger a fresh download of that exact version/digest, not restore “something close.” For Docker, use BuildKit’s external cache backend rather than trying to persist Docker’s daemon directories with `actions/cache`.

---

**ChatGPT**

As of September 2026, I’d use two different mechanisms: `actions/cache` for the downloaded server binary, and BuildKit’s external cache for the Docker build. GitHub-hosted runners are ephemeral, so neither should rely on the runner’s local filesystem surviving.

| Thing | Recommended cache | Key/scope strategy | Main failure modes |
|---|---|---|---|
| Pinned server binary | `actions/cache@v6` | Exact OS + arch + version/digest key; **no `restore-keys`** | 7-day inactivity eviction; repo quota/LRU eviction; branch scoping; bad under-specified keys |
| Docker build layers | `docker/build-push-action@v7` + `cache-from/cache-to: type=gha` | Explicit `scope=` per image/build | Same GitHub quota/eviction; default `buildkit` scope collisions; branch restrictions; export timeout/throttling |
| Larger/long-lived Docker cache | BuildKit `type=registry` | Dedicated registry ref such as `:buildcache` | Registry's own retention/quota rules instead of Actions-cache rules |

### Pinned binary

GitHub explicitly positions the Actions cache for files that are expensive to re-download/regenerate between runs; artifacts are intended more for preserving workflow outputs or transferring them between jobs/runs. ([GitHub Docs](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching?utm_source=chatgpt.com))

For an immutable pinned binary, make the key equally immutable:

```yaml
- name: Cache server binary
  id: server-cache
  uses: actions/cache@v6
  with:
    path: ~/.cache/my-server
    key: server-${{ runner.os }}-${{ runner.arch }}-${{ env.SERVER_VERSION }}-${{ env.SERVER_SHA256 }}

- name: Download server
  if: steps.server-cache.outputs.cache-hit != 'true'
  run: |
    mkdir -p ~/.cache/my-server
    curl -fsSL "$SERVER_URL" -o ~/.cache/my-server/server

- name: Verify server
  run: |
    echo "$SERVER_SHA256  $HOME/.cache/my-server/server" | sha256sum -c -
```

I would deliberately omit `restore-keys`. Prefix matching is useful for package-manager caches, but it is undesirable for an exact pinned executable: GitHub will otherwise accept partial-key matches and, where several match, restore the most recently created one. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

Also keep the checksum verification after the cache restore. GitHub states that cache contents are not signed or verified and should be treated as untrusted input. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

**Key collision semantics:** Actions caches are immutable. Once a cache for a key/version exists, you cannot alter its contents; changing the contents requires a new key. Keys are limited to 512 characters. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)) Thus the practical collision hazard is an under-specified key—for example `server-v1.8` without OS/architecture or digest—or an overly broad `restore-keys` prefix.

### Docker build

Don't cache `/var/lib/docker`, Buildx's local state, etc. using `actions/cache`. Use BuildKit's cache exporters/importers.

For a test image that you don't necessarily publish, the GitHub Actions backend is the straightforward option. Docker currently describes `type=gha` as the recommended cache inside GitHub Actions when the build fits GitHub's size/usage limits. ([Docker Documentation](https://docs.docker.com/build/cache/backends/gha/?utm_source=chatgpt.com))

```yaml
- uses: docker/setup-buildx-action@v4

- name: Build test image
  uses: docker/build-push-action@v7
  with:
    context: .
    load: true
    tags: test-suite:ci

    cache-from: type=gha,scope=test-suite
    cache-to: type=gha,scope=test-suite,mode=max
```

The explicit `scope=test-suite` matters. BuildKit's `gha` backend defaults the scope to `buildkit`; Docker documents that if multiple images use that default scope, each build overwrites the previous build's cache, leaving only the last one. Give distinct images distinct scopes. ([Docker Documentation](https://docs.docker.com/build/cache/backends/gha/))

If you are already pushing the image to a registry, Docker's broader CI guidance says that in most cases an **inline** cache is simplest:

```yaml
cache-from: type=registry,ref=ghcr.io/acme/app:latest
cache-to: type=inline
```

Inline cache only supports `mode=min`. For a fuller `mode=max` cache, use a dedicated registry cache ref:

```yaml
cache-from: type=registry,ref=ghcr.io/acme/app:buildcache
cache-to: type=registry,ref=ghcr.io/acme/app:buildcache,mode=max
```

Docker recommends the registry exporter when you need `max` rather than inline's `min`. ([Docker Documentation](https://docs.docker.com/build/ci/github-actions/cache/?utm_source=chatgpt.com)) A registry cache is particularly attractive if Docker layers are large or you want cache persistence that is independent of GitHub Actions' cache eviction and branch rules.

### Eviction and size limits

Both `actions/cache` and BuildKit's `type=gha` use GitHub's Actions cache service, so the relevant GitHub storage policy applies.

GitHub currently documents:

**Unused for >7 days:** the entry is removed. **Repository storage:** 10 GB by default. The limit can now be raised; personal repositories can configure as much as 10 TB, while organization/enterprise maxima depend on their configuration. Usage beyond the free 10 GB is billable. When the configured repository limit is reached, GitHub evicts entries from least-recently accessed toward most-recently accessed until usage is back below the limit. GitHub explicitly warns that this can lead to cache thrashing. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

So a large `mode=max` Docker cache can easily crowd out a relatively tiny server-binary cache, since they're competing for the same repository cache storage when you use `type=gha`.

There are also service rate limits: currently up to 200 cache uploads/minute and 1,500 downloads/minute per repository. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

### Cross-branch behavior

The branch rules apply to both `actions/cache` and Docker's `type=gha`.

A normal branch workflow can restore caches from its **current branch** and the **default branch**. A pull-request workflow may additionally use caches from its **base branch**. Sibling branches and child branches do not get access to one another's caches. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

There is an important PR wrinkle: a cache created by a `pull_request` run is scoped to its synthetic merge ref, `refs/pull/<n>/merge`. GitHub says that cache can subsequently be restored only by reruns of that PR; `main` and other PRs cannot consume it. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

That means a useful pattern is to keep a healthy Docker cache populated by `push` builds on `main`; feature/PR builds can then consume the default-branch cache and add their own PR-specific cache without contaminating `main`.

GitHub also now has explicit cache-write restrictions for low-trust events. Events such as `pull_request_target`, `issue_comment`, and `workflow_run` resolving in the default-branch context normally receive read-only cache access. A save is skipped/warned for `actions/cache`; Docker documents that a `cache-to: type=gha` export can fail with errors such as `failed to reserve cache`. For those workflows, retain `cache-from` but omit `cache-to`, or make Docker cache export non-fatal with `ignore-error=true`. ([GitHub Docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

### Docker-specific cache failures

There are two extra ones worth knowing. The `gha` backend has a default 10-minute import/export timeout; excessive GitHub cache-API requests can cause an export to hit that timeout. Docker says `docker/build-push-action` automatically supplies `GITHUB_TOKEN` to reduce this API-throttling issue. ([Docker Documentation](https://docs.docker.com/build/cache/backends/gha/))

And old tooling is no longer viable: GitHub Cache API v1 was shut down on April 15, 2025. Docker documents minimum versions of Buildx 0.21, BuildKit 0.20, Compose 2.33.1, or Engine 28 depending on the path. Current `setup-buildx-action`/`build-push-action` on GitHub-hosted runners already meet that requirement. ([Docker Documentation](https://docs.docker.com/build/ci/github-actions/cache/?utm_source=chatgpt.com))

For the test suite you described, my default configuration would therefore be **exact-digest `actions/cache@v6` for the binary, with no fallback keys**, and **Buildx `type=gha,scope=<image-name>,mode=max` for the Docker build**. If the BuildKit cache gets into the multi-GB range or you need predictable persistence across branches, move that second cache to a dedicated registry ref instead.
