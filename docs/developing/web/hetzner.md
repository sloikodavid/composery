---
title: Hetzner Cloud
description: Provision and reset boxes on Hetzner Cloud, plus per-box snapshots and their retention.
---

Everything below is in the Hetzner Console (`console.hetzner.cloud`), inside the
project for this environment. Every Convex deployment **must** get its own
Hetzner project: the daily reconciliation cron (`convex/boxes/reconcile.ts`)
assumes it owns everything labeled `product=composery-web` in its project and
auto-deletes snapshot images it finds no `box_snapshots` row for, so a prod and
dev deployment sharing one project would destroy each other's snapshots. The
code manages servers (create, get, list, rebuild, delete, power on/off) and
deletes the Primary IPs attached to deleted boxes
(`convex/boxes/infra/hetznerVps.ts`); the API token, SSH key, and firewall are
created once in the console and referenced by id.

## Create the resources

1. **API token.** Create a project-scoped **Read & Write** API token in the
   project (Project -> Security -> API Tokens). Hetzner tokens are project-scoped
   with no finer-grained permissions. Copy it immediately - it is shown only
   once. -> `HETZNER_CLOUD_TOKEN`.

2. **SSH key.** Generate a dedicated keypair locally. The code constrains only
   two things, both from `convex/boxes/infra/ssh.ts`: the key must be a type
   `ssh2` can parse (RSA, ECDSA, or Ed25519, in OpenSSH or PEM form), and it
   **must have no passphrase** - the backend passes only
   `host`/`username`/`privateKey` to `ssh2`, so an encrypted key fails to
   authenticate. Algorithm is your choice; Ed25519 is the recommended default. A
   passphrase-less key is acceptable here because it is a dedicated, rotatable
   key whose value lives only as a Convex deployment secret and whose public half
   is trusted only on boxes you provision.

   ```bash
   mkdir -p ~/.ssh
   ssh-keygen -t ed25519 -C composery-ssh -f ~/.ssh/composery_ssh
   ```

   The first line creates `~/.ssh` if it does not exist yet; `ssh-keygen` fails
   with `No such file or directory` when the target directory is missing. When
   prompted for a passphrase, press Enter twice to leave it empty. Use a
   dedicated `-f` path so you do not overwrite your personal `id_ed25519`. This
   writes the private key to `~/.ssh/composery_ssh` and the public key to
   `~/.ssh/composery_ssh.pub`.
   - **Public key** -> add it as an SSH key in the Hetzner project (Project ->
     Security -> SSH Keys). Put that name or id in `HETZNER_SSH_KEY_IDS`
     (comma-separated for multiple); Hetzner injects it into every server it
     creates in this project. The backend also derives this same public key from
     `SSH_PRIVATE_KEY` and passes it as cloud-init `user_data` on server create
     and rebuild, so reset keeps SSH access even though Hetzner's rebuild action
     does not accept `ssh_keys`.
   - **Private key** -> `SSH_PRIVATE_KEY`, as a single line with each newline
     escaped as `\n` (the code reverses this with `.replace(/\\n/g, "\n")`).
     Produce that exact value and paste it into the Convex dashboard:

     ```bash
     awk '{printf "%s\\n", $0}' ~/.ssh/composery_ssh
     ```

   Keep `SSH_USER=root` unless the image's default login user differs. The
   backend uses this key for the whole box lifecycle (create, reset rebuild,
   bootstrap, password change, slug change), not just first setup.

   `HETZNER_SSH_KEY_IDS` only affects Hetzner's create-time injection. Existing
   running servers keep whatever was written into `authorized_keys`, while reset
   rebuilds install the public key derived from the current `SSH_PRIVATE_KEY`.
   During rotation, install and test the new public key on existing servers
   before replacing the Convex secret; changing the project key alone affects
   only new servers.

3. **Firewall.** Create a firewall in the Hetzner project (Project -> Firewalls).
   Add inbound rules allowing TCP **22**, **80**, and **443** plus **ICMP**, all
   from any IPv4 and IPv6 (sources `0.0.0.0/0` and `::/0`), and nothing else;
   define **no outbound rules** (in Hetzner firewalls, zero outbound rules means
   all outbound is allowed - adding any outbound rule flips outbound to
   default-deny). Read the
   numeric id from the firewall's URL -> `HETZNER_FIREWALL_ID`. Required:
   provisioning fails fast (`requiredEnv` in `convex/boxes/infra/hetznerVps.ts`)
   rather than create an unfirewalled, internet-exposed box.

   This firewall is the real boundary because box owners effectively control
   their host. Port 22 remains public because Convex has no fixed egress IP;
   cloud-init disables SSH passwords. ICMP is needed for path-MTU discovery.
   Leave `HETZNER_NETWORK_ID` empty: Hetzner firewalls do not filter private
   network traffic, so a shared network would let customer boxes bypass this
   isolation.

