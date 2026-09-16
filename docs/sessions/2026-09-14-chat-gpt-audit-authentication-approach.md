# Audit Authentication Approach

Source: https://chatgpt.com/share/6aa7850a-7384-83ed-adaf-3c04b0ba1b93

---

## Turn 1: User

_2026-09-14T05:07:51.453Z_

We are building Composery, a web control panel for customer-controlled VPSs, on Next.js 16.3, React 19.3, Tailwind CSS 4.3, Base UI, Convex 1.45, and Clerk Core 3 (@clerk/nextjs 7.9). We plan to replace Clerk's hosted Account Portal with in-app authentication UI. The reports below are independent research on the UI approach, a custom flow audit, account management and deletion, CSP and layout stability, and the production cutover.

Your task is an evidence audit, not another vote. For each material claim in the reports, check it against primary sources for the installed versions. Mark each claim verified, contradicted, or unverified, with a link. Identify where reports disagree and which evidence decides it.

Then produce: the recommended approach per surface (sign-in, sign-up, account menu, account settings); the product decisions that evidence cannot resolve, each with its consequence; the implementation slices in order, each with acceptance checks that a real browser run or a Convex test can pass or fail; and the documentation changes needed (decisions, setup steps, environment variable examples).

Research rules: separate verified facts, deductions, recommendations, and unknowns. Do not optimize for agreement with any report. Do not request or print secrets.

Reports:

https://chatgpt.com/share/6aa77dfd-ad5c-83eb-b48b-f7b1562aeb84
https://chatgpt.com/share/6aa77e0a-4b00-83eb-8720-11c263647de9
https://chatgpt.com/share/6aa780cd-336c-83eb-a69d-ca8ffec89812
https://chatgpt.com/share/6aa780e4-ac88-83ed-9e80-38db16b43575
https://chatgpt.com/share/6aa7811e-3dc0-83eb-8ea1-2c2d5bc3159e

Use 3 attached files to deal with share links in your environment.

---

## Turn 2: ChatGPT

_2026-09-14T05:07:52.303Z_

I’ll treat the five reports as claims to be tested, not authorities. I’ll first reconstruct them from the share links using your supplied reader, then verify material claims against version-specific primary sources, and finally turn only the surviving evidence into implementation and documentation guidance.

---

## Turn 3: ChatGPT

_2026-09-14T05:08:50.810Z_

The share links are recoverable through ChatGPT’s public share JSON endpoint; your parser files correctly point at the same `linear_conversation` structure and filtering rules.  I have all five report payloads now, so the audit can be claim-by-claim rather than inferred from titles.

---

## Turn 4: ChatGPT

_2026-09-14T05:10:32.288Z_

Two evidence issues are already clear. First, the reports sometimes cite “current patch” releases even though your prompt only fixes minor lines (`@clerk/nextjs 7.9`, not the lockfile patch); I’ll treat patch-specific conclusions as unverified unless the claim is stable across 7.9.x. Second, some report statements are sound engineering recommendations but are not facts a vendor source can verify—those will be labeled deductions/recommendations rather than “verified.”

---

## Turn 5: ChatGPT

_2026-09-14T05:22:17.524Z_

I audited the five reports as competing hypotheses, using the supplied share-link reader to reconstruct the conversations—the reader fetches the public share page, decodes `linear_conversation`, filters visible user/assistant text, and returns the report turns. 

One version caveat matters: the prompt fixes `@clerk/nextjs` at **7.9**, not an exact installed patch. Clerk's official `@clerk/nextjs@7.9.2` tag exists, and at that tag the related packages are `@clerk/react 6.15.2`, `@clerk/backend 3.17.2`, and `@clerk/ui 1.32.3`; its React peer range includes 19.3 prerelease/stable-compatible ranges.      So claims that specifically say “your installed version is 7.9.2” are **unverified without the lockfile**; behavior that is documented for v7 or confirmed in the 7.9.2 source is stronger.

## Executive result

The reports' broad “mixed” direction survives, but not unchanged. The evidence supports **Clerk prebuilt authentication and account-management machinery inside Composery, with Composery-owned navigation and destructive-resource workflows**.

The most material corrections are:

