---
title: Clerk
description: Create dev and production Clerk instances, enable the Convex integration, and collect the auth values.
---

Create separate Clerk instances for development and production. The development
instance works out of the box on `*.clerk.accounts.dev` with `pk_test`/`sk_test`
keys. The production instance requires a custom Clerk domain
(`clerk.<website-domain>`, set up via DNS) before it issues `pk_live`/`sk_live`
keys and a production Frontend API URL.

## For each Clerk instance

1. Enable the **Convex integration** in the Clerk dashboard
   (`dashboard.clerk.com/apps/setup/convex`) and Activate it. This provisions
   the JWT template named `convex` that the app depends on (`getToken({ template:
"convex" })`, and `applicationID: "convex"` in `convex/auth.config.ts`) and
   reveals the Frontend API URL used below. The integration adds `aud: "convex"`
   to the **default session token**, so `ConvexProviderWithClerk` sends that
   token directly and bypasses the `convex` JWT template on the browser path
   (convex-js#145). Because the backend reads `identity.email` via
   `emailFromIdentity` (`convex/authorization.ts`) to record the user and create
   [Polar](./polar.md) checkouts, add the `email` claim to the **session token**,
   not just the template: under Configure -> Sessions -> Customize session token,
   add `{ "email": "{{user.primary_email_address}}" }` to the Claims. Without it,
   client-initiated checkout fails on an empty email.

2. Collect these values:
   - **Publishable key** -> `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (frontend plane).
   - **Secret key** -> `CLERK_SECRET_KEY` (frontend plane; full backend access,
     keep it to Vercel Production and local `.env.local`).
   - **Frontend API URL** -> `CLERK_FRONTEND_API_URL` (Convex plane; the JWT
     issuer that `convex/auth.config.ts` validates). It looks like
     `https://verb-noun-00.clerk.accounts.dev` in dev and
     `https://clerk.<website-domain>` in production.
   - **Webhook signing secret** -> `CLERK_WEBHOOK_SIGNING_SECRET` (Convex plane;
     read by `convex/http.ts`). Create a Clerk webhook endpoint whose URL is the
     Convex deployment's HTTP Actions URL, ending in `/clerk/events`:
     `<CONVEX_SITE_URL>/clerk/events`. Subscribe it to `user.deleted` only.

3. `NEXT_PUBLIC_CLERK_SIGN_IN_URL` is `/sign-in` in both.

4. `CLERK_AUTHORIZED_PARTIES` (read in `proxy.ts`) is the exact website origins
   that may serve the app, comma-separated, no paths: `http://localhost:3000`
   for local, `https://www.<website-domain>` for production. If the apex served
   the app directly it would also need listing, and a visitor on the
   un-redirected apex would be treated as signed-out.

## Production custom domain (DNS and SSL)

The development instance needs no DNS - it runs on `*.clerk.accounts.dev`. The
production instance does: open the production instance's **Domains** page in the
Clerk dashboard and add the five `CNAME` records it lists, on whatever DNS
provider hosts `<website-domain>` (the registrar or wherever the website
domain's nameservers point). This is a separate DNS surface from the
Cloudflare `<cloud-domain>` zone in the [Cloudflare](./cloudflare.md) section;
nothing about boxes touches `<website-domain>`. The records, host on the left:

| Host (under `<website-domain>`) | Type    | Target                        |
| ------------------------------- | ------- | ----------------------------- |
| `clerk`                         | `CNAME` | `frontend-api.clerk.services` |
| `accounts`                      | `CNAME` | `accounts.clerk.services`     |
| `clkmail`                       | `CNAME` | `mail.<id>.clerk.services`    |
| `clk._domainkey`                | `CNAME` | `dkim1.<id>.clerk.services`   |
| `clk2._domainkey`               | `CNAME` | `dkim2.<id>.clerk.services`   |

`clerk` and `accounts` have stable targets; the `clkmail` and two `_domainkey`
targets embed an instance-specific id (shown as `<id>`), so copy those three
exactly from the dashboard rather than from this table. `clerk` is the Frontend
API host that becomes `CLERK_FRONTEND_API_URL`
(`https://clerk.<website-domain>`); `accounts` is the hosted account portal;
`clkmail` and the two `_domainkey` records authorize Clerk to send
transactional email (verification, password reset) as the domain. The dashboard
shows each record as `Unverified` until its target resolves, and DNS propagation
can take minutes to hours - re-run the dashboard's verification after the
records are live.

Clerk issues the SSL certificates itself once all five records resolve; there
is no manual certificate step. Until every record verifies, the domain and certs
stay `Pending`, and the production `pk_live`/`sk_live` keys and Frontend API URL
are not usable - so do this before you collect the production Clerk values above.

`CLERK_FRONTEND_API_URL` is the one Convex var required at deploy time (see
[Convex](./convex.md) - "Set Convex environment variables"), so make sure you
have it for each instance.

## Account deletion webhook

Keep Clerk's self-serve account deletion enabled. When a user deletes their
Clerk account, Clerk sends `user.deleted` to `convex/http.ts` at
`/clerk/events`. The handler checks the Svix signature with
`CLERK_WEBHOOK_SIGNING_SECRET`, marks the Convex user row deletion-pending,
revokes their Polar subscriptions, and directly starts the existing box delete
workflow for each non-deleted box with the same `delete:<subscriptionId>`
idempotency key used by the Polar webhook and reconciliation sweep.

This webhook is load-bearing, not optional: with self-serve deletion enabled
but no webhook endpoint (or a wrong/missing signing secret), a user who deletes
their Clerk account keeps their subscription billing with no way to sign in and
cancel. Set up the endpoint and secret on every instance before it serves real
users, and verify the flow once with a throwaway account (delete it in Clerk,
then confirm the Convex user row reaches `deletion_finished_at`).

Erasure requests that arrive by email go through the staff mutation
`staff.users.requestAccountDeletionByEmail`, which runs the same routine. When
using it, also delete the user in the Clerk dashboard: the Convex scrub does
not touch Clerk, and a still-alive Clerk account signing back in re-writes its
email onto the scrubbed row via the lazy upsert.

Local PII is not scrubbed immediately. `convex/accountDeletion.ts` waits until
all of the user's boxes reach `deleted`, retrying busy boxes through scheduled
finalizers and the hourly account deletion cron, then replaces the user email
with a non-PII placeholder and scrubs the user's checkout intents. Polar keeps
billing records for legal retention; Composery does not attempt to delete those.

The local `.clerk/` directory is ignored and may hold keyless-mode secrets. Do
not depend on it; use real keys and the `convex` JWT template for both instances.

## References

- Clerk Convex integration: https://clerk.com/docs/integration/convex.
- Clerk Next.js quickstart: https://clerk.com/docs/nextjs/getting-started/quickstart.
- Clerk middleware options: https://clerk.com/docs/reference/nextjs/clerk-middleware.
