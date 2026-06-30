---
title: Cloudflare
description: Set up the Cloudflare zone and DNS-edit token the app uses to write per-box A/AAAA records.
---

Everything below is in the Cloudflare dashboard (`dash.cloudflare.com`). You need
exactly one **zone**: the apex domain that contains `CLOUD_DOMAIN`, e.g.
`<cloud-domain>`. Both environments share this single zone - production sets
`CLOUD_DOMAIN=<cloud-domain>` and dev sets `CLOUD_DOMAIN=dev.<cloud-domain>`, but
`dev.<cloud-domain>` is **not** a separate zone, just a subdomain the code writes
records under. So both [Convex](./convex.md) deployments get the **same**
`CLOUDFLARE_ZONE_ID`, and you can reuse one token for both (or make one per
deployment).

## Add the zone (once)

In the Cloudflare dashboard, onboard the apex domain `<cloud-domain>` (not the
`dev.` subdomain), pick the **Free** plan, and let Cloudflare scan existing DNS.
Cloudflare imports whatever your registrar already published, which for a freshly
registered domain is usually parking and default email records (an apex `A` to a
parking page, a `www` CNAME, registrar `MX` records, and a matching `spf1`
`TXT`). None of that is used by this product; you clean it up in the next step.
If you already added the zone and pointed the registrar's nameservers at
Cloudflare, this step is done - the zone exists the moment its DNS page loads.

Cloudflare then shows **two nameservers**. If DNSSEC is enabled at the
registrar, disable it before changing nameservers; stale DS records can make the
domain unreachable after delegation. Then go to your domain **registrar** and
replace the current nameservers with exactly those two Cloudflare nameservers.
Back in Cloudflare the zone flips from **Pending Nameserver Update** to
**Active** once delegation propagates. Cloudflare can store DNS records while
the zone is pending, but do not test real provisioning until it is Active
because normal public DNS will not reliably use the Cloudflare records before
delegation.

## Remove the imported registrar records and lock down mail

This domain is a runtime namespace only: it serves boxes at
`<slug>.<CLOUD_DOMAIN>` (records the app creates) and sends or receives **no**
email. Delete the records Cloudflare imported - the apex `A` parking record,
the `www` CNAME, and every registrar `MX` record - and replace the imported
`spf1` `TXT` so the domain announces that nothing sends mail as it. None of this
touches provisioning: the app manages per-slug `A`/`AAAA` records
(`convex/boxes/infra/cloudflareDns.ts`), not the apex, `www`, `MX`, or these
`TXT` records. End state - three `TXT` records, all anti-spoofing:

| Name                        | Type  | Value                                            |
| --------------------------- | ----- | ------------------------------------------------ |
| `@` (apex `<cloud-domain>`) | `TXT` | `v=spf1 -all`                                    |
| `_dmarc`                    | `TXT` | `v=DMARC1; p=reject; sp=reject; aspf=s; adkim=s` |
| `*._domainkey`              | `TXT` | `v=DKIM1; p=`                                    |

`sp=reject` extends the policy to every `<slug>` subdomain, so neither the apex
nor a box name can be spoofed. Skip a `rua=` reporting address; aggregate
reports are pointless for a domain that legitimately sends zero mail. Leaving
the apex with no `A` record means bare `https://<cloud-domain>` resolves to
nothing, which is fine - the website is `WEBSITE_ORIGIN` (`www.<website-domain>`)
and the product lives on the subdomains. To send the bare apex somewhere, add a
Cloudflare **Redirect Rule** to `<website-domain>` rather than re-adding an `A`.

## Zone ID

Open the domain and read the **Zone ID** from its **Overview** page (the
**API** section, lower on the page in the right-hand column, with a
click-to-copy control) -> `CLOUDFLARE_ZONE_ID`.

## API token

Tokens live at the user/account level, not on the zone page. Create a token from
**`https://dash.cloudflare.com/profile/api-tokens`** (or: account menu top-right
-> **My Profile** -> **API Tokens**) using the **Edit zone DNS** template. It
prefills **Permissions** = `Zone` -> `DNS` -> `Edit`. Under **Zone Resources**
choose **Include** -> **Specific zone** -> your `<cloud-domain>` zone. Copy the
token (shown once) -> `CLOUDFLARE_DNS_TOKEN`. The code only reads and writes
`dns_records` on that one zone (`convex/boxes/infra/cloudflareDns.ts`), so no
broader access is needed.

## Do not pre-create records; leave them DNS-only

You create no per-box records by hand - the app creates and updates the
`A`/`AAAA` records for each slug. They must stay **unproxied** (grey cloud, not
orange) with automatic TTL, because Caddy on each box runs its own automatic
HTTPS and its default ACME challenges need ports 80/443 to reach the box
directly. The code already creates them unproxied (`proxied: false`, `ttl: 1`);
if you ever flip a record to proxied (orange), Caddy's certificate issuance can
break.

Provisioning in dev is real: a completed sandbox checkout creates an actual
[Hetzner](./hetzner.md) server and actual Cloudflare DNS records at
`<slug>.<CLOUD_DOMAIN>`. Dev and production must not share a `CLOUD_DOMAIN`, or
a dev box and a production box with the same slug would fight over the same DNS
name. Dev uses `CLOUD_DOMAIN=dev.<cloud-domain>`, which can live in the same
`<cloud-domain>` zone: records become `<slug>.dev.<cloud-domain>` and never
collide with production `<slug>.<cloud-domain>`. Day-to-day UI/backend work
never triggers provisioning, so this only matters when you deliberately exercise
the lifecycle.

## References

- Cloudflare domain onboarding: https://developers.cloudflare.com/fundamentals/manage-domains/add-site/.
- Cloudflare zone status: https://developers.cloudflare.com/dns/zone-setups/reference/domain-status/.
- Cloudflare API tokens: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/.
- Cloudflare DNS API: https://developers.cloudflare.com/api/resources/dns/.
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/.
- Cloudflare DNS TTL: https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/.
