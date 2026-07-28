---
title: Polar
description: Set up the Polar sandbox (dev) and production organizations, products, and webhook for billing.
---

Use the Polar sandbox (`sandbox.polar.sh`) for development and Polar production
(`polar.sh`) for production. Set up each the same way; sandbox values go on the
dev [Convex](./convex.md) deployment, production values on the prod deployment.

1. Create or select the organization.
   In production, complete Polar's account review and enter the real supplier
   identity and support contact: David Sloiko, trading as Composery, and
   `sloikodavid@gmail.com`. Polar is the merchant of record and reseller, but
   Composery remains the supplier under the Terms.
2. Create an Organization Access Token (Settings -> Developers -> New Token) with
   these scopes (required by `@convex-dev/polar`):
   - `products:read`, `products:write`.
   - `subscriptions:read`, `subscriptions:write`.
   - `customers:read`, `customers:write`.
   - `checkouts:read`, `checkouts:write`.
   - `checkout_links:read`, `checkout_links:write`.
   - `customer_portal:read`, `customer_portal:write`.
   - `customer_sessions:write`.
   - `orders:read`.
   - `refunds:read`, `refunds:write`.

   Copy it -> `POLAR_ORGANIZATION_TOKEN`. Set `POLAR_ENVIRONMENT=sandbox` for dev
   or `production` for prod; it selects which Polar API the component talks to and
   is the one Polar value with a fail-safe default of `sandbox`
   (`convex/billing/polar.ts`).

3. Under Settings -> Payments, set the organization's default tax behavior to
   **Exclusive**. Polar fixes the billing interval on each product, so create two
   products rather than adding two prices to one product:
   - **Box - Monthly**: recurring monthly, fixed.
   - **Box - Annual**: recurring yearly, fixed. This is displayed in the monthly figure on the pricing page.

   Give both the same accurate hosted-box description, Terms link, Privacy link,
   and benefits. Duplicating Box Monthly is the safest way to create Box Annual,
   then change its billing interval and price before publishing. Open each
   product and copy its **Product ID** (not its price ID):
   - Box Monthly -> `POLAR_BOX_MONTHLY_PRODUCT_ID`.
   - Box Annual -> `POLAR_BOX_ANNUAL_PRODUCT_ID`.

   Both variables are read by `convex/billing/polar.ts`. Checkout receives both
   product IDs and selects the pricing-page choice by default; fulfillment
   accepts paid initial orders from either ID. These are per-deployment values,
   because sandbox and production products have different IDs.

4. Create one organization custom field (Settings -> Custom Fields), attach it
   to **both Box products**, and make it a **required checkbox** on each:
   - Slug `composery-terms-v1`.
   - Label `I agree to the Composery Terms of Service.`
   - Help text linking to `https://www.composery.io/terms`.

   Polar prevents checkout confirmation until a required checkbox is checked,
   and copies the value to the Order and Subscription. The webhook also checks
   the value before fulfillment; a paid order without it is revoked and fully
   refunded. Do not change a versioned slug's meaning in place. Create a new
   field and update `lib/cloud-legal.ts` when the Terms acceptance changes.

5. Enable **Allow multiple subscriptions per customer** in the organization
   subscription settings. Polar disables this by default, but one Composery
   user is allowed to own multiple boxes and each box has its own subscription.
   There is intentionally no one-box-per-customer application limit.

6. Under Customer notifications, keep Polar's order, subscription,
   cancellation, revocation, renewal, and failed-payment emails enabled. Polar
   owns routine billing mail and links customers to its hosted portal. Do not
   disable these in favor of Resend: selecting supplier-managed communications
   makes Composery responsible for sending the notices Polar would have sent.

7. Create a webhook (Settings -> Webhooks -> Add Endpoint). Set the URL to the
   matching deployment's `<CONVEX_SITE_URL>/polar/events` (the Site URL from the
   [Convex](./convex.md) step). Copy the signing secret ->
   `POLAR_WEBHOOK_SECRET`. Enable:
   - App logic: `order.paid`, `order.refunded`, `subscription.active`,
     `subscription.revoked`, `checkout.updated`, `checkout.expired`.
   - Component sync: `product.created`, `product.updated`, `subscription.created`,
     `subscription.updated`.

