---
title: Cloudflare
description: Delegate both domains from Namecheap, serve the website, route email, and automate box DNS.
---

Namecheap remains the registrar. Cloudflare becomes the authoritative DNS
provider for both domains:

- `composery.io`: Vercel website, Clerk records, Resend sending records, and
  inbound email routing.
- `composery.cloud`: DNS-only records for hosted boxes.

Keeping DNS in one provider avoids editing records in the wrong dashboard and
lets `hello@composery.io` forward to the existing Gmail inbox at no cost.

## Delegate the domains from Namecheap

Add each apex domain as a separate Cloudflare Free zone. Review the records
Cloudflare imports, then copy the two assigned Cloudflare nameservers.

For each domain in Namecheap:

1. Open **Domain List -> Manage -> Nameservers**.
2. Choose **Custom DNS** and enter exactly the two Cloudflare nameservers.
3. If DNSSEC is enabled in Namecheap, remove the old DS record before changing
   nameservers. Re-enable DNSSEC from Cloudflare after the zone is Active.
4. Wait for Cloudflare to show **Active** before relying on its records.

The domains stay registered and renewed at Namecheap. After delegation, edit
DNS only in Cloudflare.

## Website zone: composery.io

Add both `composery.io` and `www.composery.io` to the Vercel project. Run
`vercel domains inspect` for each and create the exact A/CNAME/TXT records it
shows in Cloudflare. Keep the Vercel records **DNS only** unless Vercel's current
instructions explicitly say otherwise. Configure the apex to redirect to
`https://www.composery.io` in Vercel so there is one canonical origin.

Clerk, Resend, and any Vercel ownership checks also publish records in this
zone. Copy their generated values exactly; do not reuse examples from this
repository because provider-specific targets can change.

### Receive hello@composery.io

In Cloudflare **Email Routing**:

1. Add and verify `name@example.com` as a destination.
2. Enable Email Routing for `composery.io`; allow Cloudflare to add its MX and
   SPF records.
3. Add `hello@composery.io` -> `name@example.com`.
4. Test from a different mailbox. Sending a test from the destination Gmail
   account itself can be discarded as a loop.

This is forwarding, not a mailbox: incoming messages arrive in Gmail, while
replies come from Gmail. Move to a hosted mailbox later only if replies must
come from `hello@composery.io`. Do not enable Namecheap email forwarding too;
one domain must have one intentional MX setup.

## Runtime zone: composery.cloud

Production uses `CLOUD_DOMAIN=composery.cloud`; development uses
`CLOUD_DOMAIN=dev.composery.cloud`. Both are subdomains of the same
`composery.cloud` zone and use the same zone id. They must differ so a dev and
production box with the same slug cannot collide.

The runtime domain sends and receives no email. Remove imported parking and mail
records and publish:

| Name     | Type  | Value                                            |
| -------- | ----- | ------------------------------------------------ |
| `@`      | `TXT` | `v=spf1 -all`                                    |
| `_dmarc` | `TXT` | `v=DMARC1; p=reject; sp=reject; aspf=s; adkim=s` |

The app creates each box's A and AAAA records. Do not pre-create them. They stay
**DNS only** with automatic TTL because Caddy on the box terminates HTTPS and
must receive ACME traffic directly.

## Runtime API credentials

From the `composery.cloud` zone overview copy **Zone ID** to
`CLOUDFLARE_ZONE_ID`. Create an API token from the **Edit zone DNS** template,
restricted to **Zone / DNS / Edit** on that specific zone, and copy it once to
`CLOUDFLARE_DNS_TOKEN`.

The token and zone id belong only in each Convex deployment. The website zone
does not need an application API token.

## Check

- Namecheap shows Cloudflare's nameservers for both domains.
- Both Cloudflare zones are Active.
- `www.composery.io` serves Vercel and the apex redirects to it.
- Clerk's five production records verify.
- Mail to `hello@composery.io` reaches Gmail.
- Runtime A/AAAA records are DNS-only and dev uses the `dev` subdomain.

## References

- Cloudflare domain onboarding: https://developers.cloudflare.com/fundamentals/manage-domains/add-site/
- Cloudflare Email Routing: https://developers.cloudflare.com/email-service/get-started/route-emails/
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/
- Cloudflare API tokens: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- Vercel external DNS: https://vercel.com/docs/domains/set-up-custom-domain
- Namecheap custom nameservers: https://www.namecheap.com/support/knowledgebase/article.aspx/767/10/
