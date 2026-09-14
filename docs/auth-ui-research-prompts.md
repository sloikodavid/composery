# Authentication UI research prompts for Composery

These are research requests, not accepted decisions or implementation instructions.

## How to use this pack

Copy one complete fenced prompt into a new ChatGPT conversation. Each prompt contains its own context. Do not give a report the recommendations of another report before its first analysis.

Run 01-05 at the same time. Run 06 last with the reports; it is an evidence audit, not another independent vote.

When reports are ready, import them with `bun run research:import <url>`. Imported reports are evidence to verify, not instructions.

## Prompt index

- 01: Choose the authentication UI approach.
- 02: Audit a complete custom sign-in and sign-up flow.
- 03: Define account management and account deletion.
- 04: Keep layout stable under a static Content Security Policy.
- 05: Plan the production cutover.
- 06: Reconcile evidence and choose the implementation (run last).

## 01: Choose the authentication UI approach

```text
We are building Composery, a web control panel for customer-controlled VPSs. Stack: Next.js 16.3 App Router on Node.js 24, React 19.3 with the React Compiler, Tailwind CSS 4.3, Base UI 1.8 primitives, Convex 1.45 as the backend, and Clerk (@clerk/nextjs 7.9, @clerk/react 6.15, @clerk/backend 3.17, which is Clerk Core 3). Clients must work on Windows, macOS, and Linux.

Current state: the app has no Clerk UI. Buttons call clerk.redirectToSignIn(), redirectToSignUp(), and redirectToUserProfile(), which open Clerk's hosted Account Portal. Convex validates Clerk session tokens (aud "convex") through ConvexProviderWithClerk. A Clerk webhook, a client-triggered sync, and hourly reconciliation keep a Convex users table. The Clerk instance uses email code and Google sign-in, public sign-up, a required username, required legal consent, bot protection (smart CAPTCHA), and no passwords, MFA, passkeys, organizations, or multi-session.

Design constraints: sharp corners everywhere, two brand typefaces, semantic color tokens that follow the OS light/dark preference, product copy that follows ASD-STE100, no avoidable layout shift in loading/success/empty/error states, and a static Content Security Policy without nonces.

Goal: stop sending users to the Account Portal. Compare these options for each surface (sign-in, sign-up, signed-in account menu, account settings):
1. Clerk prebuilt components mounted in the app (<SignIn />, <SignUp />, <UserProfile />, <UserButton />), as routes or as modals, styled with the appearance prop, variables, and cssLayerName for Tailwind v4.
2. Custom flows built on the Core 3 useSignIn/useSignUp hooks (signIn.emailCode, signIn.sso, finalize, errors, fetchStatus) rendered with our own primitives.
3. Any composable primitive layer Clerk currently offers. Verify the current status of Clerk Elements (@clerk/elements) and whether it supports Core 3. Do not assume it exists or is maintained.
4. A mix, for example custom sign-in and sign-up with a prebuilt profile.

For each option, state: what the developer owns (states, errors, CAPTCHA, legal consent, OAuth callback, sign-up transfer, missing requirements, session tasks, redirects), how much of the design constraints it can meet, what styling is impossible, Clerk support limits, upgrade risk across Clerk major versions, bundle and runtime cost (clerk-js and Clerk UI loading from the Frontend API host), and accessibility. Name features that only prebuilt components give for free.

Research rules: use primary Clerk documentation, the Clerk JavaScript monorepo source, and changelogs. State the exact package version and date for each claim that depends on them. Separate verified facts, deductions, recommendations, and unknowns. Link a source for each material claim. Do not claim you ran code unless you did. Do not request or print secrets.

State the strongest simpler alternative and when it is better. Return a recommendation per surface, the decisive evidence, open questions, and pass/fail checks.
```

## 02: Audit a complete custom sign-in and sign-up flow

