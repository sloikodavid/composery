# Setup

This runbook starts from a fresh clone and ends with a working local dev setup
against the cloud dev backend, plus production. Sections are ordered by
dependency: do them top to bottom and you never have to jump forward for a value.
It also covers the external dashboard and CLI state that is not committed because
`.env*`, `.vercel/`, `.clerk/`, build output, and dependencies are ignored.

The project uses:

- Next.js on Vercel for the web app.
- Convex for backend functions, database, HTTP actions, crons, auth config, and
  the `@convex-dev/polar` and `@convex-dev/workflow` components.
- Clerk for authentication.
- Polar for subscription checkout, subscription state, and customer portal.
- Hetzner Cloud for per-box VPS provisioning.
- Cloudflare DNS for per-box `A` and `AAAA` records.
- A public runtime container image, normally hosted on GHCR, pulled by each box.
- Caddy inside each box for automatic HTTPS.
- Hetzner Cloud snapshots for per-box restore points.

There is no separate Layer, Headless, or Poller service in the tracked code as
of this document. Periodic work is handled by Convex crons.

## Environment model

This is a solo project with two long-lived backends and no preview/staging tier:

| Purpose     | Git branch | Vercel                | Convex                | Clerk                      | Polar            | Infra                                          |
| ----------- | ---------- | --------------------- | --------------------- | -------------------------- | ---------------- | ---------------------------------------------- |
| Development | local only | `pnpm run dev`        | dev deployment        | development Clerk instance | Polar sandbox    | dev Hetzner project and Cloudflare namespace   |
| Production  | `main`     | Production deployment | production deployment | production Clerk instance  | Polar production | production Hetzner project and Cloudflare zone |

**There are two config planes.** Environment variables split by who reads them,
and they are set in different places:

- _Frontend env_ is read by Next.js. It lives in `.env.local` for local work and
  in Vercel Production for the deployed site:
  - `CONVEX_DEPLOYMENT` (read only by the Convex CLI to pick a deployment)
  - `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`.
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`.
  - `CLERK_SECRET_KEY`.
  - `CLERK_AUTHORIZED_PARTIES` (read in `proxy.ts`)
  - `NEXT_PUBLIC_POLAR_ENVIRONMENT`, `NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG` (read in
    `lib/polar-dashboard.ts` for the staff console's Open in Polar links)
  - `NEXT_PUBLIC_HETZNER_PROJECT_ID` (read in `lib/hetzner-dashboard.ts` for the
    staff console's Open in Hetzner links)
- _Convex deployment env_ is read by Convex functions, actions, auth config, HTTP
  actions, and crons. A human sets it per deployment in the Convex dashboard
  (Deployment Settings -> Environment Variables); it lives on the deployment, not
  on your machine:
  - `CLERK_FRONTEND_API_URL` (read in `convex/auth.config.ts`)
  - `WEBSITE_ORIGIN`, `CLOUD_DOMAIN` (read in `convex/env.ts`)
  - all `POLAR_*` (`convex/billing/polar.ts`), `HETZNER_*` and `SSH_*`
    (`convex/boxes/infra/`), `CLOUDFLARE_*`, `RUNTIME_IMAGE`, `RUNTIME_PORT`.

Putting a Convex deployment var in `.env.local` does nothing at runtime. It only
takes effect once set on the deployment.

Domain split:

- Production website: `https://www.composery.io` (used for checkout success URLs).
- Production runtime boxes: `https://<slug>.composery.cloud`.
- Development website: `http://localhost:3000`.
- Development runtime boxes: `https://<slug>.dev.composery.cloud` (only if you
  provision in dev; see Cloudflare).

`WEBSITE_ORIGIN` is a full origin (scheme + host, plus a port in dev) because it
builds website URLs and dev runs on `http://localhost:3000`. `CLOUD_DOMAIN` is a
bare host because it is only ever a DNS suffix in `<slug>.<CLOUD_DOMAIN>`. They
are different things, not two spellings of the same domain.

## Order of operations

The dependency chain is why the sections are ordered this way:

1. **Create the Convex deployments first.** Their URLs must exist before other
   steps: the Polar webhook targets `CONVEX_SITE_URL`, and Clerk's JWT is issued
   for the Convex deployment.
2. **Set up each provider** (Clerk, Polar, Hetzner, Cloudflare, runtime image).
   Each step says exactly which value/variable it produces. Collect them as you
   go; some need the Convex URLs from step 1.
3. **Enter the collected values into the Convex deployment env** (dashboard), per
   deployment. By now you have every value in hand.
4. **Configure Vercel** (frontend env, production deploy key, build settings) and
   deploy.

## Prerequisites

Install or confirm these tools locally:

```bash
node --version
pnpm --version
vercel --version
```

Requirements:

- Node.js `>=20.9.0`. Node 22 LTS is fine.
- pnpm. This repo was verified with pnpm `11.5.0`.
- Vercel CLI.
- Access to the Vercel team/project, Convex team/project, Clerk apps, Polar
  organization, Hetzner Cloud project, Cloudflare zone, and container registry.

From a fresh clone:

```bash
git clone https://github.com/sloikodavid/composery-web.git
cd composery-web
corepack enable
pnpm install
cp .env.example.next.dev .env.local
```

## Convex deployments

One Convex project holds two deployments: a dev deployment you push to from your
logged-in CLI, and a production deployment Vercel pushes to with a `prod:` key.
Create them now; you set their env vars later, after the provider steps.

