# Clerk Email Verification Rules

Source: https://chatgpt.com/share/6aac0b7a-f7e0-83ed-b784-45302e507094

---

## Turn 1: User

_2026-09-17T13:57:23.234Z_

As of September 2026, from Clerk's documentation, its OpenAPI specifications and its SDK source, describe: whether an email address on a Clerk user can be unverified, and how its verification status appears in the Backend API user object and in webhook payloads; whether a user can hold several email addresses and which ones can be used to sign in; whether a verified email address can be removed from one user and added to another, and whether Clerk enforces uniqueness across users for verified and unverified addresses; how OAuth sign-ups (Google in particular) mark email verification; how `getUserList` filters by email address and whether the filter matches unverified addresses; and what Clerk's own invitation and organization-invitation features do, including whether they can invite someone who has no account and how an invitation is matched to the account that accepts it. Distinguish documented contract from observed behaviour, and say where the documentation is silent.

---

## Turn 2: ChatGPT

_2026-09-17T13:57:25.834Z_

I’ll triangulate this across Clerk’s public docs, Backend API/OpenAPI definitions, webhook schemas/examples, and SDK/repository source. I’ll separate what Clerk explicitly promises from what source/tests merely show, and I’ll call out gaps where the docs don’t state a rule.

---

## Turn 3: ChatGPT

_2026-09-17T13:57:49.709Z_

A useful distinction is emerging: Clerk now has a first-class “reserved” identifier state—unverified but sign-in-capable and locked to that user—which matters for the uniqueness question. I’m checking whether that is a general property of every unverified email, or only of explicitly reserved identifiers.

---

## Turn 4: ChatGPT

_2026-09-17T14:00:29.021Z_

On OAuth, the evidence is more nuanced than “Google makes the email verified”: Clerk’s docs make verification depend on what the provider asserts, and current SDK test fixtures explicitly include a Google-derived email verification that is still `unverified`. So I’ll treat “Google = verified” as a common/provider-dependent path, not an unconditional contract.

---

## Turn 5: ChatGPT

_2026-09-17T14:04:28.248Z_

