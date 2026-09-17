# Identity Deletion Survey

Source: https://chatgpt.com/share/6aac0b4d-e800-83ed-bb6a-dd3ff7b38b4b

---

## Turn 1: User

_2026-09-17T13:57:56.633Z_

As of September 2026, for identity providers used by SaaS products (Clerk, Auth0, WorkOS, Supabase Auth, Firebase Auth, Cognito), document every way a user record can be deleted (self-service from the provider's own profile component, the provider's dashboard, its backend API, SCIM or directory sync) and what the provider sends to the application in each case. Then survey how SaaS applications built on such providers handle a deleted user who still owns billable resources: immediate deletion, suspension with a grace period, transfer to another owner, or refusal until cleanup. Include documented incidents where a self-service account deletion or an administrative deletion destroyed customer data, and how the product changed afterwards.

---

## Turn 2: ChatGPT

_2026-09-17T13:58:00.362Z_

I’ll separate **identity-layer deletion mechanics** from **application-layer data/resource handling**, then cross-check documented customer-data-loss incidents and the design changes that followed. I’ll prioritize first-party docs and postmortems, and flag gaps where a provider doesn’t publicly document a deletion path.

---

## Turn 3: ChatGPT

_2026-09-17T13:58:22.191Z_

The first distinction is already important: several products use “remove user” to mean **remove an organization membership**, not delete the global identity. WorkOS, for example, has both `organization_membership.deleted` and `user.deleted`, while directory deprovisioning can emit `dsync.user.deleted`; those are different signals and should not drive the same cleanup code.

---

## Turn 4: ChatGPT

_2026-09-17T14:01:22.074Z_

A second sharp divide is whether the IdP gives you a dependable deletion event at all. Clerk/Auth0/WorkOS/Firebase have explicit lifecycle signals (with caveats); Supabase has no delete Auth Hook and instead relies on Postgres trigger/cascade patterns, while Cognito’s Lambda trigger catalog has no user-deletion trigger.

---

## Turn 5: ChatGPT

_2026-09-17T14:08:45.574Z_

As of **17 September 2026**, the six identity systems fall into three materially different models:

- **Evented hard deletion:** Clerk, Auth0, WorkOS and Firebase can tell an application that an identity was deleted, although Auth0 and Firebase have important holes.
- **Database-coupled deletion:** Supabase Auth exposes the user row to the project database; deletion propagation is normally your FK/trigger logic rather than a first-party deletion webhook.
- **Audit-only deletion:** Cognito gives the caller a success response and records the operation in CloudTrail, but has no native “user deleted” Lambda trigger.

The most important architectural point is that **directory deprovisioning often is not user deletion**. Treating SCIM “inactive,” organization-membership removal and global identity deletion as interchangeable can destroy application data unexpectedly.

## 1. Identity-provider deletion matrix

“Signal to application” below means something an ordinary SaaS backend can consume—not merely an entry visible to an IdP administrator.