| Finding | Audit result |
|---|---|
| A separate custom sign-up state machine is required to get one sign-in/sign-up entry surface | **Contradicted.** Embedded `<SignIn />` can handle both sign-in and sign-up, including Clerk's enumeration-protection behavior. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up)) |
| Invisible CAPTCHA is preferable for layout stability | **Contradicted.** Invisible CAPTCHA is deprecated; Smart is the recommended/default mode. Solve layout stability in your layout instead. ([Clerk](https://clerk.com/docs/js-frontend/guides/development/custom-flows/authentication/bot-sign-up-protection)) |
| The CSP directive list in the CSP report is complete | **Contradicted.** Current Clerk CSP guidance also requires `worker-src 'self' blob:`; `style-src 'unsafe-inline'` remains necessary for Clerk's prebuilt UI. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers)) |
| Production Clerk configuration has to be manually recreated | **Contradicted.** `clerk deploy` can clone development configuration into production and guide DNS/OAuth setup. **User data still does not migrate.** ([clerk.com](https://clerk.com/changelog/2026-06-10-clerk-deploy?utm_source=chatgpt.com)) |
| `user.delete()` itself performs logout | **Contradicted.** In the exact 7.9.2 prebuilt deletion implementation Clerk calls `user.delete()` and then separately clears the active session.  |
| Convex identity can be used to inspect Clerk's `fva` for recent verification | **Contradicted.** Convex intentionally drops `fva`; destructive step-up therefore needs a Clerk-aware server boundary or another verifiable proof. ([Convex Developer Hub](https://docs.convex.dev/auth/functions-auth)) |
| Every `auth.protect()` failure behaves as a redirect | **Contradicted if stated generally.** Document requests redirect; Route Handlers and Server Actions have different unauthenticated behavior. ([Clerk](https://clerk.com/docs/nextjs/guides/secure/protect-content)) |

My recommended surface split is therefore: **embedded `<SignIn />`; no independent sign-up implementation initially; custom Base UI account menu; dedicated embedded `<UserProfile />` account settings plus a Composery-owned danger-zone/deletion flow.**

---

# Evidence audit

I use **Verified** only when a primary source establishes the claim, **Contradicted** where primary evidence materially says otherwise, and **Unverified** for reasonable deductions, product choices, undocumented specifics, or version claims that cannot be tied to the supplied installed patch.

## Report: “Compare Clerk options”

| Material claim | Status | Evidence / decision |
|---|---|---|
| Clerk Core 3 redesigned `useSignIn()`/`useSignUp()` around stateful attempts/loading/errors and deprecated Clerk Elements | **Verified** | Clerk's Core 3 release notes describe the hook redesign and Elements deprecation. ([Clerk](https://clerk.com/changelog/2026-03-03-core-3)) |
| Core 3 is designed to coexist with component libraries rather than requiring Clerk's UI | **Verified** | Clerk exposes custom-flow hooks independently of its prebuilt components; `prefetchUI={false}` exists specifically for applications not using Clerk UI. ([Clerk](https://clerk.com/docs/reference/components/clerk-provider)) |
| Prebuilt `<SignIn />` and `<SignUp />` carry substantially more flow logic than a visual form | **Verified** | Clerk documents transfers between sign-in/sign-up, CAPTCHA, legal acceptance, OAuth callbacks, incomplete requirements, and session tasks across these flows. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up)) |
| Composery needs separate `<SignIn />` and `<SignUp />` pages to retain Clerk's prebuilt behavior | **Contradicted** | `<SignIn />` can be a sign-in-or-sign-up page. A separate `<SignUp />` route is optional. ([Clerk](https://clerk.com/docs/nextjs/guides/development/custom-sign-in-or-up-page)) |
| A fully custom auth flow must own transfers, OAuth callback completion, missing requirements and session-task handling | **Verified** | Clerk's custom-flow documentation explicitly exposes these states rather than automatically resolving all of them. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/oauth-connections)) |
| A custom sign-up flow must explicitly accept legal terms when Clerk legal consent is enabled | **Verified** | Prebuilt SignUp handles this UI; custom flows must pass the legal-acceptance state themselves. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/legal-acceptance)) |
| Custom sign-up needs a CAPTCHA mount point | **Verified** | Clerk requires `#clerk-captcha` before sign-up creation when using custom flows. ([Clerk](https://clerk.com/docs/js-frontend/guides/development/custom-flows/authentication/bot-sign-up-protection)) |
| `<UserProfile />` is the supported full account-management surface | **Verified** | Clerk describes it as its prebuilt profile/security surface and documents embedding it on an optional catch-all route. ([Clerk](https://clerk.com/docs/reference/components/user/user-profile?utm_source=chatgpt.com)) |
| Custom account pages require the experimental composed-profile API | **Contradicted as a general claim** | The complete composed-profile API is experimental, but stable `<UserProfile.Page>` and `<UserProfile.Link>` APIs already let you add custom pages and links to the prebuilt profile. ([Clerk](https://clerk.com/docs/guides/customizing-clerk/adding-items/user-profile?utm_source=chatgpt.com)) |
| Experimental profile composition has no normal semver stability guarantee and should be pinned if adopted | **Verified** | Clerk explicitly labels it experimental. ([Clerk](https://clerk.com/docs/react/reference/components/user/user-profile?utm_source=chatgpt.com)) |
| Tailwind 4 integration should put Clerk in its own CSS layer | **Verified** | Clerk documents `cssLayerName` and the Tailwind 4 layer ordering. ([Clerk](https://clerk.com/changelog/2025-06-17-css-layer-name)) |
| Prebuilt Clerk UI still needs runtime `style-src 'unsafe-inline'` | **Verified** | Current Clerk CSP documentation says this is required for its runtime CSS-in-JS. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers)) |
| Clerk prebuilt email-code resend uses a 30-second cooldown and codes last 10 minutes | **Verified** | Clerk documents those values for the prebuilt flow. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/email-sms-otp)) |
| “Mixed UI is the best approach for Composery” | **Unverified** | That is an architectural recommendation. The facts support it, but no vendor source can decide it for Composery. |

## Report: “Clerk Auth Flow State Machine”

| Material claim | Status | Evidence / decision |
|---|---|---|
| `signUpIfMissing: true` permits an identifier-first flow that does not branch to sign-up until after verification | **Verified** | Clerk documents exactly this privacy-preserving flow. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up)) |
| The transition can yield `sign_up_if_missing_transfer`, followed by `signUp.create({ transfer: true })` | **Verified** | This is Clerk's documented Core 3 sequence. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up)) |
| The standard identifier flow can disclose whether an account exists earlier than the privacy-preserving mode | **Verified** | Clerk documents the behavioral difference as part of User Enumeration Protection. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up)) |
| A custom implementation is necessary to obtain that privacy behavior | **Contradicted** | Clerk explicitly says an embedded `<SignIn />` already supports the corresponding behavior according to the instance's enumeration-protection setting. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up)) |
| The custom privacy flow supports passwords in the same way | **Contradicted / not supported** | Clerk's documented `signUpIfMissing` flow is verification-oriented and specifically does not provide a general password equivalent. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up)) |
| OAuth callbacks must handle transfer between sign-in and sign-up, existing sessions, and incomplete sign-up | **Verified** | Current custom OAuth-flow docs enumerate those outcomes. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/oauth-connections)) |
| An OAuth callback involved in sign-up transfer also needs the CAPTCHA mount | **Verified** | Clerk's callback example includes it for exactly this reason. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/oauth-connections)) |
| “Authentication complete” can still leave a Clerk session task to resolve | **Verified** | Clerk documents pending session tasks after authentication; prebuilt components resolve them, custom flows must account for them. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/session-tasks)) |
| Clerk exposes `account_lockout_warning` and `user_locked` | **Verified** | These are documented frontend errors. ([Clerk](https://clerk.com/docs/guides/development/errors/frontend-api)) |
| The account is always locked after exactly 10 failures for exactly 60 minutes | **Unverified** | The primary source establishes warning/error states, not those universal figures. Do not encode them in UI logic. |
| `<ClerkDegraded>` means partial availability and `<ClerkFailed>` means Clerk failed to load | **Verified** | That is how Clerk defines them. ([Clerk](https://clerk.com/docs/reference/components/control/clerk-degraded)) |
| Therefore Composery must keep all auth forms enabled during degraded mode and block during failed mode | **Unverified** | Sensible UX policy, but it is a Composery decision rather than a Clerk guarantee. |
| Fallback redirect URLs preserve an explicit redirect whereas force redirect URLs override it | **Verified** | Clerk documents the priority distinction. ([Clerk](https://clerk.com/docs/nextjs/reference/types/sign-in-redirect-options)) |
| Next 16 should use `proxy.ts`, with authorization enforced near the protected resource | **Verified** | Next 16 renamed middleware to Proxy, and current Next guidance emphasizes checks close to the data/action rather than treating middleware as the sole authorization boundary. ([Clerk](https://clerk.com/docs/nextjs/getting-started/quickstart?utm_source=chatgpt.com)) |
| `auth.protect()` always redirects an unauthenticated request | **Contradicted if generalized** | Clerk's Next behavior differs between document pages, Route Handlers and Server Actions. ([Clerk](https://clerk.com/docs/nextjs/guides/secure/protect-content)) |
| Clerk supplies a documented reserved-username vocabulary Composery should duplicate | **Unverified** | I found no primary-source contract for an application-consumable reserved-name list. Treat Composery handles as an application policy. |

## Report: “Clerk CSP Recommendations”

| Material claim | Status | Evidence / decision |
|---|---|---|
| Clerk requires its Frontend API, Cloudflare challenge/protect hosts and Clerk image host in CSP | **Verified** | These appear in Clerk's current CSP requirements. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers)) |
| `https://*.protect.clerk.com:*` needs the port wildcard under `connect-src` | **Verified** | Clerk explicitly documents non-443 connections from the protection service. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers)) |
| The report's listed directives are sufficient without `worker-src` | **Contradicted** | Current requirements also include `worker-src 'self' blob:`. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers)) |
| Clerk UI requires `style-src 'unsafe-inline'` today | **Verified** | Explicit in the current CSP guide. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers)) |
| A non-nonce App Router CSP commonly needs inline script allowance; nonce CSP forces dynamic rendering | **Verified** | Next's CSP documentation describes nonce extraction, dynamic rendering, and loss of static optimization/PPR/CDN caching benefits. ([Next.js](https://nextjs.org/docs/app/guides/content-security-policy)) |
| Clerk can configure strict CSP/nonces through `clerkMiddleware` | **Verified** | Current Clerk CSP integration supports automatic CSP, including strict mode. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers)) |
| More-specific Next header rules can replace an earlier CSP header | **Verified, order-dependent** | Next says when multiple rules set the same header, the later matching value overrides. ([Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers)) |
| `Cross-Origin-Opener-Policy: same-origin-allow-popups` is suitable where OAuth popups need an opener relationship | **Verified as browser policy, not a Clerk requirement** | MDN specifically identifies OAuth/payment popup use cases. ([MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy)) |
| `form-action 'self'` can never affect OAuth | **Unverified / overbroad** | `form-action` constrains form submission targets. Conventional Clerk OAuth need not be a cross-origin HTML form submission, but “never” is stronger than the standards evidence. ([MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action)) |
| Switch CAPTCHA to Invisible to prevent layout shifts | **Contradicted** | Invisible is deprecated; Smart is recommended/default. ([Clerk](https://clerk.com/docs/js-frontend/guides/development/custom-flows/authentication/bot-sign-up-protection)) |
| The right fix is to reserve layout capacity for a CAPTCHA challenge | **Unverified fact; recommended engineering deduction** | Clerk decides when Smart CAPTCHA expands. Composery therefore needs to make that expansion non-destructive to layout rather than disabling it. |

A further reason not to hand-maintain the Clerk host list unnecessarily: `@clerk/nextjs`'s automatic CSP support has been updated as Clerk's protection domains changed. During this migration I would use Clerk's CSP generation rather than copy a frozen list into `next.config.ts`. ([Clerk](https://clerk.com/docs/guides/secure/best-practices/csp-headers))

## Report: “Production Clerk Convex Runbook”

| Material claim | Status | Evidence / decision |
|---|---|---|
| Clerk development users cannot be transferred into the production instance | **Verified** | Clerk explicitly says instance user data does not transfer to production. ([Clerk](https://clerk.com/docs/guides/development/managing-environments)) |
| Therefore a development Clerk user ID must not be treated as the production identity for that person | **Verified deduction** | Production creates a different user; business data needs an explicit application migration/mapping rather than transplanting the dev auth ID. |
| Production requires the production domain and production credentials/configuration for external SSO | **Verified** | Clerk's production guide requires the custom domain and production OAuth setup. ([Clerk](https://clerk.com/docs/guides/development/managing-environments)) |
| Every production setting must be manually recreated because Clerk cannot clone development configuration | **Contradicted** | `clerk deploy` now creates/clones a production instance from development configuration and guides subsequent setup. ([Clerk](https://clerk.com/changelog/2026-06-10-clerk-deploy)) |
| `clerk deploy` also migrates users | **Contradicted** | It clones configuration, not instance user data. ([clerk.com](https://clerk.com/changelog/2026-06-10-clerk-deploy?utm_source=chatgpt.com)) |
| Every Clerk CNAME on Cloudflare must be DNS-only | **Unverified / too broad** | Cloudflare says proxying can interfere with third-party CNAME ownership/verification, so **verification records** should be DNS-only. It separately distinguishes records intended to proxy web traffic. Clerk does not provide a blanket Cloudflare-specific “every FAPI CNAME must be gray-clouded” requirement. ([Cloudflare Docs](https://developers.cloudflare.com/dns/manage-dns-records/troubleshooting/cname-domain-verification/)) |
| Keep Account Portal enabled while the replacement is brought up | **Verified as Clerk's recommendation** | Clerk recommends retaining it as a fallback even with custom/in-app UI; disabling it transfers full responsibility to the application. ([Clerk](https://clerk.com/docs/guides/account-portal/disable-account-portal)) |
| Convex's Clerk auth config should use the production issuer with application ID `convex` | **Verified** | This is Convex's documented Clerk integration. ([Convex Developer Hub](https://docs.convex.dev/auth/clerk)) |
| Production webhooks should authenticate Clerk events rather than trusting POST bodies | **Verified** | Clerk provides webhook signature verification; Convex's Clerk integration documents synchronizing user lifecycle events. ([Clerk](https://clerk.com/docs/reference/backend/verify-webhook)) |
| Production Google OAuth needs your own production credentials and exact Clerk callback URI | **Verified** | Clerk documents custom Google credentials for production and the configured redirect URI. ([Clerk](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)) |
| Restrict production allowed subdomains/parties rather than leaving them open-ended | **Verified** | Clerk recommends allowed-subdomain restrictions, and its token verification guidance recommends validating authorized parties/`azp`. ([Clerk](https://clerk.com/docs/guides/dashboard/dns-domains/subdomain-allowlist)) |
| Disable Account Portal immediately on cutover | **Unverified as a requirement** | Evidence supports the opposite conservative posture: keep it until you consciously accept loss of the fallback. |

## Report: “Design account flows”

| Material claim | Status | Evidence / decision |
|---|---|---|
| Use `<UserProfile />` for the ordinary profile/security surface rather than reimplementing all credential/account management | **Verified capability; recommended topology** | UserProfile is Clerk's supported embedded account-management surface and automatically participates in Clerk reverification. ([Clerk](https://clerk.com/docs/reference/components/user/user-profile?utm_source=chatgpt.com)) |
| Clerk can condition whether users may self-delete | **Verified** | `deleteSelfEnabled` is a user capability in Clerk. Exact 7.9.2 UI code hides the delete section when it is false.  |
| Calling frontend `user.delete()` also signs the user out | **Contradicted** | Clerk's own 7.9.2 `DeleteUserForm` wraps `user.delete()` in reverification and then **separately** calls `setActive({ session: null })`.  |
| Clerk's prebuilt sensitive account operations automatically trigger reverification | **Verified** | Clerk documents automatic reverification in its prebuilt profile UI for sensitive changes/deletion. ([Clerk](https://clerk.com/docs/guides/secure/reverification)) |
| A custom destructive endpoint can enforce Clerk reverification | **Verified** | Clerk documents server-side `auth().has({ reverification: 'strict' })` and `useReverification()` on the invoking client. ([Clerk](https://clerk.com/docs/guides/secure/reverification?utm_source=chatgpt.com)) |
| Convex `getUserIdentity()` can evaluate `fva` | **Contradicted** | Convex explicitly omits `fva` from returned identity data. ([Convex Developer Hub](https://docs.convex.dev/auth/functions-auth)) |
| An action-specific Clerk custom claim such as `reverification_id` can be used for replay/intent binding | **Verified capability** | Clerk documents exposing the session's reverification ID as a custom claim for one-action verification schemes. ([Clerk](https://clerk.com/docs/guides/secure/reverification)) |
| Convex scheduling from a mutation is atomic | **Verified** | Scheduled work created by a mutation is committed atomically with that mutation. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions)) |
| Scheduled Convex mutations get exactly-once/retry semantics whereas scheduled actions are at-most-once and are not automatically retried | **Verified** | Convex explicitly distinguishes the guarantees. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions)) |
| Therefore an action failure should be driven by a durable mutation/coordinator that can schedule another attempt | **Verified deduction** | This follows directly from those scheduling guarantees. |
| “Delete Clerk first, then asynchronously delete VPSs” is vendor-required | **Unverified** | Neither Clerk nor Convex can decide your business failure semantics. It is an architectural choice. |
| “VPS deletion should always require fresh step-up” | **Unverified as a fact; strong recommendation** | Clerk provides the mechanism, but the risk threshold is a Composery product/security decision. |

---

# Where the reports disagree

The first substantive disagreement is **whether to build a custom combined authentication state machine or use Clerk's prebuilt UI**. The custom-flow report correctly describes Clerk's state machine, but the comparison report understates what embedded `<SignIn />` now does. Clerk's current primary source settles the narrow question: **you do not need a custom flow merely to get a single in-app sign-in/sign-up surface with enumeration protection**. ([Clerk](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up)) Build one only for behavior or presentation that Clerk's prebuilt component cannot satisfy.

The second is **CAPTCHA strategy**. The CSP/layout report's Invisible recommendation loses: it is deprecated. The custom-flow report is closer to current evidence—keep a real CAPTCHA mount and design for the Smart challenge. ([Clerk](https://clerk.com/docs/js-frontend/guides/development/custom-flows/authentication/bot-sign-up-protection))

The third is **production configuration**. The production report reflects the older “rebuild prod manually” world. As of June 2026, `clerk deploy` can clone development configuration into a new production instance. User data remains isolated, so the report's data-migration warning still stands. ([clerk.com](https://clerk.com/changelog/2026-06-10-clerk-deploy?utm_source=chatgpt.com))

The fourth is **deletion semantics**. The account report treats Clerk deletion and logout too closely. Exact 7.9.2 source demonstrates separate operations, which is especially important for a custom saga. 

The final disagreement is not resolvable from evidence: **whether the identity or the VPSs should disappear first**. Convex tells you how to make cleanup durable; it does not tell you which business failure is preferable. I recommend identity-first only after persisting an immutable cleanup manifest, because an orphaned VPS can still be recovered by backend automation while “VPSs gone but Clerk deletion failed” has already destroyed the customer's compute despite leaving their account usable. That is a risk judgment, not a Clerk/Convex fact.

# Recommended surface architecture

| Surface | Recommendation | Why |
|---|---|---|
| **Sign-in** | `/sign-in/[[...sign-in]]` with embedded Clerk `<SignIn />` | Keeps Clerk's transfers, enumeration protection, OAuth, CAPTCHA, legal requirements and session-task handling without leaving Composery. |
| **Sign-up** | **Do not implement a second auth state machine initially.** Let `<SignIn />` perform sign-up. Make `/sign-up` a compatibility/marketing route that lands on the same Clerk auth surface while preserving return state. | Lowest state-machine ownership while still supporting “Create account” entry links. A separate `<SignUp />` remains available later if product/analytics require distinct acquisition UX. |
| **Account menu** | Composery/Base UI menu driven by Clerk user/session state: avatar/name, Account settings, Sign out | This is lightweight navigation/presentation and does not benefit much from Clerk owning its visuals. |
| **Account settings** | `/account/[[...account]]` with `<UserProfile />`; add a stable `<UserProfile.Page>` for Composery-specific danger-zone/resource actions | Clerk keeps ownership of credential/security edge cases and reverification; Composery owns VPS/account lifecycle. Avoid the experimental fully composed profile API for now. |
| **Account deletion** | Set self-delete unavailable in the default Clerk profile and expose only Composery's danger-zone deletion flow | Prevents bypassing the VPS/business cleanup policy. Exact 7.9.2 UserProfile hides its deletion UI when self-deletion is disabled.  |
| **VPS deletion** | Composery UI + fresh Clerk reverification at the destructive server boundary | This is a Composery resource, not an identity-provider concern. |

For styling, use Clerk's supported appearance API plus a Clerk Tailwind layer rather than deep DOM/CSS assumptions. For CSP, start with Clerk's automatic current policy during cutover; do not fork the provider-host list into a handwritten stale copy. ([Clerk](https://clerk.com/changelog/2025-06-17-css-layer-name))

# Product decisions the evidence cannot make

| Decision | Choice and consequence |
|---|---|
| **One auth entry vs distinct sign-up page** | One entry means fewer routes/states and identical privacy behavior. A distinct sign-up surface permits acquisition-specific copy/analytics and deliberate sign-up deep links but enlarges the browser-test matrix. |
| **Enumeration-protection mode** | Stronger protection delays account-existence disclosure and changes the user's mental model. Less restrictive behavior can make recovery/login more explicit but leaks more information. |
| **Password support in a custom privacy flow** | If password-first/custom password semantics are a hard requirement, the documented `signUpIfMissing` flow is not a drop-in solution; that substantially raises custom-flow scope. |
| **Reverification scope** | Clerk's `strict` policy gives a freshness window and is simpler. An operation-bound `reverification_id` plus replay ledger gives “one verified action” semantics but adds storage and failure modes. |
| **Account-deletion grace period** | Immediate Clerk deletion removes access quickly but makes customer recovery harder. A grace period requires a suspended/deleting state and explicit cancellation semantics. |
| **Identity-first vs VPS-first deletion** | Identity-first needs a durable pre-delete manifest and backend cleanup because the customer can no longer sign in. VPS-first reduces orphan risk but can destroy resources before a later identity deletion fails. |
| **What happens to snapshots/backups/billing/org ownership** | This is retention and business policy. It has to be explicit before account deletion can be considered implemented. |
| **Default CSP vs strict nonce CSP** | Strict removes `'unsafe-inline'` for script but makes the affected Next tree dynamically rendered and sacrifices static/ISR/PPR/CDN behavior; Clerk UI still needs inline style permission. ([Next.js](https://nextjs.org/docs/app/guides/content-security-policy)) |
| **Keep Account Portal indefinitely vs disable it** | Keeping it provides a Clerk-maintained emergency escape hatch. Disabling it ensures all user journeys remain branded/in-app but makes Composery solely responsible for every recovery/account path. Clerk recommends keeping it. ([Clerk](https://clerk.com/docs/guides/account-portal/disable-account-portal)) |
| **Remote Clerk UI vs explicitly bundled/pinned UI** | Remote/default UI can receive Clerk UI fixes independently. Pinning/bundling improves reproducibility but turns UI upgrades into your release responsibility. Clerk supports disabling prefetch/bundling choices. ([Clerk](https://clerk.com/docs/reference/components/clerk-provider)) |
| **Cloudflare proxying of the serving FAPI record** | The evidence only clearly requires DNS-only behavior where proxying would interfere with verification. Do not extrapolate that into a universal rule; test the actual Clerk records generated for production. |

# Implementation slices, in order

These are deliberately phrased as pass/fail slices rather than “finish auth” milestones.

| Slice | Implementation | Acceptance checks |
|---|---|---|
| **0. Freeze the actual baseline** | Record lockfile versions and Clerk/Convex feature settings in an architecture note. No secrets. | CI asserts Next `16.3.x`, React `19.3.x`, Clerk `7.9.x`, Convex `1.45.x`; a major/minor drift fails. If the lockfile says Clerk 7.9.2, the exact-source findings above apply directly. |
| **1. Provider and resource-auth skeleton** | Next 16 `proxy.ts` for Clerk/bootstrap concerns, `<ClerkProvider>`, then Convex's Clerk-aware provider. Perform authorization again at each page/Route Handler/Server Action/data boundary. | Signed-out browser navigation to protected `/app` redirects to `/sign-in`; signed-in navigation succeeds. A protected Route Handler and protected Server Action exhibit the intentionally chosen Clerk response semantics. Convex only reports authenticated once its token is ready. |
| **2. CSS and CSP baseline** | Add Clerk's Tailwind layer and `cssLayerName`. Enable Clerk's generated CSP; include its current worker/protect/image requirements. Choose default vs strict deliberately. | Browser console has **zero CSP violations** on auth and account pages. Clerk images load. CAPTCHA and OAuth frames load. In strict mode, the request carries a nonce and the route is observably dynamic; in default mode, the expected inline-script allowance is documented. |
| **3. Embedded auth route** | Implement `/sign-in/[[...sign-in]]` with `<SignIn />`; use fallback rather than force redirects unless “always go to app home” is explicitly chosen. Point `/sign-up` at the same product flow initially. | Existing-user email flow passes; new-user flow passes; OAuth passes; a protected deep link returns to the requested same-origin page; direct `/sign-in` lands on `/app`; explicit return state beats fallback. |
| **4. Privacy, legal, CAPTCHA and tasks** | Configure the chosen enumeration policy, legal settings and Smart CAPTCHA in Clerk. Avoid custom state transitions unless a concrete unmet requirement appears. | Existing/new identifiers exhibit the selected privacy behavior. When legal consent is enabled, account creation cannot finish without it. A challenge can expand without overlapping controls. Pending session-task test accounts do not enter `/app` prematurely. |
| **5. Account menu + UserProfile** | Custom Base UI menu; dedicated `<UserProfile />`; add Composery danger-zone page through stable profile extension APIs. Turn off ordinary Clerk self-deletion if custom cleanup is mandatory. | Menu opens/closes keyboard-accessibly; Account settings loads; Sign out makes both Clerk and Convex protected operations fail; email/security modification triggers Clerk's expected reverification; the stock Delete account section is absent; Composery danger zone is present. |
| **6. Destructive reverification boundary** | Put VPS/account destructive initiation behind a Clerk-aware Next Route Handler or Server Action. On stale auth, return Clerk's reverification response; call it from a client wrapped in `useReverification()`. | Browser: stale session → Clerk reverify UI; cancel → zero DB/VPS changes; success → original operation retries once. Server test: an unverified request cannot create a deletion intent. |
| **7. Intent/replay protection** | If you require exactly-one destructive authorization, bind an operation to a `reverification_id`/nonce and persist replay state. Do **not** infer freshness from Convex `fva`. | Convex tests: replay is rejected; subject mismatch rejected; operation mismatch rejected; a direct browser call cannot bypass the Next verification boundary. |
| **8. Durable account-deletion prepare phase** | In one Convex mutation create/idempotently retrieve a deletion ID, lock the account against new resources, and snapshot the VPS IDs plus all backend cleanup identifiers needed after Clerk disappears. | Re-running `prepare` creates no second manifest; mutation failure leaves neither half a lock nor half a manifest; after prepare, server-creation mutations for that customer fail with the explicit deleting state. |
| **9. Delete identity + webhook reconciliation** | After prepare, the verified server boundary deletes the Clerk user with the Backend API. Treat verified `user.deleted` webhook processing as the durable confirmation path and idempotently advance the Convex deletion record. Do not rely on frontend `user.delete()` for a server lifecycle saga. | Test with a disposable account: Clerk deletion succeeds; browser becomes unauthenticated; duplicate `user.deleted` events cause one state transition; a dropped browser response does not prevent later webhook-driven cleanup. |
| **10. VPS cleanup coordinator** | An internal Convex mutation schedules idempotent cleanup actions from the stored manifest. Each action records success/failure through mutations; coordinator reschedules outstanding work rather than assuming action retry. | Convex tests simulate one action failure: completed VPSs are not deleted twice, failed VPS remains outstanding, coordinator can schedule another attempt, account reaches `deleted` only after every required cleanup is terminal. |
| **11. Production instance cutover** | Use `clerk deploy`; inspect rather than blindly trust cloned config. Install exact DNS records, production Google OAuth, Convex production issuer, webhook endpoint, allowed subdomains/parties and deployment env. Leave Account Portal enabled. | `clerk deploy status` is green; production sign-in/sign-up/OAuth/profile/reverify/sign-out work; production Convex accepts a production Clerk token and rejects a dev one; webhooks verify; CSP console stays clean; a fresh prod user is not incorrectly joined by dev Clerk ID. |
| **12. Optional Portal retirement** | Only after production soak/test coverage. | Known hosted Account Portal URL has the deliberately expected post-disable behavior, while every in-app auth, recovery and profile scenario continues to pass. The runbook contains the rollback path. |

One architectural detail I would change from the deletion report is the boundary between Next and Convex. A normal public Convex mutation authenticated only through `ctx.auth.getUserIdentity()` **cannot prove recent Clerk verification from `fva`**, because Convex removes that field. ([Convex Developer Hub](https://docs.convex.dev/auth/functions-auth)) Keep fresh-verification enforcement on the Clerk-aware server boundary, and ensure the corresponding Convex entry point cannot simply be invoked by a browser without that proof.

For the actual cleanup engine, use Convex mutations as durable coordination points and actions only for the external VPS side effects. That matches Convex's guarantees instead of trying to turn at-most-once actions into a workflow engine. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions))

# Documentation changes

### Architecture/decision records

Record the decisions rather than just implementation mechanics: embedded prebuilt auth; one initial auth entry; custom Base UI account menu; prebuilt UserProfile plus stable custom danger-zone page; no stock Clerk self-delete; destructive reverification policy; deletion ordering; Account Portal fallback policy; CSP default/strict choice; enumeration setting; redirect semantics; and whether Clerk UI is remote/default or pinned/bundled.

Explicitly record which items are **product policy**, because otherwise a later developer will mistake them for Clerk requirements—especially account-deletion ordering, grace periods, VPS step-up, Portal retirement, and nonce CSP.

### Authentication setup guide

Document the route tree, provider order, `proxy.ts` responsibility, resource-level authorization pattern, Tailwind layer order, chosen Clerk Dashboard settings, `/sign-up` compatibility behavior, same-origin return-url policy, Smart CAPTCHA behavior, and the fact that session tasks must complete before granting normal application access.

Also document the non-obvious Next behavior that a protected document, Route Handler and Server Action do not necessarily produce the same unauthenticated response. ([Clerk](https://clerk.com/docs/nextjs/guides/secure/protect-content))

### Environment-variable example

Only names/placeholders belong in source documentation; deployment-secret values do not.

```dotenv
# Browser-safe Clerk configuration
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<from-deployment-configuration>
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/app
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/app

# Server-only; inject from the deployment secret store
CLERK_SECRET_KEY=[redacted]

# Browser-safe Convex deployment URL
NEXT_PUBLIC_CONVEX_URL=<production-or-development-convex-url>

# Convex deployment environment
CLERK_JWT_ISSUER_DOMAIN=<clerk-issuer-for-this-environment>

# Server-side webhook verification
CLERK_WEBHOOK_SIGNING_SECRET=[redacted]
```

If you choose the one-action reverification design, document the **non-secret** Clerk session-claim mapping for `reverification_id` separately from environment variables, and document where replay IDs are retained. Clerk's documented custom-claim approach is preferable to inventing meaning for `fva` inside Convex. ([Clerk](https://clerk.com/docs/guides/secure/reverification))

### Production runbook

Replace “manually recreate the production instance” with:

`clerk deploy` → review cloned settings → configure/verify DNS → install production OAuth credentials → verify production Convex issuer → configure and test signed webhooks → restrict allowed origins/subdomains/parties → run the full browser matrix → keep Account Portal enabled during soak → optionally disable it as a separate change.

The runbook should say specifically that **configuration may be cloned, users are not**. ([clerk.com](https://clerk.com/changelog/2026-06-10-clerk-deploy?utm_source=chatgpt.com))

For Cloudflare, write “make verification records DNS-only where Cloudflare proxying prevents third-party verification; follow the concrete records emitted by Clerk and verify with `clerk deploy status`,” not “all Clerk CNAMEs must always be DNS-only.”

### Deletion/runbook documentation

Define a deletion state machine such as `prepared → identity_delete_requested → identity_deleted → cleanup_pending → cleanup_complete`, plus explicit retry/terminal/error states. Document which transitions are idempotent, what data the immutable cleanup manifest contains, webhook deduplication, action retry coordination, operational recovery for a deletion stuck after identity removal, and the data-retention rules for logs/backups.

Also document that Clerk identity deletion and session clearing are distinct operations—the exact 7.9.2 UI source demonstrates that separation. 

## Final recommendation

I would **not** build the custom Clerk Core 3 authentication state machine now. Its report is technically useful as a map of what you would be assuming responsibility for, but the very existence of those states is evidence *against* owning them unless Composery has a concrete requirement that the embedded prebuilt flow cannot meet.

Ship the first replacement as:

**Composery route + Clerk `<SignIn />` → Composery Base UI account menu → Clerk `<UserProfile />` with a Composery danger-zone page → Clerk-reverified, Convex-durable custom VPS/account deletion workflow.**

That gets the hosted Account Portal out of the normal product journey without unnecessarily taking ownership of OAuth transfer, account enumeration, CAPTCHA, legal consent, credential management, incomplete sign-ups, session tasks, or routine sensitive-account reverification. Keep the Portal as a production fallback until this browser/Convex acceptance matrix is green.