8. Copy the organization **slug** (Settings -> Organization, the handle shown in
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

The pricing page defaults to Box Annual. Its slug field checks the shared box
namespace before checkout, preserves the chosen slug and interval through sign
in, and sends the chosen product first in Polar's checkout product list. Polar
still shows both products in checkout, so the customer can review or change the
billing interval before paying.

## Billing and box lifecycle

Polar treats refunds and subscriptions as separate operations. Refunding a
subscription order does not end the subscription, and revoking a subscription
does not refund an order. Composery therefore applies these rules:

| Event                                                                                   | Money                                                                                             | Subscription and box                                                                                                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Customer cancels in the Polar portal                                                    | No automatic refund                                                                               | `cancel_at_period_end` stays active through the paid period; the box is removed after the subscription ends.                             |
| Staff or account deletion revokes immediately                                           | No automatic refund                                                                               | Access ends now; `subscription.revoked` starts box deletion. Refund separately only when agreed, required by law, or directed by Polar.  |
| Partial order refund                                                                    | Polar returns that net amount and prorated tax; Polar fees remain charged to Composery            | Subscription and box remain active.                                                                                                      |
| Full cumulative order refund                                                            | Polar returns the remaining refundable net amount and tax; Polar fees remain charged to Composery | `order.refunded` makes Composery revoke the subscription, which removes the box.                                                         |
| Paid event arrives after its capacity reservation ended and no complete package remains | Full remaining refundable amount                                                                  | Composery records the order, revokes the subscription, and refunds without creating an unallocated box.                                  |
| Paid Box order lacks Terms acceptance or a matching checkout intent                     | Full remaining refundable amount                                                                  | Composery alerts staff, revokes, and refunds without starting fulfillment.                                                               |
| Initial box fulfillment fails after workflow retries                                    | Full remaining refundable amount                                                                  | Composery revokes first, refunds the paid order, and removes any server, DNS, IP, credentials, and snapshots created for the failed box. |
| Snapshot capture fails                                                                  | No subscription refund                                                                            | Only the snapshot operation fails; the running box and subscription continue.                                                            |

`order.paid` stores the exact first order id before provisioning starts. A later
catalog price change cannot affect a fulfillment-failure refund: the code asks
Polar for that order's current `refundable_amount` and refunds all of it. Polar
automatically refunds the associated tax. A pending refund makes the webhook or
workflow retry; stable metadata prevents a duplicate refund.

An active checkout holds one complete package in Composery's local capacity
accounting. A late paid webhook for an expired or released checkout must
atomically reacquire capacity and its slug before conversion. The paid order is
retained even when reacquisition fails, so the revoke/refund is auditable and
idempotent. See [Operations](../operations.md#capacity-and-paid-checkout).

This is not a blanket customer-controlled free-compute window. Polar provides
first-tier refund, cancellation, payment, and chargeback support; its Buyer
Terms allow refunds to be denied for fraud, abuse, misuse, or non-compliance
where the law permits. Composery supplies product/delivery support and must give
Polar requested usage and complaint information within 72 hours. If the paid
box cannot be delivered, Polar's Buyer Terms identify replacement or refund as
the remedy, and Polar's supplier terms require access through the paid period or
a pro-rated refund when the product is unavailable. The code chooses the
customer-safe full refund only for failed **initial** delivery because no usable
period was supplied.

Polar may also issue a refund or cancel a transaction itself to prevent a
chargeback or comply with law. Keep `order.refunded` enabled so a full refund can
never leave an independently billed box running. Handle customer complaints and
refund requests in Polar rather than paying the customer outside Polar.

## References

- Polar merchant of record: https://polar.sh/docs/merchant-of-record/introduction
- Polar account review: https://polar.sh/docs/merchant-of-record/account-reviews
- Polar products and billing intervals: https://polar.sh/docs/features/products
- Polar checkout sessions: https://polar.sh/docs/features/checkout/session
- Polar webhook events: https://polar.sh/docs/integrate/webhooks/events
- Polar custom fields: https://polar.sh/docs/features/custom-fields
- Polar refunds: https://polar.sh/docs/features/refunds
- Polar subscriptions and multiple-subscription setting: https://polar.sh/docs/features/subscriptions/introduction
- Polar subscription cancellation and revocation: https://polar.sh/docs/features/subscriptions/manage
- Polar Buyer Terms: https://polar.sh/legal/checkout-buyer-terms
- Polar supplier terms: https://polar.sh/legal/master-services-terms
