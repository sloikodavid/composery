---
title: Resend
description: Optional abuse-alert emails to staff, sent via Resend.
---

Resend delivers the abuse alert emails that box metrics flags send to staff
(`convex/boxes/boxMetrics.ts`). Alerts are optional: with `RESEND_API_KEY`
unset, flags are still recorded and visible in the console - only the emails
are skipped.

1. **Create an account** at `resend.com`. Sign up with the address that should
   receive alerts: an account with no verified domain may send only **to the
   account owner's own email**, which is exactly the solo-operator setup.
2. **API key.** Create an API key in the Resend dashboard (API Keys -> Create
   API Key) with **Sending access** permission - the code only sends
   (`convex/boxes/boxMetrics.ts`); it registers no webhooks. Copy the key ->
   `RESEND_API_KEY`.
3. **From address.** Keep `ALERT_EMAIL_FROM=Composery <onboarding@resend.dev>`,
   Resend's shared address for accounts without a verified domain.
4. **More recipients (later).** Alerts go to every non-suspended `admin` user.
   Deliverability beyond the account owner requires verifying a domain: in the
   Resend dashboard, add a domain (Domains -> Add Domain), publish the DNS
   records Resend shows, then point `ALERT_EMAIL_FROM` at that domain. Verify the
   website domain (`<website-domain>`) or a subdomain of it - never `CLOUD_DOMAIN`,
   whose [Cloudflare](./cloudflare.md) zone is deliberately locked to "sends no
   mail".