Create or select the project and the dev deployment:

```bash
pnpm exec convex dev --once
```

The first run creates or links the project and writes `CONVEX_DEPLOYMENT` and
`NEXT_PUBLIC_CONVEX_URL` for the dev deployment into `.env.local`. It may warn
that env vars are unset - expected; you set them in **Set Convex environment
variables** below.

Note each deployment's two URLs (Convex dashboard -> the deployment -> Settings):

- `CONVEX_CLOUD_URL` - client URL, same as `NEXT_PUBLIC_CONVEX_URL`. Also goes in
  `.env.local` as `NEXT_PUBLIC_CONVEX_SITE_URL`'s sibling for reference.
- `CONVEX_SITE_URL` - HTTP Actions URL, e.g. `https://<name>.convex.site`. You
  need it for the Polar webhook (`<CONVEX_SITE_URL>/polar/events`).

Create the production deploy key: Deployment Settings -> production deployment ->
Generate Production Deploy Key. It starts with `prod:`; you paste it into Vercel
later. You do not need a deploy key locally (`convex dev` uses your CLI login),
and you do not need a preview deploy key.

## Clerk

Create separate Clerk instances for development and production. The development
instance works out of the box on `*.clerk.accounts.dev` with `pk_test`/`sk_test`
keys. The production instance requires a custom Clerk domain
(`clerk.<your-domain>`, set up via DNS) before it issues `pk_live`/`sk_live` keys
and a production Frontend API URL.

For each Clerk instance:

