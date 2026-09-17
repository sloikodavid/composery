# Research Sharing Models

Source: https://chatgpt.com/share/6aac15b8-e744-83eb-8bfa-316b4987dd16

---

## Turn 1: User

_2026-09-17T16:15:07.125Z_

Research how, as of September 2026, products implement sharing — letting one user grant another user access to a resource they own. Cover at least these products: GitHub (both repositories and organizations), GitLab, Vercel teams, Netlify, Render, Railway, Fly.io organizations, DigitalOcean teams, Hetzner Console project members, Linear, Figma, Notion, and Google Drive.

For each product, determine:

- what the sharer has to enter (a username, an email address, a link, or a selection from a list)
- whether the invitee needs an existing account
- whether access takes effect immediately or sits as a pending invite until the invitee accepts
- how a pending invite gets matched to an account — via primary email only, any verified email on the account, or an explicit acceptance step
- how long the invite remains valid and how it can be revoked
- whether the product leaks information about whether a given email or username is already registered
- what happens if the invitee subsequently changes the email address or username that was originally used

Also document known security issues tied to each approach — including cases where an invitation was claimed by the wrong person after an email address was reassigned or changed hands.

Don't rank the different approaches against each other.

---

## Turn 2: ChatGPT

_2026-09-17T16:25:24.317Z_

I’ll build this as a product-by-product evidence table, separating documented behavior from reported security incidents. Where a product has multiple sharing paths (for example, direct collaborator vs. org/team invite vs. share link), I’ll call those out rather than collapsing them into one model.

---

## Turn 3: ChatGPT

_2026-09-17T16:25:39.654Z_

A pattern is already emerging in the documentation: some products bind an invite to an existing account identity (username/account object), while others create an email-address capability that remains pending until claimed. I’m checking the edge cases now—expiry, cancellation, account/email changes, and whether the UI/API reveals account existence—because those are where the security differences show up.

---

## Turn 4: ChatGPT

_2026-09-17T16:26:30.725Z_

Below is a snapshot of the sharing/invitation models I could verify as of **17 September 2026**. I’ve treated “sharing” as granting a human principal access to a private resource or workspace, rather than public-link publishing. Where the vendor does not publicly document a detail, I mark it **not documented** rather than inferring implementation from the UI.

A useful distinction throughout is between:

- **account-bound grants** — the system has already resolved the recipient to a particular user/account object;
- **address-bound invitations** — an email address is the intended identity until somebody proves control of it and accepts;
- **bearer invite links** — possession of the URL is the authority to join.

Those have materially different behavior when names or email addresses later change.

## Comparison