4. **Project id.** Read the numeric id from the project's console URL
   (`console.hetzner.cloud/projects/<id>/...`)
   -> `NEXT_PUBLIC_HETZNER_PROJECT_ID`. This is a frontend-plane var read by
   `lib/hetzner-dashboard.ts` so the staff console can deep-link a box to its
   Hetzner server; set it in the Next env (local `.env.local` and
   [Vercel](./vercel.md)), not on the Convex deployment. It is non-secret, so the
   console action simply hides itself when the id is absent.

## Provisioning and reset

The provisioning code labels servers `product=composery-web` and
`box_slug=<slug>`, creates public IPv4/IPv6, waits for running, then SSHes in and
bootstraps Docker Compose.

`HETZNER_BOX_SERVER_TYPES` and `HETZNER_BOX_LOCATIONS` are comma-separated,
preference-ordered lists (e.g. `cx23,cx33` and `nbg1,fsn1,hel1`); provisioning
tries every type x location combination in that order until one has capacity.
Both are optional and restricted to the values allowed in `convex/schema.ts` -
leaving them unset allows every supported type and location.

`HETZNER_BOX_IMAGE` must be `docker-ce` - Hetzner's Docker CE app image
(Ubuntu-based, Docker and the Compose plugin preinstalled), referenced by that
name on server create. Bootstrap relies on Docker already being present (it goes
straight to `docker compose ... pull` / `up` in `convex/boxes/infra/ssh.ts`); it
does not install Docker, so a plain Ubuntu image would fail. Using the app image
also cuts the slowest part of first boot - installing Docker - so the box reaches
a live URL a minute or so sooner. The runtime image itself is still pulled from
`RUNTIME_IMAGE` at provision time, so this changes nothing about what runs in
the box, only how fast the host is ready.

Reset rebuilds the existing Hetzner server from `HETZNER_BOX_IMAGE` instead of
deleting and creating a replacement. That still destroys the VPS disk and returns
the host OS to the base image, but it preserves the server and Primary IP
resources. Reset also re-resolves the deployment's current `RUNTIME_IMAGE` before
bootstrap, so a rebuilt box uses the runtime release configured on the active
[Convex](./convex.md) deployment. Box deletion deletes the server and then
explicitly deletes the recorded Primary IPs, with IP-string lookup as a fallback
for older boxes that do not yet have Primary IP IDs stored.

## Box snapshots

Box snapshots are point-in-time copies of a box's whole disk, captured as
Hetzner Cloud _Snapshots_ (`POST /servers/{id}/actions/create_image` with
`type: "snapshot"`) and restored by rebuilding the VPS from that image. The box
is not involved at all - Hetzner snapshots the disk at the hypervisor - so no
credential, encryption key, or pipeline lives on the box, and a box with full
root cannot read, list, overwrite, or delete its own snapshots. All snapshot API
calls are in `convex/boxes/infra/hetznerVps.ts`, alongside the rest of the
Hetzner client; row state and retention live in `convex/boxes/boxSnapshots.ts`.

There are **no new environment variables.** Snapshots reuse the existing
`HETZNER_CLOUD_TOKEN` already set above.

- **Retention is automatic.** The daily `deleteExpiredSnapshots` cron deletes
  each snapshot's Hetzner image **and** its Convex record together once it passes
  the per-class retention in `convex/boxes/snapshotPolicy.ts`: automatic
  snapshots, taken once a day, kept 5 days; manual snapshots kept 30 days;
  failed/stuck captures 1 day. The default caps are 5 automatic plus 5 manual
  snapshots per box.
- **Account snapshot limit.** Hetzner's default is 30 snapshots across all
  projects, not per project. Before the fleet can exceed that, request an
  account limit increase sized to roughly `box count × 10`. Hetzner Backups
  are a separate seven-slot-per-server product and are not implemented here.
- The runtime image needs nothing special for snapshots (no
  `age`/`zstd`/`curl` snapshot pipeline); it only needs what the lifecycle
  already requires.

See [Maintenance](./maintenance.md) for the cron schedule and snapshot polling
constants.

## References

- Hetzner Cloud API: https://docs.hetzner.cloud/reference/cloud
- Hetzner API tokens: https://docs.hetzner.com/cloud/api/getting-started/generating-api-token
- Hetzner firewalls: https://docs.hetzner.com/cloud/firewalls/faq/
- Hetzner backups and snapshots: https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/