| Provider | Deletion route | What actually happens | What the application receives |
|---|---|---|---|
| **Clerk** | **Clerk `<UserProfile />` self-service** | Yes. `<UserProfile />` has a Delete account danger section; `deleteSelfEnabled` controls whether the user may delete themselves. The frontend `User.delete()` deletes the current user. ([Clerk](https://clerk.com/docs/reference/components/user/user-profile)) | `user.deleted` webhook. Clerk explicitly says this event fires when a user deletes their own account. ([Clerk](https://clerk.com/docs/guides/development/webhooks/syncing)) |
| | **Clerk Dashboard** | Admin can delete from Users / user profile. ([Clerk](https://clerk.com/docs/guides/users/managing?utm_source=chatgpt.com)) | `user.deleted` webhook. ([Clerk](https://clerk.com/docs/guides/development/webhooks/syncing)) |
| | **Backend API** | `DELETE /users/{user_id}` / `deleteUser()`. SDK returns `Promise<User>`. ([Clerk](https://clerk.com/docs/reference/backend/user/delete-user?utm_source=chatgpt.com)) | Synchronous API result **plus** `user.deleted` webhook. ([Clerk](https://clerk.com/docs/guides/development/webhooks/syncing)) |
| | **SCIM / Directory Sync removal** | **Not a hard delete.** Okta/Entra/custom use SCIM; Google Workspace uses Admin SDK. Removal/deactivation deactivates the Clerk user and immediately revokes active sessions. ([Clerk](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/directory-sync)) | `user.updated`, **not `user.deleted`**. ([Clerk](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/directory-sync)) |
| | **Bulk/support deletion** | Clerk says bulk deletion is unavailable in Dashboard/API and directs customers to support. ([Clerk](https://clerk.com/docs/guides/users/managing?utm_source=chatgpt.com)) | Public docs do not specify the event behavior of support-performed bulk deletion. |
| **Auth0** | **Provider-owned self-service profile component** | I found **no Auth0-owned profile component that deletes the global user**. An application can implement self-deletion itself using the Management API because the delete endpoint accepts `delete:current_user`. ([Auth0](https://auth0.com/docs/api/management/v2/users/delete-users-by-id)) | API returns HTTP `204`. If the deletion is made through the Management API, Auth0 documents `user.deleted` as an Event Stream event. ([Auth0](https://auth0.com/docs/fr-ca/customize/events/event-types?utm_source=chatgpt.com)) |
| | **Dashboard** | Dashboard → User Management → Users → Delete; permanent and non-reversible. ([Auth0](https://tus.auth0.com/docs/manage-users/user-accounts/delete-users)) | Auth0's general Events docs say profile deletion produces `user.deleted`, but its more specific Event Types page only explicitly names **Management API deletion and connection deletion** as sources. I would therefore test Dashboard behavior before making it the sole cleanup trigger. ([Auth0](https://auth0.com/docs/customize/events/sync-data-across-systems?utm_source=chatgpt.com)) |
| | **Management API** | `DELETE /api/v2/users/{id}`, with `delete:users` or `delete:current_user`; HTTP `204`. ([Auth0](https://auth0.com/docs/api/management/v2/users/delete-users-by-id)) | `user.deleted` CloudEvent through an Event Stream/Events API if subscribed. Payload includes the deleted user's identity information / `user_id`; event delivery can be webhook, EventBridge or Action. ([Auth0](https://auth0.com/docs/customize/events/sync-data-across-systems?utm_source=chatgpt.com)) |
| | **SCIM DELETE** | Auth0 inbound SCIM supports an actual `DELETE /Users/...`; the Auth0 user is deleted. ([Auth0](https://auth0.com/docs/ja-jp/authenticate/protocols/scim/configure-inbound-scim)) | Important documentation gap: Auth0's Event Types page does **not** list SCIM as a source of `user.deleted`, even though it lists SCIM for create/update. SCIM operations are recorded in tenant logs. Do not assume a `user.deleted` event for this path without verification. ([Auth0](https://auth0.com/docs/ja-jp/authenticate/protocols/scim/configure-inbound-scim)) |
| | **SCIM `active:false`** | User is **blocked rather than deleted**. Auth0 terminates Auth0 sessions, revokes refresh tokens and can send OIDC back-channel logout to applications. ([Auth0](https://auth0.com/docs/ja-jp/authenticate/protocols/scim/configure-inbound-scim)) | A session/back-channel logout signal may reach the app; `user.updated` covers SCIM updates in Events. ([Auth0](https://auth0.com/docs/fr-ca/customize/events/event-types?utm_source=chatgpt.com)) |
| | **Delete a connection** | Can remove users belonging to the connection. | Auth0 explicitly includes connection deletion as a source of `user.deleted`. ([Auth0](https://auth0.com/docs/fr-ca/customize/events/event-types?utm_source=chatgpt.com)) |
| **WorkOS AuthKit** | **User Profile Widget** | The current WorkOS `<UserProfile />` lets the user change picture, OAuth connections, display name and email. It does **not document global account deletion**. ([WorkOS](https://workos.com/docs/widgets/user-profile)) | None for self-delete through that widget, because it does not expose that operation. |
| | **WorkOS Dashboard** | Users are visible in the Dashboard, but I found no public AuthKit documentation establishing a Dashboard control for globally deleting the AuthKit `User`. The documented hard-delete interface is the User Management API. ([WorkOS](https://workos.com/docs/fga/standalone-integration?utm_source=chatgpt.com)) | Not publicly documented as a global-user deletion path. |
| | **User Management API** | `DELETE /user_management/users/:id`; permanent, cannot be undone. ([WorkOS](https://workos.com/docs/reference/authkit/user)) | `user.deleted`, delivered through WorkOS webhooks or Events API. `data` is the deleted WorkOS User object. ([WorkOS](https://workos.com/docs/events)) |
| | **AuthKit Directory Provisioning deprovision** | **Does not delete the User.** Active org membership becomes `inactive`, sessions are revoked, role reset. A pending membership is deleted. ([WorkOS](https://workos.com/docs/authkit/directory-provisioning)) | Active member: `organization_membership.updated`; pending member: `organization_membership.deleted`. No global `user.deleted`. ([WorkOS](https://workos.com/docs/authkit/directory-provisioning)) |
| | **Standalone Directory Sync** | Separate object model from AuthKit users. Hard-deleted directory user → deleted Directory User. Many IdPs instead soft-deactivate; WorkOS notes that inactive handling varies. ([WorkOS](https://workos.com/docs/directory-sync/understanding-events)) | `dsync.user.deleted` for hard delete; commonly `dsync.user.updated` with `state: inactive` for soft deprovision. Deleting an entire directory emits only `dsync.deleted`, **not one event per user**. ([WorkOS](https://workos.com/docs/directory-sync/understanding-events)) |
| **Supabase Auth** | **Provider-owned self-service component** | None documented. An application must implement its own account-delete UX and invoke a privileged server-side operation. | No built-in self-delete event. |
| | **Dashboard** | Authentication → Users can delete the user. Direct deletion of `auth.users` is also possible. ([Supabase](https://supabase.com/docs/guides/auth/managing-user-data)) | **No first-party “user deleted” Auth Hook.** Available Auth Hooks do not include deletion. Applications normally use PostgreSQL FK cascades or an `AFTER DELETE ON auth.users` trigger. ([Supabase](https://supabase.com/docs/guides/auth/auth-hooks)) |
| | **Admin/backend API** | `auth.admin.deleteUser(id)`; default hard delete removes `auth.users`, cascades to sessions and invalidates refresh tokens. Soft delete is also supported by the admin API. ([Supabase](https://supabase.com/docs/guides/auth/managing-user-data)) | API return to caller; no deletion webhook. Database triggers/FKs are the app-facing mechanism. ([Supabase](https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting?utm_source=chatgpt.com)) |
| | **Direct DB delete** | Deletes row in `auth.users`; already-issued JWTs can remain valid until expiry. ([Supabase](https://supabase.com/docs/guides/auth/managing-user-data)) | DB trigger/FK side effects only. |
| | **User owns Storage objects** | **Deletion is refused.** Supabase explicitly will not delete an Auth user while that user owns Storage objects; objects must be deleted or ownership reassigned. ([Supabase](https://supabase.com/docs/guides/auth/managing-user-data)) | Error to caller; no deletion occurs. |
| | **SCIM / Directory Sync** | I found no native inbound SCIM/directory-deprovisioning facility for Supabase Auth comparable to Clerk/Auth0/WorkOS. Supabase's enterprise auth documentation centers on SAML SSO rather than provisioning. | No native deletion signal documented. |
| **Firebase Auth** | **Provider-owned profile component** | No hosted Firebase profile-management component. But the **Firebase client SDK itself supports self-delete**: `deleteUser(currentUser)` / `user.delete()`, requiring recent authentication. ([Firebase](https://firebase.google.com/docs/auth/web/manage-users)) | For ordinary individual deletion, a 1st-gen Authentication Cloud Function can receive `functions.auth.user().onDelete(user)`. ([Firebase](https://firebase.google.com/docs/functions/1st-gen/auth-events)) |
| | **Firebase Console** | Security → Authentication → Users → delete. ([Firebase](https://firebase.google.com/docs/auth/web/manage-users)) | Firebase documents `onDelete()` as the user-deletion event mechanism. Its docs do not separately qualify console deletion as a different class. ([Firebase](https://firebase.google.com/docs/functions/1st-gen/auth-events)) |
| | **Admin SDK, single user** | `deleteUser(uid)`. ([Firebase](https://firebase.google.com/docs/auth/admin/manage-users)) | `onDelete()` lifecycle event. ([Firebase](https://firebase.google.com/docs/functions/1st-gen/auth-events)) |
| | **Admin SDK batch** | `deleteUsers(uids)`. | **No `onDelete()` events at all.** Firebase explicitly warns to delete users one at a time if application cleanup depends on deletion events. ([Firebase](https://firebase.google.com/docs/auth/admin/manage-users)) |
| | **SCIM / directory sync** | I found no native SCIM deprovisioning facility in Firebase Authentication itself. Google Cloud Identity/IAM products have SCIM features, but those are different identity stores. | None native to Firebase Auth documented. |
| **Amazon Cognito User Pools** | **Managed-login/profile component** | No managed “delete my account” page comparable with Clerk. Applications implement self-delete by calling Cognito's `DeleteUser`. | No deletion Lambda event. |
| | **Self-service API** | `DeleteUser` deletes the currently signed-in profile; access token must contain `aws.cognito.signin.user.admin`; cannot be restored. ([AWS Documentation](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_DeleteUser.html)) | HTTP `200` with empty response. Cognito has **no post-user-delete Lambda trigger**; the trigger catalog covers authentication/signup/token flows instead. ([AWS Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html)) CloudTrail provides an audit event for supported API activity. ([AWS Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/logging-using-cloudtrail.html)) |
| | **AWS Console** | User Pools → Users → select user → Delete → Disable user access → Delete. ([AWS Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-manage-user-accounts.html)) | No delete Lambda trigger. Console API activity is recorded by CloudTrail. ([AWS Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/logging-using-cloudtrail.html)) |
| | **Admin API** | `AdminDeleteUser`, IAM-authorized; deletes the profile; successful response is HTTP `200`, empty body. ([AWS Documentation](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminDeleteUser.html?utm_source=chatgpt.com)) | Caller sees success; CloudTrail audit record, but no native application lifecycle callback. |
| | **SCIM / directory sync** | Cognito User Pools do not expose an inbound SCIM lifecycle comparable with Auth0/Clerk/WorkOS. AWS **IAM Identity Center** does have SCIM, but it is a separate product/store. ([AWS Documentation](https://docs.aws.amazon.com/singlesignon/latest/developerguide/what-is-scim.html?utm_source=chatgpt.com)) | None native to the Cognito user record. |

One Cognito distinction is worth highlighting: AWS now retains an accidentally **deleted entire user pool** in an inactive state for 14 days and says Support can assist with restoration during that period. That safety net applies to `DeleteUserPool`, not to individual `DeleteUser`/`AdminDeleteUser` records. ([AWS Documentation](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_DeleteUserPool.html))

## 2. What SaaS products do when the departing identity still owns resources

The underlying IdP used by these applications is often not public, so it would be misleading to say, for example, “Slack does this because of Auth0.” The useful comparison is their **application-layer ownership policy**.

| Pattern | Public SaaS examples | Behaviour |
|---|---|---|
| **Immediate destructive cascade** | **Vercel** | Deleting a personal account permanently deletes its projects and deployments. Vercel explicitly warns the action cannot be undone. ([Vercel](https://vercel.com/kb/guide/how-do-i-delete-my-vercel-account)) |
| | **GitHub personal namespace** | Account deletion deletes repositories, private forks, wikis, issues, PRs, Pages, packages/container images owned by the account; billing ends immediately. ([GitHub Docs](https://docs.github.com/en/account-and-profile/reference/personal-account-reference)) |
| **Suspension / grace period** | **GitLab self-delete** | Account enters pending deletion and is blocked first; deletion normally completes in 1–2 hours but may take up to seven days for users with contributions. ([GitLab Docs](https://docs.gitlab.com/user/profile/account/delete_account/)) |
| | **GitLab projects/groups** | Since July 10, 2025, GitLab.com puts deleted projects/groups into pending deletion with a **30-day recovery window** and self-service restoration. ([GitLab](https://about.gitlab.com/blog/improving-gitlab-deletion-flow-what-to-expect-in-coming-months/)) |
| | **DigitalOcean** | Account deactivation stops billing and future resource creation and can precede permanent data purge; account deactivation is distinct from immediate destructive deletion. ([DigitalOcean](https://docs.digitalocean.com/platform/accounts/settings/)) |
| | **Sanity archive rather than delete** | A project can be archived: access/API/CDN stop, subscription billing stops, outstanding usage is invoiced, and the project remains reactivatable. ([Sanity.io](https://www.sanity.io/docs/platform-management/projects-organizations-and-billing)) |
| **Transfer to another owner first** | **Slack** | A Workspace/Org Primary Owner simply cannot deactivate. Primary ownership must first be transferred. Ordinary deactivation leaves messages and files in place. citeturn208470search1turn208470search2turn208470search3 |
| | **GitHub organizations** | A person who is the only organization owner must transfer ownership or delete the organization before deleting the personal account. ([GitHub Docs](https://docs.github.com/en/account-and-profile/reference/personal-account-reference)) |
| | **DigitalOcean teams** | A sole team owner with additional members is sent through prerequisite steps such as transferring ownership or deleting the team/resources before account deactivation. ([DigitalOcean](https://docs.digitalocean.com/platform/accounts/deactivate/)) |
| **Refuse deletion until cleanup/reassignment** | **Supabase Storage** | The Auth user cannot be deleted while it owns Storage objects. Delete the objects or transfer ownership first. ([Supabase](https://supabase.com/docs/guides/auth/managing-user-data)) |
| | **DigitalOcean teams** | A team cannot be deleted until all Droplets, Spaces buckets, managed DBs and Kubernetes clusters are destroyed. Final balance is then charged. ([DigitalOcean](https://docs.digitalocean.com/platform/teams/how-to/delete/)) |
| | **Sanity** | As of its August 21, 2026 account-deletion redesign, deletion is blocked if the user is the **sole administrator** of any project or organization. The user must promote another administrator or delete the resource. Vercel Marketplace-billed projects must first be removed at Vercel. ([Sanity.io](https://www.sanity.io/docs/platform-management/deleting-your-account)) |

Two of these products are hybrids rather than fitting one box. **GitHub** destroys personal-namespace resources but refuses to strand an organization without another owner. **DigitalOcean** preserves the account until team ownership and explicitly billable infrastructure have been resolved. Those hybrids are arguably the better model for multi-tenant B2B SaaS because an identity and an economic/resource owner are treated as distinct objects.

## 3. Documented data-loss incidents and resulting changes

### GitLab: destructive administrator deletion

GitLab has unusually good public evidence because its issue tracker exposes both customer-support incidents and the remediation work.

In 2022 GitLab documented that deleting a user and their contributions was causing preventable customer restoration work. The destructive operation could remove projects, groups, issues and merge requests without first showing administrators what would disappear. GitLab consequently merged a change in November 2022 that added a **summary of how many projects, groups, issues and merge requests would be deleted** to the “Delete user and contributions” confirmation. GitLab's own follow-up design issue described accidental deletion as a “high severity” error and characterized this modal improvement as a stopgap. ([GitLab](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/102231))

That did not eliminate the problem. In February 2026 GitLab Support opened another issue after an **emergency customer ticket**: “Delete user” and “Delete user and contributions” were adjacent and their dialogs looked nearly identical. If the administrator accidentally chose the destructive variant and the user was sole owner, entire groups and projects could be deleted **without entering the normal pending-deletion queue**, making them unrecoverable. The author said this was not believed to be the first such case. ([GitLab](https://gitlab.com/gitlab-org/gitlab/-/issues/591013))

The current September 2026 documentation still exposes both administrative actions and explicitly warns that “Delete user and contributions” may remove more data than intended; it still says that sole-owned groups and their projects are removed. ([GitLab Docs](https://docs.gitlab.com/user/profile/account/delete_account/)) So, based on the public evidence I found, **there is not yet a documented completed fix for that 2026 admin-user-deletion bypass**.

### GitLab: broader accidental deletion → recoverable deletion

GitLab subsequently changed its resource-deletion model much more substantially. In July 2025 it said inconsistent deletion behavior had left users frustrated by accidentally deleted content with no recovery option. It rolled out:

- pending deletion for projects and groups across all pricing tiers,
- self-service recovery,
- consistent deletion-state indicators, and
- a **30-day GitLab.com recovery period**, increased from seven days on July 10, 2025. ([GitLab](https://about.gitlab.com/blog/improving-gitlab-deletion-flow-what-to-expect-in-coming-months/))

GitLab also introduced delayed **self-service user-account deletion** in GitLab 16.0: the user is blocked while deletion is pending. Current documentation says this can last up to seven days when the account has associated contributions. ([GitLab Docs](https://docs.gitlab.com/user/profile/account/delete_account/)) I would not claim that particular account-delay feature was caused by a specific customer-data-loss incident—the public record gives other motivations too—but it is part of the same movement away from synchronous irreversible deletion.

The interesting failure is that the 2026 administrative `Delete user and contributions` path demonstrates why a grace period must be enforced **below the UI layer**. GitLab had built recoverable project/group deletion, yet one higher-level user-deletion operation could bypass it. ([GitLab](https://gitlab.com/gitlab-org/gitlab/-/issues/591013))

### Older GitLab evidence

A 2020 GitLab issue also documents an administrator selecting **Delete user and contributions** and observing that associated records were actually removed contrary to what the then-documentation led the administrator to expect. That issue was subsequently closed, and modern documentation is much more explicit about exactly which records can be destroyed. ([GitLab](https://gitlab.com/gitlab-org/gitlab/-/issues/213192))

I did **not** find an equally well-documented, first-party public incident from Clerk, Auth0, WorkOS, Supabase, Firebase or Cognito in which their own self-service identity deletion itself destroyed a customer's application resources and was followed by a published product remediation. That absence matters: those IdPs generally consider application resources to be outside their data model, so the destructive cascade usually lives in the SaaS application's webhook/FK handlers rather than inside the identity provider.

## 4. What this means for a SaaS deletion design

The dangerous implementation is:

`IdP user deleted → user.deleted webhook / auth.users cascade → DELETE application user → ON DELETE CASCADE projects/subscriptions/data`

That makes an identity-provider operation—possibly originating in an enterprise customer's SCIM directory—the root of an irreversible customer-data transaction.

The patterns above support a safer separation:

**Identity deletion/deprovisioning should revoke authentication immediately, but ownership cleanup should be a separate state machine.** A global `user.deleted`, SCIM inactive event, or missing Cognito identity should mark the application principal as something like `identity_deleted` or `access_revoked`; it should not by itself hard-delete tenant resources.

For sole owners of billable resources, the established SaaS patterns are to require transfer/cleanup (Slack, GitHub, Sanity, DigitalOcean, Supabase Storage) or move the resources into a recoverable pending-deletion state (GitLab). Where hard cascades are permitted, products such as GitHub and Vercel make that consequence explicit, but the blast radius is still substantially higher. ([Sanity.io](https://www.sanity.io/docs/platform-management/deleting-your-account))

One implementation detail is especially worth testing in integration suites: **every deletion source separately**. Firebase batch deletion deliberately omits its deletion trigger; Clerk SCIM deprovisioning produces `user.updated`, not `user.deleted`; WorkOS Directory Provisioning changes a membership rather than the User; Auth0's documentation does not explicitly guarantee `user.deleted` for SCIM DELETE; and Cognito has no corresponding Lambda deletion hook at all. A cleanup process that was tested only with the provider dashboard can therefore behave differently during real enterprise offboarding. ([Clerk](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/directory-sync))

---

If you want, I can:

- Continue detailing SaaS deletion design patterns
- Expand on GitLab deletion incident follow-up
- Describe how to implement robust user deletion with these IdPs
