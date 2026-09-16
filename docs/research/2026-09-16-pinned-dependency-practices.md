# Pinned Dependency Practices

Source: https://chatgpt.com/share/6aa9f9d8-c590-83eb-9b4a-0bb6bb6887f9

---

**User**

What do maintainers of long-lived repositories do about pinned external versions that are
not managed by a package manager — base image digests, downloaded binaries with checksums,
archive snapshots? Look for practices that are not a bot opening pull requests.

---

**ChatGPT**

I’ll look for concrete maintainer practices in mature repositories where the pin is “just data in the repo” rather than a package-manager dependency, and filter out workflows whose main mechanism is automated PR creation. I’ll focus on base-image digests, checksum-pinned binaries, and snapshot/archive URLs, then pull out the recurring patterns.

---

**ChatGPT**

A pattern is already emerging: mature repos often automate **discovery and mechanical rewriting**, but keep the **decision to advance the pin** human-controlled. The interesting distinction is “tool-assisted maintenance” versus “bot-authored dependency PRs.” I’m checking older projects now for how they encode that distinction in release docs, scripts, and CI.

---

**ChatGPT**

The pattern in long-lived repositories is usually **not “keep every pin automatically current.”** It is closer to treating these references as a small, hand-maintained lockfile: make the pin immutable, make refreshing it cheap and reproducible, and give humans an explicit trigger for deciding when to move it.

| Practice | What it looks like | Examples |
|---|---|---|
| **Pin hard, update deliberately** | Keep the readable version/tag *and* the content identity—digest, commit, snapshot date, checksum. Updating is an explicit maintenance action. | curl’s release-build Dockerfile pins `debian:bookworm-slim@sha256:...` and literally documents “To update, get the latest digest…” rather than following the tag automatically. ([GitHub](https://github.com/curl/curl/blob/master/Dockerfile?utm_source=chatgpt.com)) |
| **Couple updates to a natural lifecycle event** | Refresh pins when making a release, rebuilding an image, responding to a CVE, or intentionally upgrading a tool—not continuously. | kind’s release procedure builds a node image, obtains its digest, tests the staging digest, promotes it, obtains the final registry digest, and then changes the repository default as part of the release checklist. ([GitHub](https://github.com/kubernetes-sigs/kind/blob/main/RELEASE.md?utm_source=chatgpt.com)) |
| **Use a small manifest as a “manual lockfile”** | Put version, URL, SHA-256 and sometimes release date/metadata together rather than scattering literals through scripts. | Envoy has a centralized `repository_locations.bzl` containing versions, archive URLs and hashes—including hashes for platform-specific downloaded `protoc` binaries. ([GitHub](https://github.com/envoyproxy/envoy/blob/main/bazel/repository_locations.bzl?utm_source=chatgpt.com)) Its separate dependency metadata records version and release date. ([GitHub](https://github.com/envoyproxy/envoy/blob/main/DEPENDENCY_POLICY.md)) |
| **Provide a maintainer-run updater** | A script takes the desired new version, resolves URLs/checksums/digests, rewrites files and leaves a diff for a human. | Docker Official Image repositories commonly have `versions.json`, `versions.sh`, `update.sh`, templates and `apply-templates.sh`; `update.sh` regenerates the derived Dockerfiles from the chosen versions. ([GitHub](https://github.com/docker-library/docker?utm_source=chatgpt.com)) |
| **Automate discovery, not acceptance** | A scheduled job may notice that something is old, but creates an issue/dashboard/failing check rather than changing the pin. | Envoy explicitly says existing dependencies are maintained on a best-effort basis, tracks available newer releases in its issue tracker, and asks a person doing the upgrade to claim the issue and associate their PR. ([GitHub](https://github.com/envoyproxy/envoy/blob/main/DEPENDENCY_POLICY.md)) Current examples are GitHub Actions opening “Newer release available …” *issues*, with no corresponding dependency PR. ([GitHub](https://github.com/envoyproxy/envoy/issues/43230?utm_source=chatgpt.com)) |
| **Encode why an unusual pin exists** | If it is a commit, old release, peculiar snapshot, or coordinated group of pins, leave the reason and the escape condition beside it. | Envoy requires a comment explaining use of a non-release SHA and has several pins annotated with “update together with…” or “update when next release…” notes. ([GitHub](https://github.com/envoyproxy/envoy/blob/main/DEPENDENCY_POLICY.md)) |
| **Move snapshot + package version together** | A dated archive is treated as part of the dependency identity, not as incidental infrastructure. | Cilium’s iptables image has both `IPTABLES_VERSION` and `SNAPSHOT_DATE`, with an explicit instruction that upgrading iptables means changing the snapshot date too. ([GitHub](https://github.com/cilium/image-tools/blob/main/images/iptables/Dockerfile?utm_source=chatgpt.com)) |
| **Make CI verify the chosen state** | CI verifies checksums, builds/tests the new pin, and catches inconsistent metadata; it doesn’t necessarily decide that “latest” is correct. | Envoy’s documented external-dependency update procedure is essentially “change the central entry, then run the test suite”; dependency changes also require dependency-shepherd review. ([GitHub](https://github.com/envoyproxy/envoy/blob/main/bazel/EXTERNAL_DEPS.md)) |

A particularly useful distinction is **freshness detection vs. mutation**. Envoy is a good example: machinery can tell maintainers “protobuf 36.1 exists; we have 35.1,” but that information becomes backlog state rather than an automatic source change. The human upgrade can then include compatibility work, coordinated dependency changes, patches, release-note review, and security judgment. ([GitHub](https://github.com/envoyproxy/envoy/issues/47111?utm_source=chatgpt.com))

The mature repos also spend effort making the *artifact itself* stable. Envoy explicitly prefers upstream-maintainer-produced release tarballs over GitHub-generated source archives because the latter's byte representation—and therefore SHA-256—can change when archive-generation implementation changes. ([GitHub](https://github.com/envoyproxy/envoy/blob/main/bazel/EXTERNAL_DEPS.md)) Docker Official Images similarly recommends verifying downloaded artifacts and notes that embedded checksums make unexpected remote changes turn into build failures rather than silently changing the build. ([GitHub](https://github.com/docker-library/official-images?utm_source=chatgpt.com)) For binaries from publishers that provide signed checksum manifests, verifying the signed manifest is stronger than simply copying a hash into the repository.

So, for a repository that wants this without Renovate/Dependabot-style PR traffic, I’d use something like:

```text
external/
  pins.yaml
tools/
  update-external
  verify-externals
```

`pins.yaml` would contain `name`, `version/tag`, immutable identity (`sha256`, image digest, commit or snapshot timestamp), source URL, perhaps `release_date`, and an optional `reason`/tracking issue. `update-external foo 1.8.0` would fetch upstream metadata, compute or verify the hash, rewrite the manifest, and print the diff. `verify-externals` would ensure downloads match their pins and that generated Dockerfiles/scripts are in sync. A weekly job could report stale pins as an issue or dashboard item, while **release/security work remains the thing that causes an actual change**.

That combination seems to be the durable middle ground: **automation removes the clerical work; maintainers retain control over when a reproducible build changes.**
