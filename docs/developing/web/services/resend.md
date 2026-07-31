---
title: Resend
description: Configure and verify operational alert and box owner notice delivery.
---

Resend sends two kinds of mail: operational alerts to internal administrators,
and four notices to the owner of a box. Polar owns all customer-facing order,
subscription, renewal, cancellation, refund, and payment email, and Clerk owns
all identity email; Composery restates neither. There is no onboarding sequence,
marketing mail, or inbound-mail flow.

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

**convex/staff/alerts.ts** inserts a deduplicated **staff_alerts** row before
trying email. The row records queue state, recipient count, Resend email ID,
latest delivery event, and any error. Disabled, recipient-less, or failed queue
attempts retry every 15 minutes. Rows remain for 180 days. **convex/email.ts**
owns the Resend client and answers whether a given class of mail can be sent at
all, so the alerts and the owner notices cannot disagree about it.

The **/resend/events** Convex HTTP route verifies Resend's signed webhook and
records **email.\*** delivery events. The staff console stays quiet when sending,
recipients, and tracking are healthy; it names the alerts that need attention
when one is unqueued, bounced, complained about, failed, or delayed. An alert
Resend has not reported on counts as unaccounted for only where
**RESEND_WEBHOOK_SECRET** is set: without it no event can ever arrive, and the
console reports that missing configuration itself rather than restating it once
per alert.

## Alert policy

An alert opens on a fact a staff member has to act on, and only on one: a
protection changing state, a workflow ending failed, a paid checkout that could
not be delivered, a resource nobody owns, a sweep that gave up. Every one is
raised through `raiseAlert` (**convex/staff/alerts.ts**), and the call sites are
the list - this page deliberately does not restate them, because an enumeration
of eighteen alerts in a document is one that silently falls behind the code, and
this one had.

What each alert is _about_ is its deduplication key, so re-raising it is a no-op
until the thing it names changes. That is the whole mechanism, and it is what
lets a sweep run every fifteen minutes without mailing anybody twice: a key
naming one box, operation, order, flag or server opens once for that subject; a
key naming a time window opens once per window, for the failures that are
properties of the deployment rather than of any one row.

Expected events do not email: unpaid checkout expiry/cancellation, customer
cancellation/refund, successful operations, routine snapshot cleanup, and an
individual transient metrics-poll failure. Those remain visible in their normal
provider, Convex log, or console surface. This boundary keeps an incident inbox
actionable.

## Box owner notices

**convex/ownerEmail.ts** sends the owner of a box exactly four notices, from
**OWNER_EMAIL_FROM**. Each is sent from the lifecycle mutation that makes it
true, and each is something the owner cannot learn any other way at the moment
it happens, because nobody opens the website to check whether a box they were
not using is still there.

| Notice        | When it is sent                               | What it says                                                         |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Deleted       | A delete operation succeeds                   | The box and its snapshots are gone and cannot be recovered, plus why |
| Suspended     | A suspend operation settles at **suspended**  | The server is off, the files are intact, and how to have it reviewed |
| Unsuspended   | An unsuspend operation settles at **running** | The box is back                                                      |
| Create failed | A **create** operation ends failed            | Nothing is running, staff already know, and it need not be reported  |

Two rules decide the wording, and both exist so a message cannot leak what was
written for someone else:

- **The deletion reason is read from the operation's trigger**, which is the only
  record of who ordered the teardown that reaches the mutation finishing it. A
  subscription ending, an account deletion, and a staff comp revoke each get
  their own sentence; `system:delete_retry` gets none, because an operation that
  re-drives someone else's deletion genuinely does not know the reason.
- **An automatic suspension's reason is forwarded; a staff suspension's is
  not.** The automatic text is generated from the threshold the owner was
  measured against, so it is factual and about them. A staff reason is a
  free-text note written into the console for other staff, and forwarding it
  would publish an internal note to its subject. The rule keys on the sender,
  not on how any individual note reads.

An owner notice never carries an operation's error text: those are written for
staff and carry host names, provider messages, and addresses.

Everything else about a box - started, stopped, snapshotted, repaired, an update
waiting, a failed reset - is on the box's own page and is not mailed. A failed
**delete** is deliberately silent too: the owner never asked for it, the hourly
sweep is already retrying, and there is nothing for them to do but worry.

Notices are not queued, retried, or tracked per message. If the send cannot be
queued, one **warning** alert per six-hour window tells staff, and the notice is
dropped rather than re-sent later against a box whose state has since moved on.

A notice that is accepted and then fails to arrive has no row to record it
against, so **/resend/events** raises a staff alert instead, from the event
payload alone - Resend echoes the recipient and the subject, and an owner
notice's subject names its box. Two severities, because they are two different
problems:

| Event                           | Severity     | Why                                                                                                                       |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `email.bounced`, `email.failed` | **warning**  | One owner was not told what happened to their box. Nothing retries it; reaching them is a manual step, if it is worth one |
| `email.complained`              | **critical** | Not the recipient's problem but the sender's: owner notices and staff alerts share one verified domain, so one reputation |

The complaint case is why this is tracked at all. Deliverability is the reason
the two streams share a sending subdomain, and it is also what couples them: an
owner marking a service notice as spam degrades the channel the alerts ride on.
Unreported, that surfaces later as staff alerts quietly failing to deliver - the
symptom without the cause, exactly when the alert channel is the broken thing.
Repeated complaints are the signal to split the two streams onto separate
subdomains and warm the new one.

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
   - **DKIM:** a `TXT` record at `resend._domainkey.mail.composery.io` holding
     the `p=…` public key.
   - **SPF:** a `TXT` record (`v=spf1 include:amazonses.com ~all`) plus an `MX`
     record on the return-path host (e.g. `send.mail.composery.io`), which
     catches bounces. Resend sends through AWS SES, so the MX target is
     `feedback-smtp.<region>.amazonses.com`; copy the region shown.
   - Optionally a **DMARC** `TXT` at `_dmarc.mail.composery.io`.

   Then set **ALERT_EMAIL_FROM** and **OWNER_EMAIL_FROM** to addresses at the
   verified subdomain, e.g. `Composery <alerts@mail.composery.io>` and
   `Composery <hello@mail.composery.io>`. The local part is cosmetic to Resend;
   only the domain must match a verified identity. Keep them different anyway,
   so what a customer sees - and replies to, since owner notices set a
   `Reply-To` of the support address - is not the incident inbox.

   Both senders share the verified subdomain deliberately. Splitting them across
   two domains would mean two reputations to warm and monitor for one low-volume
   transactional stream; the separation that matters for deliverability is
   transactional mail against marketing mail, and Composery sends no marketing
   mail at all.

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
   receipt while Resend sends no email about the payment.
5. Suspend a development box from the staff console with a reason, and confirm
   the owner's notice says staff suspended it and does **not** contain the
   reason you typed. Unsuspend it and confirm the second notice.
6. Delete a development box and confirm its owner receives one deletion notice
   naming why, that its `Reply-To` is the support address, and that the box's
   event log holds a matching `box.owner_emailed` entry.

Official references:

- https://resend.com/docs/dashboard/domains/introduction
- https://resend.com/docs/dashboard/api-keys/introduction
- https://resend.com/docs/dashboard/webhooks/introduction