As of **17 September 2026**, Clerk’s public Backend API is at **v2026-05-12 / OpenAPI 3.0.3**; its public OpenAPI repository has that as the newest BAPI spec, while the published webhook schema is `2025-04-15`. ([Clerk](https://clerk.com/docs/reference/backend-api/2026-05-12/description/introduction?utm_source=chatgpt.com))  

The important theme is that Clerk has three concepts that should not be collapsed into one: an ordinary **unverified** `EmailAddress`, a newer **reserved** identifier (also unverified, but deliberately sign-in-capable and locked to a user), and the verification state of an **OAuth external account**. They have overlapping but different semantics.

| Question | What Clerk actually establishes |
|---|---|
| Can a User contain an unverified email? | **Yes.** Explicitly. |
| Where is verification represented? | `email_addresses[n].verification.status` in raw BAPI/webhook JSON; SDK camelCase is `emailAddresses[n].verification.status`. |
| Several emails per user? | **Yes.** One is primary; the User contains an array of all of them. |
| Can secondary emails sign in? | Verified email identifiers can participate in email sign-in; primaryness is not the sign-in identity boundary. Reserved unverified identifiers are explicitly sign-in-capable. Generic pending/unverified addresses are **not explicitly promised** to be sign-in-capable. |
| Unique across users? | Verified addresses and **reserved** unverified addresses are explicitly unique/claimed. Clerk is much less explicit about the global invariant for every other kind of ordinary unverified address. |
| Delete from A, add to B? | The API model supports delete-then-create, subject to deletion restrictions. Clerk does not document a permanent historical reservation after deletion, but also does not give an explicit contractual sentence saying “deletion frees the address for another user.” |
| Google/OAuth = automatically verified? | **Not unconditionally.** Clerk follows whether the provider says the email is verified. Google is explicitly used as a verified-email example, but SDK fixtures support a Google-derived email still being `unverified`. |
| Does `getUserList({emailAddress})` include unverified? | The documented filter is verification-agnostic and says it returns users that “own” the specified emails. No verified-only condition exists in the API/SDK surface. Inclusion of unverified addresses is therefore the natural contract reading, but Clerk never explicitly says “this includes unverified addresses.” |
| Can Clerk invitations target people without accounts? | **Yes.** Application invitations are fundamentally sign-up invitations; Organization invitations explicitly branch between sign-up and sign-in depending on whether an account already exists. |

### 1. An email on a Clerk User can definitely be unverified

This is not just an intermediate sign-up concept. The Backend SDK's `createEmailAddress()` accepts `verified?: boolean` and defaults it to **false**, while `updateEmailAddress()` can also set `verified` to false. Separately, disabling “Verify at sign-up” allows a user account to be created with an unverified email. ([Clerk](https://clerk.com/docs/reference/backend/email-addresses/create-email-address?utm_source=chatgpt.com))

Clerk also introduced the distinct `reserved` state for migrations/manual creation. `createUser()` normally creates supplied emails as verified, but `emailAddressIdentificationStatus: ['reserved']` creates an address that is **unverified, usable for sign-in, and locked so another user cannot claim it**. The current JS SDK change that exposed this parameter describes exactly those semantics. ([Clerk](https://clerk.com/docs/reference/backend/user/create-user?utm_source=chatgpt.com)) 

That means “unverified” alone no longer tells you whether an identifier is usable for sign-in. A reserved identifier is intentionally a special unverified case.

### 2. Verification state in the Backend User object and webhooks

The Backend `User` has `emailAddresses: EmailAddress[]`; each `EmailAddress` has `verification: Verification | null`. A `Verification` has a `status` whose possible values include `unverified`, `verified`, `transferable`, `failed`, and `expired`. ([Clerk](https://clerk.com/docs/reference/backend/types/backend-user?utm_source=chatgpt.com)) The current JS source likewise declares `VerificationStatus = 'unverified' | 'verified' | 'transferable' | 'failed' | 'expired'`. 

So in raw Backend API JSON the relevant shape is conceptually:

```json
{
  "email_addresses": [
    {
      "email_address": "person@example.com",
      "verification": {
        "status": "unverified",
        "strategy": "email_code"
      }
    }
  ]
}
```

There is **not** a single User-level boolean such as `email_verified` that tells you the state of every email. Verification belongs to each `EmailAddress`.

For webhooks, Clerk explicitly says `data` on a `user.*` event is the User object. Its `user.created` example contains `data.email_addresses[].verification.status` and `strategy`; the example happens to show `"verified"` with `"ticket"`. ([Clerk](https://clerk.com/docs/guides/development/webhooks/overview?utm_source=chatgpt.com)) The dedicated webhook OpenAPI spec also defines `email_addresses` on the webhook User schema. 

One defensive coding point: the Backend type says `verification` itself can be `null`. So test `email.verification?.status === 'verified'`, rather than assuming every object has a verification object. ([Clerk](https://clerk.com/docs/reference/backend/types/backend-email-address?utm_source=chatgpt.com))

### 3. Multiple emails and which can be used to sign in

Clerk explicitly supports **multiple email addresses per User**. `User.emailAddresses` contains all of them, including the primary one; `primaryEmailAddressId` merely indicates which one is primary. The current custom-flow guide likewise states that users can add multiple addresses. ([Clerk](https://clerk.com/docs/reference/backend/types/backend-user?utm_source=chatgpt.com))

Clerk describes email addresses as authentication identifiers and says users can authenticate using an email address. ([Clerk](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options?utm_source=chatgpt.com)) The JS authentication model reinforces that this is address-specific rather than primary-address-specific: email sign-in factors carry an `emailAddressId`, and the sign-in implementation prepares the factor using that ID.  

So **primaryness does not mean “the only login email.”** A verified secondary email is an identifier associated with the user and can participate in configured email authentication. The explicitly documented special case is a `reserved` email, which can sign in despite being unverified. ([Clerk](https://clerk.com/docs/reference/backend/user/create-user?utm_source=chatgpt.com))

There is, however, a documentation gap worth preserving: I could not find a current Clerk sentence saying, verbatim, “every secondary verified email address can always be entered as the identifier at sign-in,” independent of instance configuration. Nor does Clerk say that an ordinary newly-created, still-pending `verified:false` address is automatically sign-in-capable. The add-email guide actually frames verification as required before the address is fully added for normal use, even though the `EmailAddress` resource exists in `User.emailAddresses` during that process. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/account-updates/add-email?utm_source=chatgpt.com))

### 4. Moving an email between users and uniqueness

For `createUser()`, the contract is particularly clear: every email supplied must be **unique across the Clerk instance**. That statement covers the two statuses accepted by that endpoint: `verified` and `reserved`. A reserved email is additionally described as locked so no other user can claim it. ([Clerk](https://clerk.com/docs/reference/backend/user/create-user?utm_source=chatgpt.com))

Clerk's error model also talks in terms of an identifier being “claimed by another user,” including an OAuth-specific error when the OAuth account's email has already been claimed. ([Clerk](https://clerk.com/docs/guides/development/errors/backend-api?utm_source=chatgpt.com)) This is consistent with a one-current-owner model for usable email identifiers.

A verified email is not documented as permanently tied to the first User that ever possessed it. Clerk exposes `deleteEmailAddress()` and separately exposes creation of an email on a user, so the API model supports **remove from User A, then create/add on User B**. ([Clerk](https://clerk.com/docs/reference/backend/email-addresses/delete-email-address?utm_source=chatgpt.com)) There are important deletion constraints: for example, Clerk refuses to delete an email linked to one or more Connected Accounts until those Connected Accounts are removed, and it can reject deletion of a user's last/required identification. ([Clerk](https://clerk.com/docs/guides/development/errors/backend-api?utm_source=chatgpt.com))

The exact contractual boundary is:

**Verified:** uniqueness while claimed is clearly documented.

**Reserved-but-unverified:** uniqueness is even more explicit—it is “locked so no other user can claim it.” ([Clerk](https://clerk.com/docs/reference/backend/user/create-user?utm_source=chatgpt.com))

**Generic unverified** addresses—for example an `EmailAddress` created with `verified:false`, or an account allowed through sign-up without verification—are where Clerk's public material is surprisingly silent. The docs unquestionably allow them, but I found no current BAPI/OpenAPI sentence saying either “all unverified emails are globally unique” or “the same unverified value may appear on multiple users.” Generic errors such as `IdentificationClaimed` point toward uniqueness once an identification is claimed, but that is not the same as a clean published invariant for every transient/unverified state. ([Clerk](https://clerk.com/docs/guides/development/errors/backend-api?utm_source=chatgpt.com))

Similarly, I did not find a formal guarantee saying “after deletion, the same string is immediately reusable by another user.” The API and error semantics strongly support that behavior, and there is no documented tombstone/reservation of deleted email values, but I would characterize reuse-after-delete as **API/implementation semantics rather than a separately stated durability guarantee**.

### 5. OAuth, and Google specifically

Clerk's current OAuth account-linking documentation is conditional on the provider's assertion. If an OAuth provider returns a **verified** email, Clerk can use that verified email to link accounts. If the provider returns an **unverified** email, Clerk initiates email verification before linking. ([Clerk](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking?utm_source=chatgpt.com))

Google is explicitly used by Clerk as an example of the former case: its documentation describes the scenario where someone later signs in “with Google (where the email is verified).” ([Clerk](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking?utm_source=chatgpt.com)) So it is reasonable to expect the normal Google path to provide a provider-verified address.

But there is an important distinction between the **external-account verification** and the **User EmailAddress verification**. Clerk's OpenAPI schemas even carry a nullable `email_address_verified` field on external-account data, distinct from the `verification` object of `email_addresses[]`. The webhook spec contains that provider-verification field too. 

And the current JS SDK test data proves that Clerk's client model does not make “Google” synonymous with “email verified”: one fixture contains

`email_address.verification.status = 'unverified'`,
`strategy = 'from_oauth_google'`

while the external account itself is `verified`. 

Therefore, the safe rule is: **inspect the actual `EmailAddress.verification.status`; do not infer it solely from `provider === 'oauth_google'`.** The docs support “provider says verified → Clerk can treat that proof as verified,” but they do not promise that every possible Google-derived User email will always serialize as verified.

### 6. `getUserList({ emailAddress })`

The documented `emailAddress` parameter is an array of up to 100 addresses and “filters users with the specified email addresses.” Clerk's usage example is stronger still: the returned users are those that **“own any of these emails”**. This is an exact address filter; the separate `query` parameter is the one intended for partial matching. ([Clerk](https://clerk.com/docs/reference/backend/user/get-user-list?utm_source=chatgpt.com))

The current Backend JS SDK type says the same thing—`emailAddress?: string[]` with no verification parameter—and `getUserList()` forwards the user-list parameters toward the BAPI; there is no SDK-side `verification.status` filtering layer.  

**Does that include unverified email addresses?** The best contract reading is **yes**: an unverified `EmailAddress` is still in `User.emailAddresses`, and the filter says “users with” / users that “own” the specified address, without saying “verified email addresses.” Nothing in the parameter schema restricts it to primary or verified addresses. ([Clerk](https://clerk.com/docs/reference/backend/types/backend-user?utm_source=chatgpt.com))

But Clerk is **silent on the exact sentence you probably care about**: its docs do not explicitly say “`emailAddress` matches unverified `EmailAddress` objects.” I also did not find a current JS SDK test that specifically asserts that server behavior. So I would rely on it as the natural reading of the public BAPI contract, while recognizing that the verification-status inclusion rule is implicit rather than explicitly called out.

### 7. Clerk application invitations

An ordinary Clerk `Invitation` is explicitly an invitation **to sign up to the application**. It is therefore designed for somebody who does **not yet have a Clerk account**. The invitation stores the target `emailAddress`, Clerk emails a unique link, and a valid invitation link sends the recipient through sign-up and automatically verifies the invited email. Invitations normally expire after a month; following an expired invitation falls back to normal sign-up without auto-verification. ([Clerk](https://clerk.com/docs/reference/backend-api/2026-05-12/description/introduction?utm_source=chatgpt.com))

By default, attempting to create an application invitation where that email already has an invitation **or already exists in the application** produces an error; `ignoreExisting: true` can tell the creation endpoint to create one anyway. ([Clerk](https://clerk.com/docs/reference/backend/invitations/create-invitation-bulk?utm_source=chatgpt.com))

The matching primitive is the **invitation ticket**, not a naked “look up whichever user clicked.” The link carries the invitation/ticket; consuming that ticket drives the sign-up, binds the invitation's email into that sign-up, and auto-verifies it. Clerk's public docs explain the token flow but do **not** expose a lower-level algorithm for how ticket-to-email ownership is validated internally. So “ticket bound to the invited email” is the documented external model; any database-level matching rule is undocumented.

### 8. Organization invitations

Organization invitations are more flexible. They are created with an `emailAddress`, Organization, role, etc.; they do **not** require an invitee `userId`. By contrast, directly creating an Organization membership requires an existing User ID. ([Clerk](https://clerk.com/docs/reference/backend/organization/create-organization-invitation?utm_source=chatgpt.com)) That alone is a strong indication that org invitations are deliberately usable for people who have no account yet.

The custom acceptance flow makes this explicit. When the recipient follows the invitation, Clerk provides the ticket plus a `__clerk_status`:

`sign_in` means the invitee already has an account; `sign_up` means they do not; `complete` means the existing user was already signed in and the flow was completed. The same invitation ticket is then supplied either to `signIn.ticket()` or to the sign-up operation. In the `sign_up` branch, Clerk says the invitation token automatically verifies the user's email. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/organizations/accept-organization-invitations?utm_source=chatgpt.com))

For an existing signed-in user, Clerk exposes those invitations as `UserOrganizationInvitation` objects. Each has the email address to which it was sent and an `accept()` method; `getOrganizationInvitations()` returns the invitations associated with the active user. ([Clerk](https://clerk.com/docs/js-frontend/reference/types/user-organization-invitation?utm_source=chatgpt.com)) Clerk's public error catalog is revealing too: if the invitation email already corresponds to an account, it says to **sign in**; if no such user exists, it says to **sign up first**. ([Clerk](https://clerk.com/docs/guides/development/errors/frontend-api?utm_source=chatgpt.com))

What Clerk **does not document precisely** is the server's complete matching predicate for an existing account: for example, I found no guarantee phrased as “an org invitation matches any verified secondary email but never an unverified email,” nor a statement that only the primary email counts. The public model says the invitation is addressed to an email and the ticket resolution determines existing-user versus new-user. So the correct abstraction is **email-address/ticket matching**, not “invitation is pre-bound to a Clerk user ID”; the exact treatment of primary versus secondary and verified versus generic-unverified email addresses is an internal detail not fully specified in the docs.

### Practical conclusion

If you are building application logic around these behaviors, I would treat the following as **stable contract**: emails can be unverified; inspect `EmailAddress.verification.status`; a User can have many emails; verified and reserved identifiers have instance-level ownership semantics; `reserved` specifically means unverified-but-sign-in-capable-and-unclaimable by another user; `getUserList(emailAddress)` is an email-ownership filter with no documented verification restriction; OAuth verification should be read from actual state rather than inferred from provider name; and Clerk invitations can onboard a person with no pre-existing account.

I would **not** bake security-critical logic around the undocumented edges—especially “all ordinary unverified emails are globally unique,” “every unverified email is sign-in-capable,” or “Organization invitations match exactly this class of secondary/unverified address”—without either a Clerk support confirmation or an integration test against the BAPI version you pin.

---

If you want, I can:

- Explain Clerk's 'reserved' email identifier state and its sign-in implications
- Clarify Clerk's email verification status presence in Backend API and Webhooks
- Describe how Clerk manages invitations for users without accounts and invitation-email matching
