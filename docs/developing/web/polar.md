---
title: Polar
description: Set up the Polar sandbox (dev) and production organizations, products, and webhook for billing.
---

Use the Polar sandbox (`sandbox.polar.sh`) for development and Polar production
(`polar.sh`) for production. Set up each the same way; sandbox values go on the
dev [Convex](./convex.md) deployment, production values on the prod deployment.

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

3. Create the Box product (Products -> Create Product). Give it a name, add a
   recurring **monthly** price, and save. Open the product and copy its **Product
   ID** (not the price ID) -> `POLAR_BOX_PRODUCT_ID`. The code keys off the
   product id (`products.box` in `convex/billing/polar.ts`). This is a
   per-deployment env var, not a hardcoded id, because the sandbox and production
   Box products have different ids.

4. Create a webhook (Settings -> Webhooks -> Add Endpoint). Set the URL to the
   matching deployment's `<CONVEX_SITE_URL>/polar/events` (the Site URL from the
   [Convex](./convex.md) step). Copy the signing secret ->
   `POLAR_WEBHOOK_SECRET`. Enable:
   - App logic: `subscription.active`, `subscription.revoked`, `checkout.updated`,
     `checkout.expired`.
   - Component sync: `product.created`, `product.updated`, `subscription.created`,
     `subscription.updated`.

5. Copy the organization **slug** (Settings -> Organization, the handle shown in
   your dashboard URL) -> `NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG`, and set
   `NEXT_PUBLIC_POLAR_ENVIRONMENT` to `sandbox` (dev) or `production` (prod).
   These are frontend-plane vars read by `lib/polar-dashboard.ts` so the staff
   console can deep-link a box to its Polar customer and subscription; set them
   in the Next env (local `.env.local` and [Vercel](./vercel.md)), not on the
   Convex deployment. They are non-secret, so the console action simply hides
   itself when the slug is absent.

Checkout success URLs are built from `WEBSITE_ORIGIN`, so that var on the same
[Convex](./convex.md) deployment must point at the matching website before you
test checkout.

## References

- Polar API overview: https://polar.sh/docs/docs/api/sdk.
- Polar webhook events: https://polar.sh/docs/integrate/webhooks/events.