| Product / sharing path | What the sharer enters | Existing account required? | When access starts | How a pending invite is matched / claimed | Validity & revocation | Account-enumeration leakage | What if email / username later changes? |
|---|---|---|---|---|---|---|---|
| **GitHub — personal repository collaborator** | In the UI, search/select a GitHub person; GitHub documentation says invitations can also be sent to an email address. ([GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository?utm_source=chatgpt.com)) | Ultimately yes; a person without GitHub must create an account. | **Pending until acceptance.** The collaborator gets access only after accepting. ([GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository?utm_source=chatgpt.com)) | Account-targeted invitations are accepted by that GitHub account. For email-address invitations in GitHub's org/repository invitation machinery, GitHub uses account email identity rather than merely possession of an arbitrary URL; org docs explicitly require the address to be a **verified email associated with the accepting account**. ([GitHub Docs](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization?utm_source=chatgpt.com)) | Repository invitations can be explicitly deleted through GitHub's invitation API; GitHub documents a 7-day lifetime for pending outside-collaborator invitations in its licensing docs. ([GitHub Docs](https://docs.github.com/en/enterprise-cloud%40latest/billing/reference/github-license-users?utm_source=chatgpt.com)) | Searching by username/name exposes resolvable GitHub identities, but GitHub usernames/profiles are normally public anyway. Email-to-account resolution can also be observable in invitation/billing behavior, so it is not a perfectly opaque “send mail blindly” interface. | **After acceptance:** the ACL belongs to the GitHub user, so subsequent username/email changes do not turn the collaborator into a different person. **Before acceptance:** an email-targeted invitation follows GitHub's verified-email ownership test at acceptance time. |
| **GitHub — organization membership** | Username, full name, or email address. ([GitHub Docs](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization?utm_source=chatgpt.com)) | No at send time; the invitee can establish an account before accepting. | **Pending until explicit acceptance.** ([GitHub Docs](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization?utm_source=chatgpt.com)) | If invited by email, the accepting GitHub account must have that address among its **verified emails** — it is explicitly **not restricted to the primary email**. ([GitHub Docs](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization?utm_source=chatgpt.com)) | **7 days**; owner can edit/cancel while pending and retry/cancel after expiry. ([GitHub Docs](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization?utm_source=chatgpt.com)) | Username/full-name search visibly resolves existing accounts. An email invitation that matches an existing verified address may also behave differently for licensing purposes. ([GitHub Docs](https://docs.github.com/en/enterprise-cloud%40latest/billing/reference/github-license-users?utm_source=chatgpt.com)) | After acceptance, membership remains attached to the GitHub account if the user changes username or primary email. An unaccepted email invite can be accepted by any account that can make that exact address a verified address during the invitation window. |
| **GitLab — project/group membership** | **Username for an existing GitLab user; email for somebody without an account.** ([GitLab Docs](https://docs.gitlab.com/user/project/members/?utm_source=chatgpt.com)) | No for an email invite. | **Username:** added immediately to membership. **Email:** pending invitation; recipient is prompted to create an account. ([GitLab Docs](https://docs.gitlab.com/user/project/members/?utm_source=chatgpt.com)) | GitLab's email identity model includes primary and confirmed secondary addresses; its own code/docs distinguish finding a user by “any email.” Confirmed secondary addresses are valid account-associated addresses in other identity-matching paths. ([GitLab Docs](https://docs.gitlab.com/user/profile/?utm_source=chatgpt.com)) | Unaccepted email invitations are deleted after **90 days**; reminders go after 2, 5 and 10 days. Membership itself can separately have an access-expiry date. ([GitLab Docs](https://docs.gitlab.com/user/project/members/?utm_source=chatgpt.com)) | **Yes for usernames:** the UI explicitly distinguishes “existing account → enter username” from “no account → email”, so username existence is discoverable. Public profiles further make usernames enumerable. Email existence is more complicated and not documented as intentionally exposed. | Username-invited membership is immediately bound to the user object, so later username/email changes do not transfer access. Email invites are vulnerable to whatever account successfully establishes the invited address before claiming the invitation. |
| **Vercel teams** | Email address, or a **team invite link**. CLI likewise supports `vercel teams invite [email]`. ([Vercel](https://vercel.com/docs/rbac/managing-team-members?utm_source=chatgpt.com)) | No clear requirement at send time; acceptance requires becoming/signing in as a Vercel user. | Email invitation is **pending**; not automatically a member. Invite-link users join through the link. ([Vercel](https://vercel.com/docs/rbac/managing-team-members?utm_source=chatgpt.com)) | Public docs do not specify whether an email invite matches only primary vs. any verified address. Vercel accounts can have **up to three verified emails and all can be used to log in**, while one is designated primary. ([Vercel](https://vercel.com/docs/accounts?utm_source=chatgpt.com)) | **7 days**, or **30 days for SAML-enforced teams**. Invite links persist until the owner uses **Reset Invite Link**, which invalidates prior links. ([Vercel](https://vercel.com/docs/rbac/managing-team-members?utm_source=chatgpt.com)) | No documented promise that the invite flow is non-enumerating. The public docs do not establish whether typing an email exposes account existence. | Accepted membership is an account-level membership, so changing primary email does not itself replace the team member. An unanswered invite's exact behavior after email aliases are changed is **not publicly documented**. |
| **Netlify teams / project access** | Email address. A private project can likewise invite “anyone by email,” even if they are not already a team member. ([Netlify Docs](https://docs.netlify.com/manage/accounts-and-billing/team-management/manage-team-members/?utm_source=chatgpt.com)) | **No.** New Netlify users can be invited. | **Pending invite**; existing users see it in their dashboard and can accept from there or email. Under Organization SSO, a newly invited user must accept and verify email before first SSO login. ([Netlify Docs](https://docs.netlify.com/manage/accounts-and-billing/team-management/manage-team-members/?utm_source=chatgpt.com)) | Explicit acceptance. With Organization SSO the invitation email must use the **same email address connected to the IdP**, and the recipient verifies that address before login. ([Netlify Docs](https://docs.netlify.com/manage/security/secure-netlify-access/configure-organization-saml-sso/?utm_source=chatgpt.com)) | Owners can manage/filter pending invitations; public team-member docs do **not state a general invitation expiry period**. | No documented account-existence guarantee either way. The normal invite screen is email-oriented rather than a public user directory. | Once accepted, access is user/team membership rather than a raw email ACL. For SSO organizations, identity remains additionally constrained by the IdP. Behavior of an ordinary outstanding invitation after an account email change is **not documented**. |
| **Render workspace / organization** | Email address plus role. ([Render](https://render.com/docs/team-members?utm_source=chatgpt.com)) | Not clearly required before invitation. | There is an explicit **accept** event; invitation is therefore pending until claimed. ([Render](https://render.com/docs/audit-logs?utm_source=chatgpt.com)) | Normal-flow matching details are not documented. If a workspace enforces Google login, Render is unusually explicit: the person must sign in with the **Google account matching the invited email address**, and Render prevents changing the Render email while subject to that policy. ([Render](https://render.com/docs/login-settings?utm_source=chatgpt.com)) | Removal after joining is documented; public docs I found do **not document a standard pending-invite expiration period** or a detailed pending-revoke UI. | Not documented as an enumeration-resistant API; the invitation interface itself accepts arbitrary email. | Accepted membership follows the Render account. Under enforced Google login the invited address is deliberately sticky: team members **cannot change their associated Render email** while that enforcement applies. ([Render](https://render.com/docs/login-settings?utm_source=chatgpt.com)) |
| **Railway projects** | Either **email + permission scope** or a generated **project invite link**. ([Railway Docs](https://docs.railway.com/projects?utm_source=chatgpt.com)) | No: Railway staff explicitly state that a recipient need not create their own account first and can create it through the invitation flow. ([Railway Central Station](https://station.railway.com/questions/sign-up-rate-limit-15c44cfd?utm_source=chatgpt.com)) | Invitation/join step is required. Railway has historically shown “pending” invitations. ([Railway Central Station](https://station.railway.com/questions/i-ve-invited-someone-to-be-a-member-of-m-cc112b14?utm_source=chatgpt.com)) | Email invitation contains a join link. Public docs do not define primary-vs-secondary-email matching semantics. Bearer invite links are not address-bound. | No expiry for normal membership invitations is documented. More importantly, the current project docs describe a generated invite link but no documented reset/revoke control; a 2026 support question specifically asks how to revoke a reusable link and had no answer. ([Railway Docs](https://docs.railway.com/projects?utm_source=chatgpt.com)) | The invite-by-email form necessarily validates email syntax, but account-registration leakage is not documented. | Accepted access becomes project membership. Link-based invitations are independent of the intended person's email and therefore remain usable by whoever possesses the link until the product invalidates it. |
| **Fly.io organizations** | Email address: `fly orgs invite [slug] [email]`. ([Fly.io](https://fly.io/docs/flyctl/orgs-invite/?utm_source=chatgpt.com)) | Not stated as a prerequisite. | Explicitly **pending until the recipient responds**. ([Fly.io](https://fly.io/docs/flyctl/orgs-invite/?utm_source=chatgpt.com)) | Explicit response to the invitation. Public docs do not say primary-only vs. any account email. | Fly distinguishes accepted members from pending invites: `orgs remove` is for accepted members and its docs direct you to **`orgs revoke`** for an unaccepted invitation. ([Fly.io](https://fly.io/docs/flyctl/orgs-remove/?utm_source=chatgpt.com)) Expiry duration is not documented in the pages I could verify. | No documented account-existence disclosure. | After acceptance, organization membership belongs to the Fly user. Outstanding-invite behavior if the address moves to a different Fly account is **not publicly specified**. |
| **DigitalOcean teams** | One or more **email addresses**, with role. ([DigitalOcean](https://docs.digitalocean.com/platform/teams/how-to/manage-membership/?utm_source=chatgpt.com)) | No documented requirement to already have a DigitalOcean account. | Status is explicitly **Pending** until recipient accepts; then **Joined**. ([DigitalOcean](https://docs.digitalocean.com/platform/teams/how-to/manage-membership/?utm_source=chatgpt.com)) | Explicit email invitation acceptance. Primary-vs-any-email account matching is not publicly documented. | Pending invitation can be **resent or cancelled**. The documentation I found does not specify automatic expiry. ([DigitalOcean](https://docs.digitalocean.com/platform/teams/how-to/manage-membership/?utm_source=chatgpt.com)) | No documented email-account enumeration behavior. | Once joined, the team row represents the DigitalOcean account/member. Pending-address reassignment behavior is not documented. |
| **Hetzner Console project members** | Email address + role. ([Hetzner Docs](https://docs.hetzner.com/cloud/general/faq/?utm_source=chatgpt.com)) | **No.** Hetzner explicitly permits existing customers and external people. | Pending until recipient uses the **special link**. | Link sends the recipient to Hetzner login, where they either sign in to an existing Hetzner Account or create a new/light account. ([Hetzner Docs](https://docs.hetzner.com/cloud/general/faq/?utm_source=chatgpt.com)) | Public FAQ describes invitation and membership management but I found **no authoritative public expiry period** for a project-member invitation. | No documented registration-status disclosure from the invite form. | After acceptance access belongs to the Hetzner account. The public docs do not say whether the acceptance flow additionally requires the logged-in account's email to equal the invited address, which is an important undocumented edge case. |
| **Linear workspace** | Email address; additionally Linear supports a persistent **workspace invite link** and “approved email domains.” ([Linear](https://linear.app/docs/invite-members?utm_source=chatgpt.com)) | No. New user can follow the mailed invitation; SAML JIT can create an account automatically. ([Linear](https://linear.app/docs/invite-members?utm_source=chatgpt.com)) | Email invitation is pending; Linear explicitly has a **Pending invites** member filter. Invite-link/domain flows can join without per-person approval. ([Linear](https://linear.app/docs/members-roles?utm_source=chatgpt.com)) | Email link + sign-in/signup. Exact primary-vs-alias matching isn't documented in the invitation page. With SAML, identity matching is delegated to the IdP. | The normal invite's default lifetime is not stated in the help article; its API schema exposes an `expiresAt` field that can be null, indicating invitations can be configured not to expire. Invite links are explicitly **persistent and reusable until “Reset invite link.”** ([Linear](https://linear.app/docs/invite-members?utm_source=chatgpt.com)) | No documented per-email account enumeration from the invite UI. | Accepted user remains the member if their login email changes. A separate and significant lifecycle hazard exists for **approved domains**: Linear explicitly warns that if your organization gives up/transfers a domain, you must remove it or the new domain owner could obtain workspace access. ([Linear](https://linear.app/docs/invite-members?utm_source=chatgpt.com)) |
| **Figma files / plans** | Files: email address or user-group name, or general link access. Plans: email invitation or **plan invite link**. ([Figma Help Center](https://help.figma.com/hc/en-us/articles/360040531773-Share-files-and-prototypes?utm_source=chatgpt.com)) | Public-link viewers can in some cases access without being a plan member; direct membership/collaboration normally resolves to a Figma identity after login/signup. | Figma has a distinct **pending invitation** state, so direct plan/org invites are not necessarily immediate. ([Figma Help Center](https://help.figma.com/hc/en-us/articles/31825370509591-Governance-for-Figma?utm_source=chatgpt.com)) | Explicit join/acceptance. Public docs I found do not state whether direct email invitations match only the account's primary email or all verified aliases. | Plan invite links can be turned on/off by admins; direct-invite expiry is not documented in the sources I found. One special education **folder join link** has a documented **90-day expiry** and can be refreshed/disabled. ([Figma Help Center](https://help.figma.com/hc/en-us/articles/42200195268119-Invite-users-to-your-Starter-or-Professional-plan?utm_source=chatgpt.com)) | Organization members can search for members/guests; this deliberately reveals existing organization identities. ([Figma Help Center](https://help.figma.com/hc/en-us/articles/4420557314967-Members-guests-and-limited-access?utm_source=chatgpt.com)) Public documentation does not establish arbitrary-email registration enumeration. | Once a permission is attached to a Figma user it remains an account permission rather than following a textual email. Outstanding direct-invite behavior across email changes is not documented. |
| **Notion workspace members / page guests** | Email address, or a secret **workspace invite link**. Page guests are invited by email. ([Notion](https://www.notion.com/help/add-members-admins-guests-and-groups?utm_source=chatgpt.com)) | **No.** A page guest who does not have Notion must sign up. ([Notion](https://www.notion.com/help/add-members-admins-guests-and-groups?utm_source=chatgpt.com)) | Email invitations remain pending until accepted; invite-link users can join automatically as members after following the secret link. ([Notion](https://www.notion.com/help/add-members-admins-guests-and-groups?utm_source=chatgpt.com)) | Notion now supports multiple **verified email aliases** on one account; any verified alias can be used to log in and **receive shares**, all pointing to the same account identity. ([Notion](https://www.notion.com/en-gb/help/account-settings?utm_source=chatgpt.com)) | Normal member/guest invitation expiry is not publicly stated in the cited help. Secret workspace invite links remain usable until admins turn the feature off/change the link. Pending invitations can be managed in workspace settings. ([Notion](https://www.notion.com/help/add-members-admins-guests-and-groups?utm_source=chatgpt.com)) | The sharing picker can distinguish known people/workspace members; arbitrary external email registration leakage is not documented. Notion does disclose that an email is already tied to another Notion account when you try to add it as an alias. ([Notion](https://www.notion.com/en-gb/help/account-settings?utm_source=chatgpt.com)) | After acceptance, access follows the Notion account. This is particularly explicit because old/new **verified aliases all map to a single account identity**. Removing an alias should therefore not move existing page permissions to whoever later acquires that email; the permission remains with the original account. ([Notion](https://www.notion.com/en-gb/help/account-settings?utm_source=chatgpt.com)) |
| **Google Drive — specific-person sharing** | Email address or Google Group; alternatively “Anyone with the link.” ([Google Help](https://support.google.com/drive/answer/2494822?hl=en&utm_source=chatgpt.com)) | Normally the target needs a Google Account, but Workspace admins can enable **visitor sharing** for non-Google addresses. ([Google Help](https://support.google.com/drive/answer/6033939?hl=en-GB&utm_source=chatgpt.com)) | For an existing Google Account, the ACL is effectively established when the owner shares: accepting the notification is not what creates the permission. The recipient may need to open it before it appears in “Shared with me.” Visitor sharing requires email verification. ([Google Help](https://support.google.com/drive/answer/7166529?hl=en&utm_source=chatgpt.com)) | Normal restricted sharing is tied to the **Google account associated with that email**, not merely an email message. Visitor sharing instead verifies control of the exact email with a PIN and provides a 7-day visitor session. ([Google Help](https://support.google.com/drive/answer/9195194?hl=en&utm_source=chatgpt.com)) | Ordinary Google-account ACLs have no “invite expiry” by default; owner removes access or can set an access expiration on eligible Workspace plans. Visitor authorization lasts **7 days per verification**, after which the original invitation can be used to verify again. ([Google Help](https://support.google.com/drive/answer/2494822?hl=en&utm_source=chatgpt.com)) | **Potentially yes.** If visitor sharing isn't available, Drive can tell the sharer that an address is not associated with a Google Account and that the person must create one; that inherently discloses Google-account registration status for the supplied address. ([Google Help](https://support.google.com/drive/answer/6033939?hl=en-GB&utm_source=chatgpt.com)) | Once a normal share is attached to a Google account, changing that account's primary/contact email does not conceptually turn the ACL into access for a future holder of the old mailbox. Visitor sharing is different: it intentionally treats continuing control of the mailbox as the identity proof and requires periodic re-verification. |

### Two noteworthy wrinkles

**GitHub distinguishes username-bound and email-bound invitations in a security-relevant way.** An organization invite sent to `alice` is already aimed at Alice's GitHub account. An invite sent to `alice@example.com` can instead be accepted by a GitHub account that proves that exact address is one of its **verified** addresses. The distinction survives even into GitHub's licensing implementation: an invite by verified email can be recognized as belonging to a user who already consumes a license, whereas a raw email invitation can temporarily consume another pending seat. ([GitHub Docs](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization?utm_source=chatgpt.com))

**Google Drive is not really an “invitation” system in the same sense.** For a Google-account principal, creating the ACL is the grant; the notification email is only a notification. Google’s visitor-sharing mode is much closer to a conventional email capability: control of the mailbox is re-proved by PIN, and that proof expires after seven days. ([Google Help](https://support.google.com/drive/answer/9195194?hl=en&utm_source=chatgpt.com))

## Security issues associated with these models

The main security question is not simply “does the user click Accept?” It is **what identity proposition the service believes the acceptance proves**.

### 1. Email-address reuse and reassignment

An invitation that remains bound to a raw email address effectively says:

> “Whoever legitimately controls this mailbox while this invitation is valid may become this member.”

That can differ from the sender's intent, which is usually “this particular human.”

If an employee leaves and their corporate address is later reassigned, if an expired domain is re-registered, or if an ISP/provider recycles an address, a still-valid email-bound invitation can therefore become claimable by a different human. Short expiry times reduce this window; binding an invite to a pre-existing user/account ID eliminates this particular ambiguity.

Of the products above, **Linear explicitly documents the domain-level version of this risk**: an “approved email domain” allows anyone with an address at that domain to join; Linear warns admins that if they cancel or transfer the domain, they must remove it from the approved-domain list “to prevent unwanted access to the workspace.” ([Linear](https://linear.app/docs/invite-members?utm_source=chatgpt.com))

This same principle applies to address-level invitations even where I found no vendor-specific incident report: mailbox ownership is a mutable real-world property.

### 2. GitLab had a real invitation-hijacking vulnerability

GitLab is the strongest documented example I found of the identity-binding layer itself being exploitable.

PortSwigger researcher James Kettle found a race condition in GitLab's email-change/confirmation flow. Concurrent email-change requests could cause a valid confirmation token intended for one address to be delivered to another. He demonstrated that he could get an address he did not control marked as **validated** on his account. ([PortSwigger](https://portswigger.net/research/smashing-the-state-machine))

That mattered directly for sharing: Kettle states that obtaining an illegitimately validated email address enabled **“invitation-hijacking”** attacks. GitLab assigned the underlying issue **CVE-2022-4037** and patched it in **15.7.2 on 4 January 2023**. ([PortSwigger](https://portswigger.net/research/smashing-the-state-machine))

The lesson is important: a design such as “an invite may be accepted by any account with verified ownership of this email” is only as strong as the product's email-verification mechanism.

GitLab also previously allowed **unverified secondary emails to reserve an address**, preventing the legitimate owner from creating/attaching it to another account. GitLab's own issue tracker describes this as a security problem and notes its interaction with invitation acceptance. Since GitLab 17.0, unverified secondary addresses are automatically deleted after three days. ([GitLab](https://gitlab.com/gitlab-org/gitlab/-/work_items/367823?utm_source=chatgpt.com))

### 3. “Verified email” must really mean verified

A closely related, current example outside the requested products illustrates the generic failure mode unusually clearly. **CVE-2026-53514** in Better Auth's organization plugin allowed an attacker to preregister an account using a victim's email when verification was disabled; `acceptInvitation` merely compared the invite email with the unverified email string in the session. The attacker could therefore accept an organization invitation addressed to the victim. ([GitLab Advisory Database](https://advisories.gitlab.com/npm/better-auth/CVE-2026-53514/?utm_source=chatgpt.com))

That is the difference between:

`session.user.email == invitation.email`

and:

`session.user has cryptographically/procedurally demonstrated current control of invitation.email`.

The first is not a secure identity binding unless the surrounding account system guarantees verification.

### 4. Account “pre-hijacking”

Sudhodanan and Paverd's USENIX Security 2022 work studied a broader class of **account pre-hijacking** problems: an attacker does something using the victim's email *before* the legitimate person creates their account, and defects in registration/account-merging later allow the attacker to regain access. They tested 75 major services and found at least 35 susceptible to one or more of the studied attack classes. ([USENIX](https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan?utm_source=chatgpt.com))

That research is not evidence that all or any particular one of the 2026 products in this table is currently vulnerable. It is relevant because email-invite systems often cross exactly the same state boundary:

`email with no account → invitation → account creation / SSO → email verification → membership`.

If those transitions are not atomic and identity ownership isn't rechecked at the right point, an invitation becomes another route into a pre-hijacked account.

### 5. Reusable invite links have a different failure mode

A reusable team/project invite link is fundamentally a **bearer credential**. It does not answer “who did the inviter intend?” It answers “who possesses this URL?”

That applies to the documented link mechanisms in:

- Vercel — link remains usable until **Reset Invite Link**; resetting invalidates older links. ([Vercel](https://vercel.com/docs/rbac/managing-team-members?utm_source=chatgpt.com))
- Linear — invite links are explicitly **persistent and reusable** and stay so until reset. ([Linear](https://linear.app/docs/invite-members?utm_source=chatgpt.com))
- Notion — a secret workspace link lets its holder automatically join as a member. ([Notion](https://www.notion.com/help/add-members-admins-guests-and-groups?utm_source=chatgpt.com))
- Railway — each project has an invite link; current documentation doesn't describe an invalidation/reset operation, and a 2026 support thread specifically asks how to revoke one. ([Railway Docs](https://docs.railway.com/projects?utm_source=chatgpt.com))
- Figma — plan/folder join links similarly allow anyone possessing the URL to join within their configured scope. ([Figma Help Center](https://help.figma.com/hc/en-us/articles/42200195268119-Invite-users-to-your-Starter-or-Professional-plan?utm_source=chatgpt.com))

These links therefore survive staff email changes entirely; their security boundary is **link secrecy and revocation**, not account-email lifecycle.

### 6. Domain-based automatic joining amplifies reassignment risk

Linear's approved-domain model and Railway's trusted-domain feature are effectively invitation rules for an entire namespace rather than a person. Railway, for example, automatically adds a Railway user to a workspace when they sign up with an email matching a configured **trusted domain**, after the workspace verifies control of that domain. ([Railway Docs](https://docs.railway.com/projects/workspaces?utm_source=chatgpt.com))

A domain changes hands much less frequently than individual employee mailboxes, but when it does, the blast radius is correspondingly much larger. Linear's explicit warning about transferred/cancelled domains is therefore a useful security rule for every product implementing this pattern. ([Linear](https://linear.app/docs/invite-members?utm_source=chatgpt.com))

## What happens specifically when the invited identifier changes?

There are really three different cases.

**If access has already been accepted and attached to an internal user ID**, changing the account's username or primary email normally does **not** hand access to the next person who acquires the old identifier. GitHub, GitLab, Notion, Vercel, etc. model memberships as user/account relationships, not continuously evaluated string matches. GitLab even recommends using a persistent SAML `NameID` instead of usernames/emails precisely because usernames and emails change. ([GitLab Docs](https://docs.gitlab.com/user/group/saml_sso/?utm_source=chatgpt.com))

**If the invitation is still pending and addressed to an email**, the material question is who can satisfy the email-ownership test before expiry. GitHub gives a particularly clear answer: any GitHub account with that exact address as a **verified email** can accept. ([GitHub Docs](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization?utm_source=chatgpt.com)) That means changing an invitee's *primary* GitHub email is harmless if they retain the invited address as another verified email; removing/releasing that address potentially changes who can satisfy the invitation later.

**If access comes from a reusable link**, changing emails and usernames is irrelevant. Whoever can use the URL under the product's authentication requirements gets whatever role the link confers.

## Account-existence leakage

This dimension is easy to overlook because anti-enumeration behavior is rarely documented.

The clearest cases are:

- **GitHub / GitLab usernames:** existence is inherently discoverable because usernames correspond to visible user identities/profiles, and invite pickers resolve them.
- **Google Drive email addresses:** when normal Google-account-only sharing is enforced, Drive may explicitly tell the sharer that an address is **not associated with a Google Account** and instruct the recipient to create one. That is direct registration-status disclosure. ([Google Help](https://support.google.com/drive/answer/6033939?hl=en-GB&utm_source=chatgpt.com))
- **Notion aliases:** when attempting to add an email alias, Notion tells the user if it is already associated with another Notion account. That is account-existence information, although it is exposed in account management rather than necessarily in the share dialog. ([Notion](https://www.notion.com/en-gb/help/account-settings?utm_source=chatgpt.com))
- For **Vercel, Netlify, Render, Railway, Fly.io, DigitalOcean, Hetzner, Linear and arbitrary external Figma emails**, I found no public vendor documentation sufficient to say confidently that the invite endpoint either does or does not permit registration enumeration. That would require controlled black-box testing of their current UI/API, including timing/error differences; I would not infer “no leak” merely because the docs are silent.

## Overall implementation patterns, without ranking them

The products in the survey cluster into a few recognizable designs:

| Model | Examples from this survey | Identity property actually relied on |
|---|---|---|
| **Resolve existing user then grant/account-invite** | GitLab username invite; GitHub username invite | Internal account ID |
| **Email invitation + verified-account acceptance** | GitHub org email invitation; most SaaS team invitations | Current control of an email address, then internal account ID |
| **Email invitation + account creation** | GitLab email invite, Hetzner, Linear, Railway, Netlify | Email capability during onboarding |
| **Direct ACL on existing identity** | Google Drive normal restricted sharing | Google account principal |
| **Temporary mailbox identity** | Google Drive visitor sharing | Repeated proof of mailbox control |
| **Reusable bearer join URL** | Vercel, Linear, Notion, Railway, Figma | Possession of URL |
| **Domain rule / JIT membership** | Linear approved domains; Railway trusted domains | Control/use of an email within a verified domain |
| **IdP-provisioned membership** | GitHub SCIM, Netlify/Render SAML/SCIM, Linear SAML/SCIM | Enterprise identity-provider principal |

The main lifecycle boundary worth preserving in an implementation is therefore: **once a particular account has accepted an invitation, persist the account's stable internal identifier as the authorization principal; do not continue deriving authorization from the mutable email string that was originally used to find that person.** Conversely, while the invitation is still pending, email-address reassignment is inherently relevant unless the invite was already cryptographically or administratively bound to a specific existing account.

I found one strong, directly documented invitation-hijacking incident among the requested products—GitLab's CVE-2022-4037—and explicit domain-reassignment warnings from Linear. I did **not** find reliable public evidence that GitHub, Vercel, Netlify, Render, Railway, Fly.io, DigitalOcean, Hetzner, Figma, Notion, or Google Drive have suffered a confirmed case in which *their current invitation mechanism* granted the resource to the wrong person specifically because an employee's email address was later reassigned. Absence of a public report should not be read as proof that the scenario cannot occur; for several of those products, the exact pending-invite/account-binding behavior is simply not documented publicly.

---

If you want, I can:

- Continue detailed security issues
- Expand on GitHub invitation distinctions
- Summarize remaining products' invitation flows