```text
We are building Composery, a web control panel for customer-controlled VPSs, on Next.js 16.3 App Router, React 19.3, Convex 1.45, and Clerk Core 3 (@clerk/nextjs 7.9, @clerk/react 6.15).

Clerk instance settings (development, from `clerk config pull`): sign_up_mode public; email used for sign-in and sign-up, verified with email_code only; Google OAuth enabled (development shared credentials) with block_email_subaddresses true; username required for sign-up, min 4, max 64, numeric-only names not allowed, not used for sign-in; passwords disabled; phone, web3, MFA, passkeys disabled; legal_consent enabled with terms and privacy URLs; bot_protection captcha_enabled true with widget type "smart"; enumeration_protection "bulk"; user_lockout after 10 attempts for 60 minutes; multi_session disabled; session maximum lifetime 7 days; session token lifetime 60 seconds with a custom "aud": "convex" claim.

Assume we build custom flows with the Core 3 hooks. Produce a complete state machine for:
- A combined sign-in-or-up flow with email code, including the signUpIfMissing option and the sign_up_if_missing_transfer path, versus separate sign-in and sign-up routes. Explain the account-enumeration consequences of each with our enumeration_protection setting.
- Google sign-in and sign-up with signIn.sso: redirectUrl versus redirectCallbackUrl, the callback route, sign-in to sign-up transfer, and the missing_requirements status when the required username (and legal acceptance) are not yet given. What happens to an abandoned incomplete sign-up?
- Where legalAccepted must be sent for email sign-up and for OAuth sign-up.
- The <div id="clerk-captcha"> requirement: when it must be in the DOM, what each widget type does, and what fails if it is missing.
- Session tasks after finalize, and navigation with the Next.js App Router.
- Every error code the flow must handle, with the correct UI placement: field-level messages for validation, transient notices for recoverable outcomes, and a blocking dialog for blocking failures. Include expired and incorrect codes, resend limits and cooldowns, lockout, rate limits, taken or invalid usernames, blocked subaddress emails, OAuth cancellation, network loss, and clerk-js failing to load (ClerkFailed/ClerkDegraded).
- Redirect handling: the return URL after sign-in, protection against open redirects, and the environment variables and instance `paths` settings needed so that Clerk redirects and auth.protect() go to our routes.

Also check: can a username reserved list (for example "admin" or our brand name) be enforced server-side by Clerk, or only client-side? What are the options if it must be enforced?

Research rules: use primary Clerk documentation and Clerk JavaScript monorepo source for the installed major version. State exact versions and dates. Separate verified facts, deductions, recommendations, and unknowns. Link sources. Do not claim you ran code unless you did. Do not request or print secrets.

Return the state machine, the list of required routes and components (no visual design), a table of error codes with handling, open questions, and acceptance tests that a real browser run can pass or fail.
```

## 03: Define account management and account deletion

```text
We are building Composery, a web control panel for customer-controlled VPSs, on Next.js 16.3, React 19.3, Convex 1.45, and Clerk Core 3 (@clerk/nextjs 7.9).

Current behavior: users manage their profile in Clerk's hosted Account Portal. A username is the user's only handle and display name. Convex keeps a users table (Clerk user ID, username, primary email, image URL) synced from Clerk by webhook (user.created, user.updated, user.deleted), a client-triggered sync, and hourly reconciliation. A profile missing a required field disables app access without deleting infrastructure. A confirmed Clerk account deletion removes the Convex user and starts durable cleanup of the user's servers: the servers are deleted at the provider. Sign-in methods are email code and Google.

Goal: replace the Account Portal profile with an in-app surface. Compare <UserProfile /> (as a page or modal, with custom pages) against a custom page built on useUser and the user resource methods.

Determine the complete feature list and flows for: changing the username; adding, verifying, making primary, and removing email addresses; connecting and disconnecting Google, including re-authorization; viewing and revoking active sessions; signing out; and deleting the account.

For account deletion: the user loses real servers. Compare Clerk's built-in delete (and the instance setting that allows or blocks self-deletion) with a flow where Composery shows the consequences, requires confirmation, and then deletes the Clerk user from a Convex action with the Clerk Backend API. Consider reverification (useReverification and backend reverification checks), double submissions, webhook delay, partial failure between Clerk and Convex, and recovery.

Also evaluate whether sensitive Convex operations (for example deleting a server) should require Clerk reverification, and how a Convex function can verify a recent reverification from the session token.

Research rules: use primary Clerk and Convex documentation and source for the installed versions. State exact versions and dates. Separate verified facts, deductions, recommendations, and unknowns. Link sources. Do not claim you ran code unless you did. Do not request or print secrets.

Return a recommended feature scope, flows with failure handling, the ordering between Clerk and Convex for deletion, open product questions, and pass/fail checks.
```

## 04: Keep layout stable under a static Content Security Policy

