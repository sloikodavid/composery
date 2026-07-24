# Overlay-root feasibility spike — findings

Can Composery boot with its root filesystem as an overlayfs whose upper lives on the
`/data` volume, letting the kernel maintain the delta the userspace persistence daemon
maintains today?

**Verdict: GO**, with three hazards the entrypoint must handle. Every claim below is
produced by a script in this directory, run against Docker 29.6.1 (Linux, cgroup v2)
with the production container flags from `renderCompose()`
(`packages/web/convex/boxes/infra/runtimeArtifacts.ts`): `--privileged`, host cgroup
namespace, `/sys/fs/cgroup` rw, tmpfs `/run` `/run/lock` `/tmp`, `SIGRTMIN+3`, volume
at `/data`.

| # | Question | Verdict |
| --- | --- | --- |
| 1 | Pivot + systemd boot (incl. nested lowerdir) | **WORKS** |
| 2 | Reserved upper subtree coexisting with user files on `/data` | **WORKS WITH CAVEATS** |
| 3 | Persistence across container recreate | **WORKS** |
| 4 | Upgrade semantics (new lower, same upper) | **WORKS WITH CAVEATS** — 2 hazards |
| 5 | Unprivileged failure shape (the probe signal) | **WORKS** |
| 6 | Inner Docker | **WORKS** |
| 7 | Practical notes | partial — see below |

## Q1 — Pivot + systemd boot: WORKS

`01-pivot-boot.sh` mounts the overlay, moves `/proc /sys /dev /run /tmp /data` into the
merged tree, `pivot_root`s, and execs `/lib/systemd/systemd` as PID 1. Both lower modes
work — `direct` (`lowerdir=/`, i.e. the container's own Docker overlay used directly as
a lower) and `bind` (read-only bind of `/` staged first):

```
--- root is the overlay we built (upper on the volume): ---
overlay-spike overlay
--- journald + sample unit active: ---
systemd-journald: active
overlay-spike-sample: active
RESULT[direct]: booted; stop took 0s; exit code 130; orderly=yes
RESULT[bind]:   booted; stop took 1s; exit code 130; orderly=yes
```

**Nested overlay is fine.** The kernel accepts an overlayfs mount as `lowerdir` on this
host; no `redirect_dir`/`metacopy` tuning was needed. `direct` is simpler and is the
recommended mode.

`systemctl is-system-running` reports `degraded` in both cases — solely because
`systemd-modules-load.service` cannot load kernel modules in a container. That is
equally true of a normal container boot and is not caused by the overlay.

