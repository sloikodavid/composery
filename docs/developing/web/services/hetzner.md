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

2. **SSH key.** Generate a dedicated keypair **per deployment**. Each Convex
   deployment must already have its own Hetzner project, and a Hetzner SSH key is a
   project resource, so dev and prod cannot share one registration anyway; using
   distinct keys also keeps a leaked dev key from reaching the prod fleet, since
   the private half is that deployment's trust root. The code constrains only
   two things, both from `convex/boxes/infra/ssh.ts`: the key must be a type
   `ssh2` can parse (RSA, ECDSA, or Ed25519, in OpenSSH or PEM form), and it
   **must have no passphrase** - the backend never supplies a `passphrase` to
   `ssh2` (`sshTarget` builds only `host`/`username`/`privateKey`), so an
   encrypted key fails to authenticate. Algorithm is your choice; Ed25519 is the recommended default. A
   passphrase-less key is acceptable here because it is a dedicated, rotatable
   key whose value lives only as a Convex deployment secret and whose public half
   is trusted only on boxes you provision.

   ```bash
   mkdir -p ~/.ssh
   ssh-keygen -t ed25519 -C composery-web-dev -f ~/.ssh/composery_web_dev
   ssh-keygen -t ed25519 -C composery-web-prod -f ~/.ssh/composery_web_prod
   ```

   The first line creates `~/.ssh` if it does not exist yet; `ssh-keygen` fails
   with `No such file or directory` when the target directory is missing. When
   prompted for a passphrase, press Enter twice to leave it empty. Use a
   dedicated `-f` path so you do not overwrite your personal `id_ed25519`. This
   writes each private key to `~/.ssh/composery_web_<env>` and each public key to
   `~/.ssh/composery_web_<env>.pub`. The `-C` comment is local bookkeeping only:
   `authorizedPublicKey()` in `convex/boxes/infra/sshKeys.ts` rebuilds the public
   line from the private key with a fixed `composery-web` comment, so the same
   text lands in `authorized_keys` whatever you name the key. Change a comment
   later with `ssh-keygen -c -C <comment> -f <keyfile>`, which rewrites it in
   place and leaves the key material - and therefore every existing box's trust -
   untouched.

   Run the rest of this step once per deployment, pairing each environment's key
   with that environment's Hetzner project and Convex deployment.
   - **Public key** -> add it as an SSH key in that environment's Hetzner project
     (Project -> Security -> SSH Keys). Put that name or id in `HETZNER_SSH_KEYS`
     (comma-separated for multiple). The name is the practical choice - it is what
     the console shows, and `splitKeyRefs` passes any non-numeric entry through for
     Hetzner to resolve by name. The catch is that renaming the key in the console
     then breaks server creation until this value is updated to match. The numeric
     id survives renames but is not shown in the console, which lists SSH keys
     without per-key pages; read it from the API instead:

     ```bash
     curl -s -H "Authorization: Bearer $HETZNER_CLOUD_TOKEN" \
       https://api.hetzner.cloud/v1/ssh_keys
     ```

     Whichever form you use, Hetzner injects that key into every server it
     creates in this project. The backend also derives this same public key from
     `SSH_PRIVATE_KEY` and passes it as cloud-init `user_data` on server create,
     reset, and snapshot restore. Hetzner added `user_data` to its rebuild API;
     sending the current value on every rebuild keeps control-plane access from
     depending only on the key selected when the server was first created.

   - **Private key** -> `SSH_PRIVATE_KEY`, as a single line with each newline
     escaped as `\n` (the code reverses this with `.replace(/\\n/g, "\n")`).
     Produce that exact value and paste it into the Convex dashboard:

     ```bash
     awk '{printf "%s\\n", $0}' ~/.ssh/composery_web_dev
     ```

   Keep `SSH_USER=root` unless the image's default login user differs. The
   backend uses this key for the whole box lifecycle and recovery channel, not
   as customer-facing SSH access. The private key and `HETZNER_CLOUD_TOKEN` are
   both Convex deployment secrets; that deployment is therefore the fleet trust
   root. A box only receives the public key, and SSH agent forwarding is not
   used.

   `HETZNER_SSH_KEYS` only affects Hetzner's create-time injection. Existing
   running servers keep whatever was written into `authorized_keys`, while reset
   rebuilds install the public key derived from the current `SSH_PRIVATE_KEY`.
   During rotation, install and test the new public key on existing servers
   before replacing the Convex secret, update `HETZNER_SSH_KEYS` for new
   servers, and treat revocation of a compromised key as fleet maintenance.
   Hetzner remembers keys selected at server creation and can inject them again
   during a rebuild, so replacing a Convex secret alone does not prove the old
   key has been removed from every existing server.

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

