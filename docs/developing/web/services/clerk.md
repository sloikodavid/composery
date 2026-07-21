---
title: Clerk
description: Configure development and production authentication, legal consent, Convex identity, and account deletion.
---

Use separate Clerk development and production instances. Development uses
`pk_test`/`sk_test`; production uses `pk_live`/`sk_live` and the custom
domain `clerk.composery.io`.

## Configure each instance

1. Enable Clerk's **Convex integration**. It provisions the `convex` JWT
   configuration used by `convex/auth.config.ts`.
2. Under **Sessions -> Customize session token**, add:

   ```json
   { "email": "{{user.primary_email_address}}" }
   ```

   Checkout requires the authenticated email claim.

3. Under **Legal**, set:
   - Terms: `https://www.composery.io/terms`
   - Privacy: `https://www.composery.io/privacy`
   - **Require express consent to legal documents**: enabled

   The same public documents may be used by the development instance.

4. Keep self-service account deletion enabled.
5. Collect:

   | Value                  | Destination                                 |
   | ---------------------- | ------------------------------------------- |
   | Publishable key        | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in Next |
   | Secret key             | `CLERK_SECRET_KEY` in Next and Convex       |
   | Frontend API URL       | `CLERK_FRONTEND_API_URL` in Convex          |
   | Webhook signing secret | `CLERK_WEBHOOK_SIGNING_SECRET` in Convex    |

`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`. Set
`CLERK_AUTHORIZED_PARTIES=http://localhost:3000` locally and
`https://www.composery.io` in production.

## Box password authorization

An unconfigured Cloud box starts a short-lived authorization-code transaction
at `/boxes/authorize`. This route uses the existing Clerk session; signed-out
users go through `/sign-in` with an internal `redirect_url`, while signed-in
users return to the box without seeing another prompt. Do not configure a Clerk
force redirect because it overrides the transaction return path.

The code, PKCE challenge, grant, and their lifetimes live in
`convex/boxes/boxAuth.ts`; read them there rather than restating them. The raw
password never leaves the box origin, so Clerk only ever proves who owns the
box.

Check both cases when changing Clerk routing:

- A signed-in owner opening a new box returns directly to its password form.
- A signed-out owner signs in or signs up, including any required Clerk session
  tasks, and then resumes the same box transaction.

## Production DNS

Add `clerk.composery.io` as Clerk's production custom domain. Clerk shows five
CNAME records for the frontend API, account portal, mail, and two DKIM keys.
Create those exact records in the `composery.io` Cloudflare zone as **DNS
only**. Do not copy targets from old screenshots or this guide. Production keys
become usable after Clerk verifies every record and provisions TLS.

## Account deletion webhook

Create a Clerk webhook endpoint:

```text
<CONVEX_SITE_URL>/clerk/events
```

Subscribe only to `user.deleted` and put its signing secret in the matching
Convex deployment. The handler verifies the signature, immediately revokes Polar
subscriptions, deletes boxes and snapshots, releases pending checkouts, and
scrubs the application email. A scheduled retry finishes boxes that are busy.
Staff-triggered deletion first removes the Clerk identity through its Backend
API, then runs the same idempotent cleanup path; it requires `CLERK_SECRET_KEY`
in Convex as well as Next.

Test once in both environments with a disposable account. Removing a Convex row
manually is not account deletion because the Clerk identity would still exist.

## Check

- Sign-up displays the Terms and Privacy acceptance.
- The session identity contains `email`.
- Convex accepts an authenticated request.
- Deleting a disposable Clerk user reaches `deletion_finished_at` in Convex.

## References

- Clerk with Convex: https://clerk.com/docs/integrations/databases/convex
- Clerk legal compliance: https://clerk.com/docs/guides/secure/legal-compliance
- Clerk custom domains: https://clerk.com/docs/guides/development/custom-domains/overview
- Clerk webhooks: https://clerk.com/docs/guides/development/webhooks/overview