Shutdown is orderly: the sample unit's `ExecStop` marker (written to the volume, so it
can only appear if systemd really ran shutdown) is present after `docker stop`, and the
container exits 130 (systemd's container-poweroff code).

## Q2 — Reserved upper subtree: WORKS WITH CAVEATS

`02-reserved-upper.sh`. Upper/work at `/data/persistence/overlay/{upper,work}` coexist
with ordinary user files elsewhere on the same volume; both survive a recreate:

```
  user file: user notes      user db: db state      user blob: 8.0M preserved
  rootfs delta: edited-by-user
```

**HAZARD A — the live upper is reachable and writable from inside the merged root.**
`/data` is bind-mounted into the pivoted tree, so `/data/persistence/overlay/upper` is
visible to any root process in the box. Modifying an upper of a *mounted* overlay is
explicitly undefined behaviour, and the experiment shows a write there changing the
merged view immediately:

```
  merged /etc/oob.txt before out-of-band write: original
  merged /etc/oob.txt after  out-of-band write: tampered  (undefined; do not rely on either)
```

Per the repo's own boundary rule (the container is not a boundary against its owner)
this is not a security hole — but it *is* a corruption footgun, and the copy engine has
the same exposure today. Mitigation is documentation plus keeping the reserved subtree
out of the persisted set, not a permission trick.

## Q3 — Persistence across recreate: WORKS

`03-persistence.sh`. After mutating the rootfs, destroying the container, and re-running
on the same volume:

```
  CREATE /etc/created-by-user.conf : created
  CREATE /usr/local/share/myapp    : hi
  MODIFY /usr/share/overlay-spike-marker : MODIFIED from-image-v1
  DELETE /etc/overlay-spike-lower  : gone-via-whiteout
  UNTOUCHED /etc/os-release id     : debian trixie (from image lower)
```

Deletions are recorded as classic overlayfs whiteouts (`c--------- 0,0` char devices) on
the ext4 named volume, and `trusted.overlay.*` xattrs work there — the two filesystem
capabilities the engine depends on.

## Q4 — Upgrade semantics: WORKS WITH CAVEATS (the go/no-go item)

`04-upgrade.sh` builds v1, lets a user mutate `/opt/upg`, then boots **v2 (new lower) on
v1's upper**. The happy paths hold — this is the documented upgrade promise, delivered by
the kernel instead of a re-apply pass:

```
  [OK] untouched.txt   -> v2 (new lower wins; upgrade delivered)
  [OK] user-edits.txt  -> mine-edit (upper wins over new lower; edit kept)
  [OK] only-in-v2.txt  -> v2-only (brand-new lower file appears)
```

Two real hazards, both caused by upper records that outlive the lower they were made
against:

```
  [HAZARD] reintroduced.txt -> SHADOWED by stale whiteout though v2 ships it
  [HAZARD] pkgdir/b.txt     -> HIDDEN by opaque dir though v2 added it
  [HAZARD] pkgdir/a.txt (v2 changed it) -> HIDDEN by opaque dir
```

**HAZARD B — stale whiteout.** A user deletes a file; a later image reintroduces or
renames one into that path; the whiteout keeps hiding it forever. Practical impact: an
upgrade that adds back a config, unit, or binary at a path the user once removed appears
to "not install".

**HAZARD C — opaque directory.** A user replaces a directory (making it opaque); every
file the new image later adds inside it is invisible, including changes to files the user
never touched.

Neither is fatal, and note the copy engine has the *same* semantics by design (a removed
path stays removed). The difference is that overlayfs applies them with no chance to
notice. The engine therefore needs a **boot-time upper-hygiene pass**: before mounting,
walk the upper's whiteouts and opaque markers, compare against the new lower, and
reconcile — at minimum report them, ideally drop whiteouts whose lower counterpart is
newly (re)introduced by an image bump. This is bounded work proportional to the number of
deletions, not to the filesystem size, and it is where the image's build-time baseline
stays useful.

## Q5 — Unprivileged failure shape: WORKS (clean probe signal)

`05-unprivileged.sh`. Without `CAP_SYS_ADMIN` the overlay mount fails at `fsopen()` with
`EPERM`, `mount(8)` exit 32; the same probe privileged succeeds:

```
mount exit=32
8: libmount: CXT: syscall 'fsopen' [failed: Operation not permitted]
mount: /tmp/merged: permission denied.
--- PRIVILEGED contrast ---
mount exit=0   fsopen [success] fsmount [success] move_mount [success]
```

A one-shot mount attempt in a scratch dir is a reliable, cheap engine selector — probe by
*doing*, matching the existing `capabilities.rs` pattern. The full entrypoint run
unprivileged dies at its first mount op (exit 32), so `auto` must probe *before*
committing to the overlay path, and an explicit `COMPOSERY_PERSISTENCE=overlay` pin must
fail loudly rather than half-boot.

## Q6 — Inner Docker: WORKS

`06-inner-docker.sh`, both configurations, containers actually run:

```
  case default: storage driver: fuse-overlayfs   data-root: /var/lib/docker   inner container ran: YES
  case datavol: storage driver: overlay2         data-root: /data/docker      inner container ran: YES
```

With the default data-root, dockerd tries `overlay2`, gets `failed to mount overlay:
invalid argument` (overlay-on-overlay), and falls back to `fuse-overlayfs` — exactly what
production shows today. Pointing `data-root` at `/data` (real ext4) gives **native
overlay2**, which is both faster and keeps container layers off the delta entirely.
Recommend documenting that as the guidance for boxes that run Docker; it is a
recommendation, not a requirement.

**HAZARD D — runtime-injected files are lost at pivot (found here, fixed in the
prototype).** Docker injects `/etc/resolv.conf`, `/etc/hosts` and `/etc/hostname` as
individual *file* bind mounts on the old root. They are invisible through the overlay
lower, so before the fix the pivoted system had an empty `resolv.conf` and **no DNS at
all** — inner Docker could not reach any registry, and neither could the user. The
entrypoint now rebinds those three files into the merged tree; after the fix
`resolv.conf` carries the real nameserver, `/etc/hostname` is the container id, and pulls
work. These are precisely the three files `docs/persistence.md` already lists as
runtime-managed and never persisted.

## Q7 — Practical notes: partial

Observed while running the above, not separately measured:

- Boot overhead is not perceptible at this image size (mount + rebinds + pivot are a
  handful of syscalls); it was **not** benchmarked against the full Composery image, and
  the honest comparison is against today's `persistence apply`, which the overlay engine
  removes entirely.
- Whiteouts and `trusted.overlay.*` xattrs work on a Docker named volume (ext4). A volume
  on a filesystem without xattrs (NFS is already unsupported) would break the engine —
  the probe must therefore test *on the actual upper location*, not in `/tmp`.
- `work/` must be recreated at boot: a hard-killed container leaves it dirty. The
  prototype does this and it is required, not hygiene.
- Mount propagation must be made private (`mount --make-rprivate /`) before pivoting, or
  moves escape to the host and `pivot_root` refuses to run.
- No AppArmor/SELinux interference observed on this host; untested under enforcing SELinux
  (RHEL-family hosts), which stays OPEN.

## Recommendation

**GO.** The mechanics hold: overlay root boots systemd, survives recreate, delivers image
upgrades with user edits intact, degrades detectably when unprivileged, and keeps inner
Docker working. What the production entrypoint must do, in order:

1. Probe by attempting a real overlay mount **with the upper on the actual volume**; fall
   back to the copy engine on `EPERM`/any failure under `auto`, fail loudly under an
   explicit `overlay` pin.
2. Recreate `work/` every boot; never reuse it.
3. `mount --make-rprivate /` before any move.
4. Rebind `/proc /sys /dev /run /tmp`, the data volume, **and** `/etc/resolv.conf`,
   `/etc/hosts`, `/etc/hostname` (Hazard D) into the merged tree before pivoting.
5. Run an upper-hygiene pass against the new lower for stale whiteouts and opaque
   directories (Hazards B and C), reporting what it reconciles.
6. Document that the reserved upper subtree must never be written out-of-band (Hazard A),
   and recommend inner Docker's `data-root` on `/data` for native overlay2.

Not verified: enforcing SELinux hosts; Fly.io microVM overlay availability; behaviour on a
volume filesystem lacking xattrs; boot overhead against the real Composery image.