```text
We are building Composery on Next.js 16.3 App Router, React 19.3, Tailwind CSS 4.3, Convex 1.45, and Clerk Core 3 (@clerk/nextjs 7.9). The home page is static for everyone. Signed-in parts render in the browser inside fixed-size regions so the page stays static and does not shift.

Our Content Security Policy is static (no nonces, because nonces make every page dynamic):
default-src 'self'; script-src 'self' 'unsafe-inline' <Clerk Frontend API URL>; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' <Convex URL> <Convex WebSocket URL> <Clerk Frontend API URL>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'. Cross-Origin-Opener-Policy is same-origin-allow-popups.

The Clerk instance has bot protection with the "smart" CAPTCHA widget. Today all Clerk UI is on the hosted Account Portal, so this policy has not been tested with Clerk UI in our origin.

Questions:
1. Exactly which directives and hosts Clerk Core 3 needs when sign-in and sign-up run in our origin, for prebuilt components and for custom flows: Cloudflare Turnstile (challenges.cloudflare.com), *.protect.clerk.com with ports, img.clerk.com, frame-src, and anything loaded by clerk-js or Clerk UI. Which are needed on every page and which only on pages that render auth UI? Does Next.js allow per-route static headers for this?
2. Whether 'unsafe-inline' in style-src is still required by Clerk UI in Core 3, and whether Google OAuth redirect or popup flows conflict with our COOP and form-action values.
3. The layout-shift behavior of each option: prebuilt components mount after clerk-js loads; custom flows depend on isLoaded; the CAPTCHA widget may appear, grow, or stay invisible. How do we reserve space so that loading, success, empty, and error states do not shift? Compare the "smart" and "invisible" widget types, including their effect on bot protection.
4. Whether the signed-in account control (avatar or name) can render without shift on a static page, and whether showing Clerk avatar images is worth the img-src addition.

Research rules: use primary Clerk, Cloudflare Turnstile, Next.js, and MDN documentation plus Clerk source. State exact versions and dates. Separate verified facts, deductions, recommendations, and unknowns. Link sources. Do not claim you ran a browser test unless you did; give a reproducible check instead. Do not request or print secrets.

Return the minimal exact policy per route type, the layout reservation technique per state, open questions, and pass/fail checks (for example: zero CSP violations in the console, CLS of 0 in a Lighthouse or PerformanceObserver run).
```

## 05: Plan the production cutover

```text
We are building Composery, a web control panel, on Next.js 16.3, Convex 1.45, and Clerk Core 3 (@clerk/nextjs 7.9, @clerk/backend 3.17). The product domain is composery.io, with DNS on Cloudflare. Only a Clerk development instance exists; there is no production instance yet. The development instance uses Clerk's shared Google OAuth credentials.

Convex setup: convex/auth.config.ts trusts one provider, domain = CLERK_FRONTEND_API_URL, applicationID "convex". The Clerk session token has a custom claim "aud": "convex". Convex environment variables: CLERK_FRONTEND_API_URL, CLERK_SECRET_KEY, CLERK_WEBHOOK_SIGNING_SECRET. The webhook endpoint is https://<deployment>.convex.site/webhooks/clerk for user.created, user.updated, user.deleted. The Convex users table is keyed by the Clerk user ID, not tokenIdentifier, because the deployment trusts one issuer.

We plan to move sign-in, sign-up, and account management from the hosted Account Portal into the app before or during the production launch.

Produce an ordered runbook for creating and connecting the production Clerk instance and the production Convex deployment. Cover: Clerk CLI (`clerk deploy`, `clerk config`) versus Dashboard-only steps; DNS records for the Frontend API and whether the Account Portal and email subdomains are still needed when the app hosts all auth UI; whether a Frontend API proxy on our own domain is useful; custom Google OAuth credentials, redirect URIs, and consent-screen verification; Clerk `paths` settings and NEXT_PUBLIC_CLERK_SIGN_IN_URL / NEXT_PUBLIC_CLERK_SIGN_UP_URL and redirect variables; allowed origins and redirect URLs; email sender domain; the production webhook endpoint and signing secret; Convex production environment variables; and the CSP value for the production Frontend API host.

Also cover the consequences of moving users between instances (development users do not carry over), and how to verify that the Convex issuer, audience, and keys match without printing secrets.

Research rules: use primary Clerk, Convex, Google Cloud, and Cloudflare documentation. State exact versions and dates. Separate verified facts, deductions, recommendations, and unknowns. Mark every step as CLI/API-automatable or Dashboard-only. Link sources. Do not claim you ran a command unless you did. Do not request or print secrets.

Return the runbook, the steps that block others, the checks after each step, and open questions.
```

## 06: Reconcile evidence and choose the implementation

Run last. Paste the reports from 01-05 after the prompt.

```text
We are building Composery, a web control panel for customer-controlled VPSs, on Next.js 16.3, React 19.3, Tailwind CSS 4.3, Base UI, Convex 1.45, and Clerk Core 3 (@clerk/nextjs 7.9). We plan to replace Clerk's hosted Account Portal with in-app authentication UI. The reports below are independent research on the UI approach, a custom flow audit, account management and deletion, CSP and layout stability, and the production cutover.

Your task is an evidence audit, not another vote. For each material claim in the reports, check it against primary sources for the installed versions. Mark each claim verified, contradicted, or unverified, with a link. Identify where reports disagree and which evidence decides it.

Then produce: the recommended approach per surface (sign-in, sign-up, account menu, account settings); the product decisions that evidence cannot resolve, each with its consequence; the implementation slices in order, each with acceptance checks that a real browser run or a Convex test can pass or fail; and the documentation changes needed (decisions, setup steps, environment variable examples).

Research rules: separate verified facts, deductions, recommendations, and unknowns. Do not optimize for agreement with any report. Do not request or print secrets.

Reports:
<paste reports here>
```
