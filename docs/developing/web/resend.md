---
title: Resend
description: Send optional abuse alerts to staff.
---

Resend is used only by `convex/boxes/boxMetrics.ts` for staff abuse alerts.
Without `RESEND_API_KEY`, flags still appear in the staff console and email is
skipped.

## Setup

1. Create a Resend API key with **Sending access** and store it as
   `RESEND_API_KEY` in each Convex deployment that should send alerts.
2. For initial testing, `Composery <onboarding@resend.dev>` can send only to
   the Resend account owner's address.
3. Before alerts must reach other admins, add a verified sender identity in
   Resend. If that identity is a domain, add the exact SPF, DKIM, and
   return-path records Resend shows to its DNS zone, then wait for **Verified**.
4. Set `ALERT_EMAIL_FROM` to the verified sender identity.

If you verify a domain, prefer a dedicated alert subdomain so operational alert
sending stays isolated from the website apex. Never use `composery.cloud`, which
intentionally sends no mail.

Alerts go to every non-suspended admin user's Clerk email, capped by the code.
No Resend webhook is used.

## Check

- Trigger a development flag and confirm it appears in the console.
- With Resend configured, confirm the owner receives the message.
- After domain verification, test a second recipient.

## References

- Resend domains: https://resend.com/docs/dashboard/domains/introduction
- Resend API keys: https://resend.com/docs/dashboard/api-keys/introduction