1. Enable the **Convex integration**: in the Clerk dashboard open the Convex
   integration setup (`dashboard.clerk.com/apps/setup/convex`) and Activate it.
   This provisions the JWT template named `convex` that the app depends on
   (`getToken({ template: "convex" })`, and `applicationID: "convex"` in
   `convex/auth.config.ts`) and reveals the Frontend API URL used below. The
   integration adds `aud: "convex"` to the **default session token**, so
   `ConvexProviderWithClerk` sends that token directly and bypasses the `convex`
   JWT template on the browser path (convex-js#145). Because the backend reads
   `identity.email` via `emailFromIdentity` (`convex/authorization.ts`) to record
   the user and create Polar checkouts, add the `email` claim to the **session
   token**, not just the template: open **Configure -> Sessions -> Customize
   session token** and add `{ "email": "{{user.primary_email_address}}" }` to the
   Claims. Without it, client-initiated checkout fails on an empty email.
2. Collect these values:
   - **Publishable key** -> `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (frontend plane).
   - **Secret key** -> `CLERK_SECRET_KEY` (frontend plane; full backend access,
     keep it to Vercel Production and local `.env.local`).
   - **Frontend API URL** -> `CLERK_FRONTEND_API_URL` (Convex plane; the JWT
     issuer that `convex/auth.config.ts` validates). It looks like
     `https://verb-noun-00.clerk.accounts.dev` in dev and `https://clerk.<your-domain>`
     in production.
3. `NEXT_PUBLIC_CLERK_SIGN_IN_URL` is `/sign-in` in both.
4. `CLERK_AUTHORIZED_PARTIES` (read in `proxy.ts`) is the exact website origins
   that may serve the app, comma-separated, no paths: `http://localhost:3000`
   for local, `https://www.composery.io` for production. Production canonicalizes
   on `www`: the apex `composery.io` redirects to `https://www.composery.io`, so
   only the `www` origin ever serves the app and only it is listed here. If the
   apex served the app directly it would also need listing, and a visitor on the
   un-redirected apex would be treated as signed-out.

**Production custom domain (DNS and SSL).** The development instance needs no DNS

- it runs on `*.clerk.accounts.dev`. The production instance does: open the.
  production instance's **Domains** page in the Clerk dashboard and add the five
  `CNAME` records it lists, on whatever DNS provider hosts `composery.io` (the
  registrar or wherever the website domain's nameservers point). This is a separate
  DNS surface from the Cloudflare `composery.cloud` zone in the Cloudflare section;
  nothing about boxes touches `composery.io`. The records, host on the left:

| Host (under `composery.io`) | Type    | Target                        |
| --------------------------- | ------- | ----------------------------- |
| `clerk`                     | `CNAME` | `frontend-api.clerk.services` |
| `accounts`                  | `CNAME` | `accounts.clerk.services`     |
| `clkmail`                   | `CNAME` | `mail.<id>.clerk.services`    |
| `clk._domainkey`            | `CNAME` | `dkim1.<id>.clerk.services`   |
| `clk2._domainkey`           | `CNAME` | `dkim2.<id>.clerk.services`   |

`clerk` and `accounts` have stable targets; the `clkmail` and two `_domainkey`
targets embed an instance-specific id (shown as `<id>`), so copy those three
exactly from the dashboard rather than from this table. `clerk` is the Frontend
API host that becomes `CLERK_FRONTEND_API_URL` (`https://clerk.composery.io`);
`accounts` is the hosted account portal; `clkmail` and the two `_domainkey`
records authorize Clerk to send transactional email (verification, password
reset) as the domain. The dashboard shows each record as `Unverified` until its
target resolves, and DNS propagation can take minutes to hours - re-run the
dashboard's verification after the records are live.

Clerk issues the SSL certificates itself once all five records resolve; there is
no manual certificate step. Until every record verifies, the domain and certs
stay `Pending`, and the production `pk_live`/`sk_live` keys and Frontend API URL
are not usable - so do this before you collect the production Clerk values above.

`CLERK_FRONTEND_API_URL` is the one Convex var required at deploy time (see **Set
Convex environment variables**), so make sure you have it for each instance.

The local `.clerk/` directory is ignored and may hold keyless-mode secrets. Do
not depend on it; use real keys and the `convex` JWT template for both instances.

## Polar

Use the Polar sandbox (`sandbox.polar.sh`) for development and Polar production
(`polar.sh`) for production. Set up each the same way; sandbox values go on the
dev Convex deployment, production values on the prod deployment.

1. Create or select the organization.
2. Create an Organization Access Token (Settings -> Developers -> New Token) with
   these scopes (required by `@convex-dev/polar`):
   - `products:read`, `products:write`.
   - `subscriptions:read`, `subscriptions:write`.
   - `customers:read`, `customers:write`.
   - `checkouts:read`, `checkouts:write`.
   - `checkout_links:read`, `checkout_links:write`.
   - `customer_portal:read`, `customer_portal:write`.
   - `customer_sessions:write`.

   Copy it -> `POLAR_ORGANIZATION_TOKEN`. Set `POLAR_ENVIRONMENT=sandbox` for dev
   or `production` for prod; it selects which Polar API the component talks to and
   is the one Polar value with a fail-safe default of `sandbox`
   (`convex/billing/polar.ts`).

3. Create the Box product: Products -> Create Product. Give it a name, add a
   recurring **monthly** price, and save. Open the product and copy its **Product
   ID** (not the price ID) -> `POLAR_BOX_PRODUCT_ID`. The code keys off the
   product id (`products.box` in `convex/billing/polar.ts`). This is a
   per-deployment env var, not a hardcoded id, because the sandbox and production
   Box products have different ids.
4. Create a webhook: Settings -> Webhooks -> Add Endpoint. Set the URL to the
   matching deployment's `<CONVEX_SITE_URL>/polar/events` (the Site URL from the
   Convex step). Copy the signing secret -> `POLAR_WEBHOOK_SECRET`. Enable:
   - App logic: `subscription.active`, `subscription.revoked`, `checkout.updated`,
     `checkout.expired`.
   - Component sync: `product.created`, `product.updated`, `subscription.created`,
     `subscription.updated`.

5. Copy the organization **slug** (Settings -> Organization, the handle shown in
   your dashboard URL) -> `NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG`, and set
   `NEXT_PUBLIC_POLAR_ENVIRONMENT` to `sandbox` (dev) or `production` (prod).
   These are frontend-plane vars read by `lib/polar-dashboard.ts` so the staff
   console can deep-link a box to its Polar customer and subscription; set them
   in the Next env (local `.env.local` and Vercel), not on the Convex deployment.
   They are non-secret, so the console action simply hides itself when the slug is
   absent.

Checkout success URLs are built from `WEBSITE_ORIGIN`, so that var on the same
Convex deployment must point at the matching website before you test checkout.

## Hetzner Cloud

Everything below is in the Hetzner Console (`console.hetzner.com`), inside
the project for this environment. Use separate projects for dev and production if
possible. The code manages servers (create, get, list, rebuild, delete, power
on/off) and deletes the Primary IPs attached to deleted boxes
(`convex/boxes/infra/hetznerVps.ts`); the API token, SSH key, and firewall are
created once in the console and referenced by id.

1. **API token.** Project -> **Security** -> **API Tokens** tab -> **Generate API
   Token**. Add a description, choose **Read & Write** (Hetzner tokens are
   project-scoped with no finer-grained permissions), Generate, and copy it
   immediately - it is shown only once. -> `HETZNER_CLOUD_TOKEN`.
2. **SSH key.** Generate a dedicated keypair locally. The code constrains only two
   things, both from `convex/boxes/infra/ssh.ts`: the key must be a type `ssh2`
   can parse (RSA, ECDSA, or Ed25519, in OpenSSH or PEM form), and it **must have
   no passphrase** - the backend passes only `host`/`username`/`privateKey` to
   `ssh2`, so an encrypted key fails to authenticate. Algorithm is your choice;
   Ed25519 is the recommended default. A passphrase-less key is acceptable here
   because it is a dedicated, rotatable key whose value lives only as a Convex
   deployment secret and whose public half is trusted only on boxes you provision.

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
   - **Public key** -> Project -> **Security** -> **SSH Keys** tab -> **Add SSH
     Key** -> paste the contents of `composery_ssh.pub`, name it. Put that
     name or id in `HETZNER_SSH_KEY_IDS` (comma-separated for multiple); Hetzner
     injects it into every server it creates in this project. The backend also
     derives this same public key from `SSH_PRIVATE_KEY` and passes it as
     cloud-init `user_data` on server create and rebuild, so reset keeps SSH
     access even though Hetzner's rebuild action does not accept `ssh_keys`.
   - **Private key** -> `SSH_PRIVATE_KEY`, as a single line with each newline
     escaped as `\n` (the code reverses this with `.replace(/\\n/g, "\n")`).
     Produce that exact value and paste it into the Convex dashboard:

     ```bash
     awk '{printf "%s\\n", $0}' ~/.ssh/composery_ssh
     ```

   Keep `SSH_USER=root` unless the image's default login user differs. The backend
   uses this key for the whole box lifecycle (create, reset rebuild, bootstrap,
   password change, slug change), not just first setup.

   When rotating the key for an existing box, do it in this order so you do not
   lock the backend out of the VPS:
   1. Add the new public key to `/root/.ssh/authorized_keys` on every existing
      server while the old key still works.
   2. Test `ssh -i ~/.ssh/composery_ssh root@<server-ip>` from your machine.
   3. Replace `SSH_PRIVATE_KEY` in the matching Convex deployment with the new
      private key, and point `HETZNER_SSH_KEY_IDS` at the matching Hetzner
      project key for future servers.
   4. Only after the new login works, remove the old public key from
      `/root/.ssh/authorized_keys` and delete the old local keypair.

   `HETZNER_SSH_KEY_IDS` only affects Hetzner's create-time injection. Existing
   running servers keep whatever was written into `authorized_keys`, while reset
   rebuilds install the public key derived from the current `SSH_PRIVATE_KEY`.
   Changing the Hetzner project key alone is not a rotation.

3. **Firewall.** Project -> **Firewalls** -> **Create Firewall**. Add inbound
   rules allowing TCP **22**, **80**, and **443** from any IPv4 and IPv6 (sources
   `0.0.0.0/0` and `::/0`); leave outbound open. Create it, open it, and read the
   numeric id from the firewall's URL -> `HETZNER_FIREWALL_ID`. Required:
   provisioning fails fast (`requiredEnv` in `convex/boxes/infra/hetznerVps.ts`)
   rather than create an unfirewalled, internet-exposed box.

4. **Project id.** Open the project and read the numeric id from the console URL
   (`console.hetzner.com/projects/<id>/...`) -> `NEXT_PUBLIC_HETZNER_PROJECT_ID`.
   This is a frontend-plane var read by `lib/hetzner-dashboard.ts` so the staff
   console can deep-link a box to its Hetzner server; set it in the Next env
   (local `.env.local` and Vercel), not on the Convex deployment. It is
   non-secret, so the console action simply hides itself when the id is absent.

The provisioning code labels servers `product=composery-web` and
`box_slug=<slug>`, creates public IPv4/IPv6, waits for running, then SSHes in and
bootstraps Docker Compose.

`HETZNER_BOX_IMAGE` must be `docker-ce` - Hetzner's Docker CE app image
(Ubuntu-based, Docker and the Compose plugin preinstalled), referenced by that
name on server create. Bootstrap relies on Docker already being present (it goes
straight to `docker compose ... pull` / `up` in `convex/boxes/infra/ssh.ts`); it
does not install Docker, so a plain Ubuntu image would fail. Using the app image
also cuts the slowest part of first boot - installing Docker - so the box reaches
a live URL a minute or so sooner. The runtime container itself is still pulled
from `RUNTIME_IMAGE` at provision time, so this changes nothing about what runs
in the box, only how fast the host is ready.

Reset rebuilds the existing Hetzner server from `HETZNER_BOX_IMAGE` instead of
deleting and creating a replacement. That still destroys the VPS disk and returns
the host OS to the base image, but it preserves the server and Primary IP
resources. Reset also re-resolves the deployment's current `RUNTIME_IMAGE` before
bootstrap, so a rebuilt box uses the runtime release configured on the active
Convex deployment. Box deletion deletes the server and then explicitly deletes
the recorded Primary IPs, with IP-string lookup as a fallback for older boxes
that do not yet have Primary IP IDs stored.

## Cloudflare

Everything below is in the Cloudflare dashboard (`dash.cloudflare.com`). You need
exactly one **zone**: the apex domain that contains `CLOUD_DOMAIN`, e.g.
`composery.cloud`. Both environments share this single zone - production sets
`CLOUD_DOMAIN=composery.cloud` and dev sets `CLOUD_DOMAIN=dev.composery.cloud`, but
`dev.composery.cloud` is **not** a separate zone, just a subdomain the code writes
records under. So both Convex deployments get the **same** `CLOUDFLARE_ZONE_ID`,
and you can reuse one token for both (or make one per deployment).

1. **Add the zone (once).** In the Cloudflare dashboard, open **Domains** and
   choose **Onboard a domain**. Enter the **apex** domain `composery.cloud` (not
   the `dev.` subdomain), pick the **Free** plan, and let Cloudflare scan existing
   DNS. Cloudflare imports whatever your registrar already published, which for a
   freshly registered domain is usually parking and default email records (an apex
   `A` to a parking page, a `www` CNAME, registrar `MX` records, and a matching
   `spf1` `TXT`). None of that is used by this product; you clean it up in the next
   step. If you already added the zone and pointed the registrar's nameservers at
   Cloudflare, this step is done - the zone exists the moment its DNS page loads.

   Cloudflare then shows **two nameservers**. If DNSSEC is enabled at the
   registrar, disable it before changing nameservers; stale DS records can make
   the domain unreachable after delegation. Then go to your domain **registrar**
   and replace the current nameservers with exactly those two Cloudflare
   nameservers. Back in Cloudflare the zone flips from **Pending Nameserver
   Update** to **Active** once delegation propagates. Cloudflare can store DNS
   records while the zone is pending, but do not test real provisioning until it
   is Active because normal public DNS will not reliably use the Cloudflare
   records before delegation.

2. **Remove the imported registrar records and lock down mail.** This domain is a
   runtime namespace only: it serves boxes at `<slug>.<CLOUD_DOMAIN>` (records the
   app creates) and sends or receives **no** email. Delete the records Cloudflare
   imported - the apex `A` parking record, the `www` CNAME, and every registrar
   `MX` record - and replace the imported `spf1` `TXT` so the domain announces that
   nothing sends mail as it. None of this touches provisioning: the app manages
   per-slug `A`/`AAAA` records (`convex/boxes/infra/cloudflareDns.ts`), not the
   apex, `www`, `MX`, or these `TXT` records. End state - three `TXT` records, all
   anti-spoofing:

   | Name                         | Type  | Value                                            |
   | ---------------------------- | ----- | ------------------------------------------------ |
   | `@` (apex `composery.cloud`) | `TXT` | `v=spf1 -all`                                    |
   | `_dmarc`                     | `TXT` | `v=DMARC1; p=reject; sp=reject; aspf=s; adkim=s` |
   | `*._domainkey`               | `TXT` | `v=DKIM1; p=`                                    |

   `sp=reject` extends the policy to every `<slug>` subdomain, so neither the apex
   nor a box name can be spoofed. Skip a `rua=` reporting address; aggregate
   reports are pointless for a domain that legitimately sends zero mail. Leaving
   the apex with no `A` record means bare `https://composery.cloud` resolves to
   nothing, which is fine - the website is `WEBSITE_ORIGIN` (`www.composery.io`) and the
   product lives on the subdomains. To send the bare apex somewhere, add a
   Cloudflare **Redirect Rule** to `composery.io` rather than re-adding an `A`.

3. **Zone ID.** Open the domain and go to its **Overview** page (the default when
   you click the domain in the left sidebar). The **API** section - lower on the
   page, in the right-hand column - shows the **Zone ID** with a click-to-copy
   control -> `CLOUDFLARE_ZONE_ID`.
4. **API token.** Tokens live at the user/account level, not on the zone page, so
   go straight to **`https://dash.cloudflare.com/profile/api-tokens`** (or: account
   menu top-right -> **My Profile** -> **API Tokens**) -> **Create Token**. Find the
   **Edit zone DNS** template and click **Use template**. It prefills
   **Permissions** = `Zone` -> `DNS` -> `Edit`. Under **Zone Resources** choose
   **Include** -> **Specific zone** -> your `composery.cloud` zone. Click
   **Continue to summary** -> **Create Token**, then copy the token (shown once) ->
   `CLOUDFLARE_DNS_TOKEN`. The code only reads and writes `dns_records` on that one
   zone (`convex/boxes/infra/cloudflareDns.ts`), so no broader access is needed.
5. **Do not pre-create records; leave them DNS-only.** You create no per-box
   records by hand - the app creates and updates the `A`/`AAAA` records for each
   slug. They must stay **unproxied** (grey cloud, not orange) with automatic TTL,
   because Caddy on each box runs its own automatic HTTPS and its default ACME
   challenges need ports 80/443 to reach the box directly. The code already
   creates them unproxied (`proxied: false`, `ttl: 1`); if you ever flip a record
   to proxied (orange), Caddy's certificate issuance can break.

Provisioning in dev is real: a completed sandbox checkout creates an actual
Hetzner server and actual Cloudflare DNS records at `<slug>.<CLOUD_DOMAIN>`. Dev
and production must not share a `CLOUD_DOMAIN`, or a dev box and a production box
with the same slug would fight over the same DNS name. Dev uses
`CLOUD_DOMAIN=dev.composery.cloud`, which can live in the same `composery.cloud`
zone: records become `<slug>.dev.composery.cloud` and never collide with
production `<slug>.composery.cloud`. Day-to-day UI/backend work never triggers
provisioning, so this only matters when you deliberately exercise the lifecycle.

## Runtime image

The runtime image is not built by this repository. It must already exist before
checkout/provisioning can work.

- `RUNTIME_IMAGE` points to a valid image reference, e.g.
  `ghcr.io/sloikodavid/composery:latest`. Build and push it separately; for the
  GHCR package, set visibility to public.
- The image must be public or otherwise anonymously pullable - the code passes no
  registry credentials to the digest resolver or to `docker compose pull`.
- The image listens on `RUNTIME_PORT`, currently `8080`. Caddy reverse-proxies
  `https://<slug>.<CLOUD_DOMAIN>` to it.
- The runtime honors `HASHED_PASSWORD` and persists its data under `/data`.
  Bootstrap writes `HASHED_PASSWORD` as a single-quoted `composery.env` value
  because Argon2 hashes contain `$` characters, and Docker Compose only treats
  single-quoted `env_file` values literally (unquoted/double-quoted values are
  interpolated).
- Boxes start the runtime with systemd as PID 1 (`COMPOSERY_INIT=systemd` in the
  generated compose's `environment`), privileged cgroup access, and tmpfs mounts
  for `/run`, `/run/lock`, and `/tmp`. Compose injects `composery.env` via
  `env_file`; because systemd does not pass its environment to services, the
  runtime bridges those variables to `composery.service` itself.
- For production, prefer immutable tags or a digest-pinned release process.

On each VPS, bootstrap writes `/opt/composery-web/{compose.yml,composery.env,Caddyfile}`,
then runs `docker compose -p composery ... pull` and `up -d` (Docker comes from
the `docker-ce` base image). Password changes rewrite `composery.env`, force-recreate only the
runtime container, and check that `composery.service` is active with the expected
`HASHED_PASSWORD` before the database records the password as changed. Runtime log
views read `journalctl -u composery -u persistence` with Docker logs as a fallback.
The compose stack runs Caddy on host ports 80/443 and reverse-proxies to the
runtime container.

## Resend

Resend delivers the abuse alert emails that box metrics flags send to staff
(`convex/boxes/boxMetrics.ts`). Alerts are optional: with `RESEND_API_KEY`
unset, flags are still recorded and visible in the console - only the emails
are skipped.

1. **Create an account** at `resend.com`. Sign up with the address that should
   receive alerts: an account with no verified domain may send only **to the
   account owner's own email**, which is exactly the solo-operator setup.
2. **API key.** In the Resend dashboard open **API Keys** -> **Create API Key**.
   **Sending access** permission is enough - the code only sends
   (`convex/boxes/boxMetrics.ts`); it registers no webhooks. Copy the key ->
   `RESEND_API_KEY`.
3. **From address.** Keep `ALERT_EMAIL_FROM=Composery <onboarding@resend.dev>`,
   Resend's shared address for accounts without a verified domain.
4. **More recipients (later).** Alerts go to every non-suspended `admin` user.
   Deliverability beyond the account owner requires verifying a domain: Resend
   dashboard -> **Domains** -> **Add Domain**, publish the DNS records Resend
   shows, then point `ALERT_EMAIL_FROM` at that domain. Verify the website
   domain (`composery.io`) or a subdomain of it - never `CLOUD_DOMAIN`, whose
   zone is deliberately locked to "sends no mail" (see the Cloudflare section).

## Box snapshots (Hetzner)

Box snapshots are point-in-time copies of a box's whole disk, captured as
Hetzner Cloud _Snapshots_ (`POST /servers/{id}/actions/create_image` with
`type: "snapshot"`) and restored by rebuilding the VPS from that image. The box
is not involved at all - Hetzner snapshots the disk at the hypervisor - so no
credential, encryption key, or pipeline lives on the box, and a box with full
root cannot read, list, overwrite, or delete its own snapshots. All snapshot API
calls are in `convex/boxes/infra/hetznerVps.ts`, alongside the rest of the
Hetzner client; row state and retention live in `convex/boxes/boxSnapshots.ts`.

There are **no new environment variables.** Snapshots reuse the existing
`HETZNER_CLOUD_TOKEN` already set in the Hetzner section.

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
  (`enable_backup`, 7 per server, not project-capped) - a different feature with a
  flat 20%-of-server-price cost and "backup" terminology, not implemented here.
- The runtime image needs nothing special for snapshots (no `age`/`zstd`/
  `curl` snapshot pipeline); it only needs what the lifecycle already requires.

## Set Convex environment variables

Now enter the values you collected above into the Convex dashboard, separately
for the dev and production deployments: Deployment Settings -> Environment
Variables. The deployment is the live store; these values are sensitive and
account-specific, so a human enters them there. They are not committed and not
read from `.env.local`.

Use `.env.example.convex.dev` and `.env.example.convex.prod` as the checklist of
which keys each deployment needs and their non-secret defaults. The keys are
`CLERK_FRONTEND_API_URL`, `WEBSITE_ORIGIN`, `CLOUD_DOMAIN`, the `POLAR_*`,
`HETZNER_*`, `CLOUDFLARE_*` groups, plus `RUNTIME_IMAGE`, `RUNTIME_PORT`,
`SSH_USER`, `SSH_PRIVATE_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM`. Do not put frontend-plane vars
(`CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_*`, `CLERK_SECRET_KEY`,
`CLERK_AUTHORIZED_PARTIES`) on the deployment.

Only `CLERK_FRONTEND_API_URL` is required at deploy time. Convex evaluates
`convex/auth.config.ts` during every push, and it calls
`requiredEnv("CLERK_FRONTEND_API_URL")`, so a deployment with that var unset fails
the deploy with `Missing Convex environment variable: CLERK_FRONTEND_API_URL`.
Every other backend var is read inside functions at runtime, so a missing one
only breaks the feature that needs it, not the deploy (see `convex/billing/polar.ts`,
which reads its env tolerantly for exactly this reason).

For a one-off from the CLI, `convex env set NAME value` (dev) or
`convex env set --prod NAME value` works too. Check what is set with
`convex env list` (dev) or `convex env list --prod`. After setting them, push and
codegen again:

```bash
pnpm exec convex dev --once
```

## Vercel

You only deploy production from git (branch `main`). Local development never goes
through Vercel; it uses `pnpm run dev` with `.env.local`. So Vercel only needs
Production configuration.

Create or link the project:

```bash
vercel link
```

Project settings:

- Framework preset: Next.js.
- Install command: `pnpm install`.
- Build command:

  ```text
  npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
  ```

  It deploys Convex first, injects the correct `NEXT_PUBLIC_CONVEX_URL` and Convex
  site URL into the Next.js build, then builds the frontend.

- Project Settings -> Git: production branch = `main`.
- Project Settings -> Build and Deployment -> Ignored Build Step = **Only build
  production**. There is no preview Convex backend, so a non-`main` branch deploy
  has nowhere correct to point.

Add these Vercel Production environment variables (frontend plane):

| Variable                            | Production value                                            |
| ----------------------------------- | ----------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`                 | the `prod:` deploy key from the Convex deployments step     |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production Clerk publishable key                            |
| `CLERK_SECRET_KEY`                  | Production Clerk secret key                                 |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | `/sign-in`                                                  |
| `CLERK_AUTHORIZED_PARTIES`          | `https://www.composery.io` (exact origins, comma separated) |

```bash
vercel env add CONVEX_DEPLOY_KEY production --sensitive
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
vercel env add CLERK_SECRET_KEY production --sensitive
vercel env add NEXT_PUBLIC_CLERK_SIGN_IN_URL production
vercel env add CLERK_AUTHORIZED_PARTIES production
```

After changing Vercel env vars, redeploy - Vercel does not apply env changes to
old deployments. Check the `CONVEX_DEPLOY_KEY` shape before saving: it must start
with `prod:<production-deployment-name>|`. A `dev:` key or a raw
`<deployment-name>|...` admin key makes Vercel deploy to your dev backend. The
deploy log must name the production Convex URL; if it names the deployment that
local `.env.local` calls `CONVEX_DEPLOYMENT`, the wrong key was pasted.

```bash
vercel env ls production
```

## Analytics & privacy

Two planes of observability, no third-party tracker and no new env vars:

- **Web traffic & performance.** `@vercel/analytics` and `@vercel/speed-insights`
  are mounted in `app/layout.tsx`. They need no env — Vercel injects the
  `/_vercel/insights` and `/_vercel/speed-insights` endpoints at the edge. Enable
  **Web Analytics** and **Speed Insights** for the project in the Vercel
  dashboard (Project -> Analytics / Speed Insights -> Enable). They no-op off
  Vercel and only log (no beacon) in development. To surface a one-click "Open in
  Vercel" link on `/console` (the in-app pointer to those dashboards), set
  `NEXT_PUBLIC_VERCEL_PROJECT_URL` to the project's dashboard URL
  (`https://vercel.com/<team>/<project>`) in the Next env; `lib/vercel-dashboard.ts`
  reads it and the link hides when it is unset.
- **Product/fleet KPIs.** Derived on demand in `convex/staff/stats.ts`
  (`api.staff.stats.overview`) from existing tables — no separate analytics
  store, no per-pageview writes. Surfaced on `/console` (staff only). Snapshot
  tiles read per-status via the `boxes.status` index; funnel/trend numbers read a
  trailing window via the `created_at` indexes, so cost tracks recent volume, not
  total table size.

**Cookies / GDPR.** Vercel Web Analytics and Speed Insights are cookieless and
do not collect personal data, so **no consent banner is required**. The only
cookies the site sets are Clerk's strictly-necessary authentication cookies,
which are exempt from consent under the ePrivacy Directive. Adding any
cookie-based or cross-site tracker later would change this — add a consent
banner then, not before.

## Local development

`.env.local` holds frontend-plane values only; it is your copy of
`.env.example.next.dev`. `convex dev` writes the Convex identifiers; you fill the
dev Clerk keys. The Convex-plane values live on the dev deployment (set above),
not in `.env.local`.

```bash
pnpm run dev
```

This runs `convex dev` (pushing functions and schema to the dev deployment) and
`next dev` together. Open `http://localhost:3000`.

Local UI work runs without real Polar/Hetzner/Cloudflare credentials until you
test checkout or provisioning. Full checkout/provisioning requires real sandbox
provider credentials and a reachable Convex site URL for Polar webhooks.

## Production deploy

1. Confirm Vercel production branch is `main`.
2. Confirm Vercel Production env vars include `CONVEX_DEPLOY_KEY` (starting
   `prod:`), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `CLERK_AUTHORIZED_PARTIES`.
3. Confirm the production Convex deployment has at least `CLERK_FRONTEND_API_URL`
   set, or the build fails at the Convex deploy step (`auth.config.ts` is
   evaluated during the push):

   ```bash
   pnpm exec convex env list --prod
   ```

4. Confirm the Polar production webhook points to the production Convex
   `CONVEX_SITE_URL` plus `/polar/events`.
5. Push or merge to `main`. Vercel runs the build command, deploys Convex, builds
   Next.js with the production Convex URL, and publishes the production web app.

## Admin seed

1. Start the app and sign in once with the first staff account.
2. Open the Convex dashboard for the matching deployment.
3. Go to Data -> `users`, find the row for that Clerk user, set `role` to `admin`.

Staff routes and staff Convex functions are unavailable until at least one user
has `role="admin"`.

## End-to-end verification

Run code checks:

```bash
pnpm run check
```

Then verify the product flow in sandbox first:

1. Sign in on the target website.
2. Confirm the user row exists in Convex.
3. Seed the user as `admin`.
4. Create a box checkout.
5. Complete Polar sandbox payment.
6. Confirm Polar sends `subscription.active` to `<CONVEX_SITE_URL>/polar/events`.
7. Confirm Convex creates or updates the subscription and provisioning records.
8. Confirm Hetzner creates a server with labels `product=composery-web` and the
   expected `box_slug`.
9. Confirm Cloudflare creates DNS-only `A` and `AAAA` records for the slug.
10. Confirm the server bootstraps Docker Compose and Caddy.
11. Open `https://<slug>.<CLOUD_DOMAIN>`.
12. Test password change, slug change, reset, and runtime access.
13. Cancel or revoke the subscription through Polar/customer portal.
14. Confirm Convex schedules teardown and the Hetzner server/DNS records are
    removed.

## Troubleshooting

| Symptom                                                                                                                                         | Check                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel build cannot find `NEXT_PUBLIC_CONVEX_URL`                                                                                               | Build command must include `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`.                                                                                                                                                                                                                                                  |
| Vercel deploys against the dev Convex backend                                                                                                   | The Vercel `CONVEX_DEPLOY_KEY` is a `dev:` key. Replace it with the `prod:` key and confirm the deploy log names production.                                                                                                                                                                                                                                      |
| Convex deploy fails: `Missing Convex environment variable: CLERK_FRONTEND_API_URL`                                                              | The target deployment has no env vars. `auth.config.ts` needs this var at push time. Set it with `convex env set` (dev) or `convex env set --prod`.                                                                                                                                                                                                               |
| Convex deploy fails with `ViewData` on `_system/cli/tableSize`                                                                                  | Almost always the wrong deploy key; see below.                                                                                                                                                                                                                                                                                                                    |
| `getToken({ template: "convex" })` fails                                                                                                        | Clerk JWT template/integration must be named `convex`; `CLERK_FRONTEND_API_URL` must match the same Clerk instance in Convex.                                                                                                                                                                                                                                     |
| Auth works locally but not in production                                                                                                        | Check `CLERK_AUTHORIZED_PARTIES` exact origins and the custom domain.                                                                                                                                                                                                                                                                                             |
| Auth-gated pages 404 or redirect to sign-in while signed in (e.g. `/boxes/<slug>`, `/console`); public pages like `/` and `/pricing` still load | `CLERK_SECRET_KEY` is wrong or from a different Clerk instance than `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (test vs live, or dev vs prod). An invalid secret makes Clerk treat every request as signed-out, so guarded routes fall through to `redirect`/`notFound()` instead of erroring. Confirm both keys come from the same instance and restart `pnpm run dev`. |
| Checkout fails with a Polar "not a valid email address" error                                                                                   | Clerk's **session token** (not the JWT template) lacks an `email` claim, so `emailFromIdentity` has none. The active Convex integration makes the client send the session token, bypassing the template. Add `{ "email": "{{user.primary_email_address}}" }` under Configure -> Sessions -> Customize session token, then sign in again.                          |
| Checkout opens but no box provisions                                                                                                            | Check Polar webhook URL, enabled events, webhook secret, and Convex site URL.                                                                                                                                                                                                                                                                                     |
| Provisioning fails before SSH                                                                                                                   | Check Hetzner token, quota, image, server type, location, SSH key ids, and firewall id.                                                                                                                                                                                                                                                                           |
| SSH bootstrap fails                                                                                                                             | Check `SSH_PRIVATE_KEY` formatting, `SSH_USER`, port 22, and whether the public key was injected into the server.                                                                                                                                                                                                                                                 |
| Runtime image resolution or pull fails                                                                                                          | Confirm the image reference exists and is public/anonymously pullable.                                                                                                                                                                                                                                                                                            |
| HTTPS does not come up                                                                                                                          | Confirm Cloudflare records are DNS-only, DNS resolves to the server IPs, and ports 80/443 are open.                                                                                                                                                                                                                                                               |
| Teardown does not happen after cancellation                                                                                                     | Confirm `subscription.revoked` reaches the webhook and Convex crons are enabled on the deployment.                                                                                                                                                                                                                                                                |

The `ViewData`/`tableSize` error means the deploy is trying to remove at least
one index, and the deploy key cannot read table sizes for Convex's large-index
safety check. A `dev:` key on a production deploy hits exactly this. First inspect
the production deploy from a local shell logged in with a Convex user that has
access:

```bash
unset CONVEX_DEPLOY_KEY
pnpm exec convex deploy --dry-run --verbose --yes --allow-deleting-large-indexes
```

If the dry run reports missing production Convex environment variables, set those
first. If it reports an intentional index removal, run the one-time production
deploy locally:

```bash
unset CONVEX_DEPLOY_KEY
pnpm exec convex deploy --yes --allow-deleting-large-indexes --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

After that succeeds, redeploy Vercel with the normal build command and the
correct `prod:` key.

## References checked

- Convex Vercel hosting: https://docs.convex.dev/production/hosting/vercel.
- Convex deploy CLI: https://docs.convex.dev/cli/reference/deploy.
- Convex deploy keys: https://docs.convex.dev/cli/deploy-key-types.
- Convex environment variables: https://docs.convex.dev/production/environment-variables.
- Clerk Convex integration: https://clerk.com/docs/integration/convex.
- Clerk Next.js quickstart: https://clerk.com/docs/nextjs/getting-started/quickstart.
- Clerk middleware options: https://clerk.com/docs/reference/nextjs/clerk-middleware.
- Vercel environment variables: https://vercel.com/docs/environment-variables.
- Vercel env CLI: https://vercel.com/docs/cli/env.
- Next.js installation requirements: https://nextjs.org/docs/pages/getting-started/installation.
- Next.js environment variables: https://nextjs.org/docs/app/guides/environment-variables.
- Polar API overview: https://polar.sh/docs/docs/api/sdk.
- Polar webhook events: https://polar.sh/docs/integrate/webhooks/events.
- Hetzner Cloud API: https://docs.hetzner.cloud/reference/cloud.
- Hetzner API tokens: https://docs.hetzner.com/cloud/api/getting-started/generating-api-token.
- Cloudflare domain onboarding: https://developers.cloudflare.com/fundamentals/manage-domains/add-site/.
- Cloudflare zone status: https://developers.cloudflare.com/dns/zone-setups/reference/domain-status/.
- Cloudflare API tokens: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/.
- Cloudflare DNS API: https://developers.cloudflare.com/api/resources/dns/.
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/.
- Cloudflare DNS TTL: https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/.
- Docker Engine on Ubuntu: https://docs.docker.com/installation/ubuntulinux/.
- Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https.
- GitHub Container Registry: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry.