### Resource limits and paid checkout

Hetzner's published values such as 5 servers and 30 snapshots are **starting
defaults, not fixed product ceilings and not this deployment's capacity**. The
approved limits for the account are shown on the Hetzner Console **Limits** tab
and can be increased by `Request change` -> `Limit increase`. Never copy either
published default into application code.

The documented project API can list resources but does not expose the account's
approved maximums. Some limits also span projects. In `/console`, an admin must
therefore enter the server and snapshot **allocation for this deployment**. If
dev and prod share one Hetzner account, their allocations must sum to no more
than the account's approved limits. Checkout fails closed until both values are
set. See [Operations](../operations.md#capacity-and-paid-checkout) for the exact
commitment math and incident procedure.

The allocation prevents locally known commitments from exceeding the operator's
plan; it cannot promise that Hetzner will accept a create. Hetzner's response is
authoritative:

- `403 resource_limit_exceeded` means the approved account quantity was reached.
- `412 resource_unavailable` and action failures cover dynamic plan/location
  availability. Hetzner documents that a best-effort availability check can
  still be followed by a failed allocation.
- Composery tries alternative configured type/location candidates for dynamic
  capacity failures. An account-level quota failure skips the pointless
  placement loop and switches the separate global checkout toggle off so later
  customers cannot pay while the provider is known to reject resources. The
  workflow for the already-paid order still retries before declaring
  provisioning terminal.

A customer can still finish Polar checkout just before provider capacity
disappears. Every active checkout reserves a complete package in Composery's
local accounting—one server plus the configured per-box snapshot entitlement—but
it does not create or hold a Hetzner resource before payment. If initial
provisioning still fails, Composery revokes the Polar subscription, refunds the
full remaining refundable amount of the paid order, and runs normal box
deletion. A partially created VPS is included in that cleanup. See
[Polar](./polar.md#billing-and-box-lifecycle).

Operationally, check the Limits tab and request increases with lead time; Hetzner
says requests are manually reviewed during business hours. After an increase,
verify it, update the deployment allocation(s), and re-enable checkout if the
circuit breaker paused it. Raising only the Composery number does not raise the
provider limit. Dynamic location/plan unavailability does not trip this switch;
Composery continues through the configured placement candidates instead.

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

Daily reconciliation automatically deletes untracked Composery snapshot images
after a 2-hour grace period. It deliberately does **not** auto-delete an
untracked server: a database tracking bug could otherwise destroy a live box.
It logs the server and sends a deduplicated Resend staff alert for review. Normal
subscription/account deletion and failed-initial-delivery cleanup use the
tracked delete workflow and do remove the server automatically.

The owner and staff box pages share one Recovery dialog. Its checks cover the
public URL, the internal SSH control channel, host disk and Docker, both Caddy
layers, the Composery container, persistence, and `ide.service`. Its
non-destructive actions restart inner services, recreate containers from the
current host configuration, reboot the VPS, or restore the Composery-managed
files in `/opt/composery-web` from Convex state before recreating containers.
That last action reuses the same artifact renderers as provisioning; there is no
separate recovery seed to drift. All four retain the named Docker volumes. Full
reset remains the final, explicitly destructive option and does not delete
existing snapshots.

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
- **Provider snapshot quota.** The active approved value is whatever the
  Hetzner Limits tab says, not the published 30 starting default. The deployment
  allocation reserves every live box's full manual plus automatic entitlement,
  including unused slots, before admitting new checkout. The API can still
  report `resource_limit_exceeded`; that snapshot operation fails, checkout is
  paused as a circuit breaker, and staff reconcile the allocation/provider
  limit before retrying. It does not cancel the running box or refund its
  subscription. Hetzner Backups are a separate seven-slot-per-server product
  and are not implemented here.
- The runtime image needs nothing special for snapshots (no
  `age`/`zstd`/`curl` snapshot pipeline); it only needs what the lifecycle
  already requires.

See [Maintenance](../maintenance.md) for the cron schedule and snapshot polling
constants.

## References

- Hetzner Cloud API: https://docs.hetzner.cloud/reference/cloud
- Hetzner resource limits and increase requests: https://docs.hetzner.com/cloud/general/faq/#are-there-limits-to-the-number-of-resources-i-can-get
- Hetzner server allocation and limits: https://docs.hetzner.com/cloud/servers/faq/#how-many-servers-can-i-create
- Hetzner API tokens: https://docs.hetzner.com/cloud/api/getting-started/generating-api-token
- Hetzner firewalls: https://docs.hetzner.com/cloud/firewalls/faq/
- Hetzner backups and snapshots: https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/
