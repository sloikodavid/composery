---
title: Resend
description: Configure and verify staff-only operational alert delivery.
---

Resend sends operational alerts to internal administrators only. Polar owns all
customer-facing order, subscription, renewal, cancellation, refund, and payment
email. Composery has no Resend onboarding sequence, customer template, marketing
mail, or inbound-mail flow.

Production is not launch-ready until this page is complete. The application can
run without Resend, but important events then remain queued as **disabled** and
the staff console shows the delivery configuration as unhealthy.

## Recipients and volume

Every non-suspended application user whose role has the **staff_alerts**
capability receives each alert, up to 50 recipients. V1 gives that capability
only to **admin**; an ordinary customer is never selected. Adding another admin
therefore adds another alert recipient intentionally.

The traffic is incident-driven, not user-volume-driven. Normal sign-up,
checkout, renewal, cancellation, snapshot retention, and successful box
operations send no Resend email. Choose a Resend plan from measured alert volume
and the current provider limits; the code does not require a paid tier.

## Delivery model

**convex/staffAlerts.ts** inserts a deduplicated **staff_alerts** row before
trying email. The row records queue state, recipient count, Resend email ID,
latest delivery event, and any error. Disabled, recipient-less, or failed queue
attempts retry every 15 minutes. Rows remain for 180 days.

The **/resend/events** Convex HTTP route verifies Resend's signed webhook and
records **email.\*** delivery events. The staff console stays quiet when sending,
recipients, and tracking are healthy; it shows a warning when configuration,
queueing, bouncing, complaints, failure, or delivery delay needs attention.

## Alert policy

| Alert                | When it opens                                                                                             | Deduplication                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Checkout state       | Manual or Hetzner circuit-breaker enable/disable transition                                               | Once per transition                                      |
| Automatic suspension | Protection is enabled or disabled                                                                         | Once per transition                                      |
| Capacity             | Allocations are removed, or can no longer fit one complete box package                                    | Once per removal and capacity episode, plus one recovery |
| Box operation        | A provision, delete, reset, restore, recover, lifecycle, password, slug, or snapshot workflow ends failed | Once per operation                                       |
| Abuse/resource flag  | A sustained threshold creates a new flag; auto-suspension is marked critical                              | Once per flag                                            |
| Paid fulfillment     | Paid checkout lost capacity/slug, lacks Terms acceptance, or cannot be linked to an intent                | Once per checkout/order                                  |
| Account deletion     | Deletion remains unfinished for 24 hours                                                                  | Once per deletion request                                |
| Reconciliation       | Polar subscription or Hetzner orphan-resource reconciliation fails                                        | Rate-limited by time window                              |
| Orphaned server      | Hetzner server has no live database owner after the grace period                                          | Once per server set                                      |

Expected events do not email: unpaid checkout expiry/cancellation, customer
cancellation/refund, successful operations, routine snapshot cleanup, and an
individual transient metrics-poll failure. Those remain visible in their normal
provider, Convex log, or console surface. This boundary keeps an incident inbox
actionable.

## Setup from nothing

Repeat these steps for every Convex deployment that should deliver alerts.

1. Create a Resend account and a sending-access API key. Set
   **RESEND_API_KEY** on the Convex deployment.
2. For a development smoke test, **Composery <onboarding@resend.dev>** may be
   used as **ALERT_EMAIL_FROM**; Resend restricts that sender to the account
   owner's address.
3. For production, verify a **dedicated sending subdomain** of the marketing
   domain. Do not verify the apex `composery.io`, and do not use the
   runtime-box domain (`CLOUD_DOMAIN`, the hostname customer boxes are served
   on). A subdomain isolates alert-mail sending reputation from
   `www.composery.io`; it has no effect on SEO or search ranking, which do not
   read mail-authentication DNS.

   In **Resend → Domains → Add Domain**, enter a hostname such as
   `mail.composery.io`. Resend generates the exact records; add them verbatim in
   Cloudflare DNS, left **DNS-only / unproxied**, then wait for Resend to mark
   the domain **Verified**:
   - **DKIM** — a `TXT` record at `resend._domainkey.mail.composery.io` holding
     the `p=…` public key.
   - **SPF** — a `TXT` record (`v=spf1 include:amazonses.com ~all`) plus an `MX`
     record on the return-path host (e.g. `send.mail.composery.io`), which
     catches bounces. Resend sends through AWS SES, so the MX target is
     `feedback-smtp.<region>.amazonses.com`; copy the region shown.
   - Optionally a **DMARC** `TXT` at `_dmarc.mail.composery.io`.

   Then set **ALERT_EMAIL_FROM** to any address at the verified subdomain, e.g.
   `Composery <alerts@mail.composery.io>`. The local part is cosmetic; only the
   domain must match a verified identity.

4. In Resend, create a webhook for **<CONVEX_SITE_URL>/resend/events**. Enable
   **email.sent**, **email.delivered**, **email.delivery_delayed**,
   **email.bounced**, **email.complained**, **email.failed**,
   and no engagement-tracking events. Set its signing secret on the Convex
   deployment as **RESEND_WEBHOOK_SECRET**. Review the supported event list when
   upgrading the Convex Resend component.
5. Ensure at least one non-suspended **admin** exists. The console reports zero
   recipients otherwise.

## Launch check

1. Change the checkout toggle in development and confirm one **staff_alerts**
   row is created, one email reaches every intended admin, and the webhook
   advances its delivery event.
2. Change the toggle back and confirm the recovery/state-change alert.
3. Temporarily use an invalid sender in development, trigger an alert, and
   confirm the console exposes the queue problem; restore the sender and confirm
   the retry clears the queue state.
4. Complete a Polar sandbox checkout and confirm Polar sends the customer
   receipt while Resend sends no customer email.

Official references:

- https://resend.com/docs/dashboard/domains/introduction
- https://resend.com/docs/dashboard/api-keys/introduction
- https://resend.com/docs/dashboard/webhooks/introduction
