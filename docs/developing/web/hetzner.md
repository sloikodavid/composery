---
title: Hetzner Cloud
description: Provision and reset boxes on Hetzner Cloud, plus per-box snapshots and their retention.
---

Everything below is in the Hetzner Console (`console.hetzner.cloud`), inside the
project for this environment. Use separate projects for dev and production if
possible. The code manages servers (create, get, list, rebuild, delete, power
on/off) and deletes the Primary IPs attached to deleted boxes
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

   When rotating the key for an existing box, do it in this order so you do not
   lock the backend out of the VPS:
   1. Add the new public key to `/root/.ssh/authorized_keys` on every existing
      server while the old key still works.
   2. Test `ssh -i ~/.ssh/composery_ssh root@<server-ip>` from your machine.
   3. Replace `SSH_PRIVATE_KEY` in the matching [Convex](./convex.md) deployment
      with the new private key, and point `HETZNER_SSH_KEY_IDS` at the matching
      Hetzner project key for future servers.
   4. Only after the new login works, remove the old public key from
      `/root/.ssh/authorized_keys` and delete the old local keypair.

   `HETZNER_SSH_KEY_IDS` only affects Hetzner's create-time injection. Existing
   running servers keep whatever was written into `authorized_keys`, while reset
   rebuilds install the public key derived from the current `SSH_PRIVATE_KEY`.
   Changing the Hetzner project key alone is not a rotation.

3. **Firewall.** Create a firewall in the Hetzner project (Project -> Firewalls).
   Add inbound rules allowing TCP **22**, **80**, and **443** from any IPv4 and
   IPv6 (sources `0.0.0.0/0` and `::/0`); leave outbound open. Read the numeric
   id from the firewall's URL -> `HETZNER_FIREWALL_ID`. Required: provisioning
   fails fast (`requiredEnv` in `convex/boxes/infra/hetznerVps.ts`) rather than
   create an unfirewalled, internet-exposed box.

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
  snapshots, taken once a day, kept 7 days (~7 automatic images per box); manual
  snapshots kept 30 days; failed/stuck captures 1 day. A per-box hard cap (15)
  evicts the oldest automatic snapshot when a new one would exceed it - never a
  manual one - so image count stays bounded.
- **Operational prerequisite - the per-project snapshot limit.** Hetzner caps
  the number of snapshots per project (Console -> project -> **Limits** tab ->
  **Request change**, reviewed manually). With a fleet this binds fast: roughly
  `max_boxes × per-box cap` images. **Before enabling fleet-wide automatic
  snapshots, request a snapshot-limit increase sized to that product.** If
  Hetzner will not grant enough, the fallback is Hetzner _Backups_
  (`enable_backup`, 7 per server, not project-capped) - a different feature with
  a flat 20%-of-server-price cost and "backup" terminology, not implemented here.
- The runtime image needs nothing special for snapshots (no
  `age`/`zstd`/`curl` snapshot pipeline); it only needs what the lifecycle
  already requires.

See [configuration](./configuration.md) for the cron schedule and snapshot polling
constants.

## References

- Hetzner Cloud API: https://docs.hetzner.cloud/reference/cloud.
- Hetzner API tokens: https://docs.hetzner.com/cloud/api/getting-started/generating-api-token.
