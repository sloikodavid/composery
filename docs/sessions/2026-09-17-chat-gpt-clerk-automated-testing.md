# Clerk Automated Testing

Source: https://chatgpt.com/share/6aac0adf-1660-83ed-9ece-d1a488c28fed

---

## Turn 1: User

_2026-09-17T13:58:29.846Z_

As of September 2026, document how teams run automated tests against a real Clerk instance: `@clerk/testing`, testing tokens, test email addresses and verification codes in development instances, rate limits and user-count limits of development instances, creating and deleting users through the Backend API in tests, and how teams keep test users from leaking. Report whether Clerk recommends a separate application or instance for automated tests, and what Clerk's terms say about automated use. Include what teams report does not work, such as receiving webhooks on a developer machine, and how they work around it.

---

## Turn 2: ChatGPT

_2026-09-17T13:58:43.091Z_

I’ll separate Clerk’s documented guidance from team-reported practice, then cover the operational details (tokens, test identities, limits, Backend API cleanup, webhooks, and terms) with dates and source quality clearly marked.

---

## Turn 3: ChatGPT

_2026-09-17T13:58:53.976Z_

The official picture is already fairly clear on two important points: development instances are capped at 100 users, and Clerk’s testing features are explicitly designed to automate against a real instance rather than mock Clerk. I’m checking the less explicit parts now—whether Clerk advises a dedicated test app/instance, and how teams avoid exhausting that 100-user pool.

---

## Turn 4: ChatGPT

_2026-09-17T13:59:36.107Z_

A practical wrinkle is that Clerk’s own latest Playwright docs now explicitly tell teams to clean up users in global teardown. That guidance matters because the 100-user development cap turns “forgotten teardown after a failed CI run” from tidiness into a reliability issue.

---

## Turn 5: ChatGPT

_2026-09-17T13:59:57.585Z_

As of **September 17, 2026**, the normal Clerk pattern for automated end-to-end testing is to run the tests against a **real Clerk development instance**, not a mock: CI gets development `pk_test_*` / `sk_test_*` credentials, `@clerk/testing` obtains a Testing Token to get past bot protection, and the suite either reuses a small number of persistent test users or creates temporary real Clerk users through the Backend API and deletes them afterward. Clerk’s own testing package is explicitly for **E2E testing, not unit tests**; Clerk’s broader testing guidance treats mocks as appropriate for lower-level integration/unit tests and real Clerk as the E2E layer. ([Clerk](https://clerk.com/docs/guides/development/testing/cypress/overview?utm_source=chatgpt.com))

### What the supported setup looks like

For Playwright, Clerk’s current guide installs `@clerk/testing`, supplies `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, and runs `clerkSetup()` in a Playwright **project-based setup**. `clerkSetup()` obtains a Testing Token once for the run; individual browser tests call `setupClerkTestingToken({page})`, or use `clerk.signIn()`, which invokes the token setup internally. Cypress has the analogous `clerkSetup()` and `setupClerkTestingToken()` flow. Clerk warns that the Secret Key should be stored as a CI secret rather than exposed in source or logs. ([Clerk](https://clerk.com/docs/guides/development/testing/playwright/overview?utm_source=chatgpt.com))

A Testing Token is a short-lived, instance-specific credential whose purpose is to bypass Clerk’s bot-detection layer. Without it, browser automation can be rejected as `"Bot traffic detected"`. It can be created by `clerk.testingTokens.createTestingToken()` / `POST /testing_tokens`, or `@clerk/testing` can obtain and inject it automatically; at the Frontend API level it is carried as the `__clerk_testing_token` query parameter. Testing Tokens technically work on both development and production instances, but Clerk documents limitations for production—particularly around code-based authentication—and its examples consistently use development keys. ([Clerk](https://clerk.com/docs/reference/backend/testing-tokens/create-testing-token?utm_source=chatgpt.com))

For tests that do not actually need to exercise the sign-in UI, the newer Playwright helper has an important shortcut: `clerk.signIn({emailAddress})` uses a **server-side Backend API token** and bypasses email verification and MFA. That is faster and less fragile than driving the login form. If the test is specifically intended to validate sign-up, OTP, password, or Clerk UI behavior, then the browser flow remains appropriate. ([Clerk](https://clerk.com/docs/guides/development/testing/playwright/test-helpers?utm_source=chatgpt.com))

### Test identities, OTPs, and mail

Development instances have Clerk “test mode” enabled by default. A test email uses a `+clerk_test` subaddress, for example `e2e+clerk_test@example.com`; generated variants such as `testuser+clerk_test_1712345@example.com` are useful when each signup must be unique. For email-code verification, Clerk does **not** send a message and the fixed OTP is **`424242`**. Fictional US `555-01xx` numbers similarly use `424242` without sending SMS. ([Clerk](https://clerk.com/docs/guides/development/testing/test-emails-and-phones?utm_source=chatgpt.com))

Email-link testing is different: Clerk says a verification-link email is actually sent and the link is valid for ten minutes. Its documentation describes E2E email-link testing as an “uphill task” and recommends enabling email verification codes for automated suites instead. ([Clerk](https://clerk.com/docs/guides/development/testing/test-emails-and-phones?utm_source=chatgpt.com))

Using `+clerk_test` also keeps test traffic from producing ordinary Clerk mail such as verification and new-device messages, which is why Clerk recommends it even for persistent test accounts. Clerk’s current Playwright auth-state guide explicitly suggests a `+clerk_test` address for this purpose. ([Clerk](https://clerk.com/docs/guides/development/testing/playwright/test-authenticated-flows?utm_source=chatgpt.com))

There is a second reason to do this. When Clerk itself delivers messages for a development instance, the documented monthly allowance is **100 emails and 20 SMS messages per calendar month**. Test addresses/numbers, US SMS, self-delivered messages, and paid-app messaging are among the cases excluded from those limits. ([Clerk](https://clerk.com/docs/guides/development/testing/test-emails-and-phones?utm_source=chatgpt.com))

### Development-instance limits that matter in CI

| Limit | As of Sep. 2026 | Consequence for test suites |
|---|---:|---|
| Development-instance users | **100 users** | Signup tests must delete temporary users or eventually hit the cap. ([Clerk](https://clerk.com/docs/guides/development/managing-environments?utm_source=chatgpt.com)) |
| Backend API, development | **100 requests / 10 sec per instance** | Parallel seed/cleanup jobs can receive `429`; obey `Retry-After`. ([Clerk](https://clerk.com/docs/guides/how-clerk-works/system-limits?utm_source=chatgpt.com)) |
| Backend API, production | **1,000 / 10 sec** | Higher, but not a reason to run CI against production. ([Clerk](https://clerk.com/docs/guides/how-clerk-works/system-limits?utm_source=chatgpt.com)) |
| Frontend: create sign-in | **5 / 10 sec per IP** | CI workers sharing one egress IP can contend. ([Clerk](https://clerk.com/docs/guides/how-clerk-works/system-limits?utm_source=chatgpt.com)) |
| Frontend: create sign-up | **5 / 10 sec per IP** | Same issue for highly parallel signup tests. ([Clerk](https://clerk.com/docs/guides/how-clerk-works/system-limits?utm_source=chatgpt.com)) |
| Attempt sign-in factor | **3 / 10 sec per IP** | Avoid repeatedly driving OTP/password flows where a server-side sign-in suffices. ([Clerk](https://clerk.com/docs/guides/how-clerk-works/system-limits?utm_source=chatgpt.com)) |
| Attempt signup verification | **3 / 10 sec per IP** | Parallel OTP signup tests need throttling/retry. ([Clerk](https://clerk.com/docs/guides/how-clerk-works/system-limits?utm_source=chatgpt.com)) |

The 100-user cap is especially easy to miss. Clerk’s current sign-up testing guide now says explicitly that sign-up tests create real users and recommends a **Playwright global teardown that deletes users via the Clerk Backend API**. ([Clerk](https://clerk.com/docs/guides/development/testing/playwright/test-sign-up-flows))

Clerk also recommends leaving the normal maximum session lifetime enabled on an instance used for E2E testing; otherwise repeatedly signing in the same account can accumulate a very large number of live sessions. The default maximum lifetime on new instances is seven days. ([Clerk](https://clerk.com/docs/guides/secure/session-options?utm_source=chatgpt.com))

### Creating and deleting users in test code

The Backend API is often a cleaner setup mechanism than UI signup when the purpose of a test is everything *after* authentication. `createUser()` creates a real Clerk user and, by default, Backend-API-created email addresses and phone numbers are already verified. The method supports an `externalId` and private metadata, both useful for marking CI-created identities. `deleteUser(userId)` maps to `DELETE /v1/users/{user_id}`. ([Clerk](https://clerk.com/docs/reference/backend/user/create-user))

A typical harness therefore creates something like `externalId: "e2e:<run-id>:<test-id>"`, keeps every returned Clerk `user.id` in run state, and deletes those IDs in teardown. Clerk’s API can also query users by `externalId`, exact email, creation time, or a broader text query, so a second “janitor” pass can find users left behind when a CI machine is killed before teardown runs. The API supports up to 500 users per list page, which is more than enough for a 100-user development instance. ([Clerk](https://clerk.com/docs/reference/backend/user/get-user-list))

One caution: Clerk does **not** currently expose bulk user deletion as a single supported Dashboard/API operation; its user-management docs say bulk deletion requires contacting support. Cleanup code therefore iterates `deleteUser()` calls, which also means it should respect the development Backend API rate limit. ([Clerk](https://clerk.com/docs/guides/users/managing?utm_source=chatgpt.com))

The robust pattern is consequently “create → record the Clerk ID immediately → run test → delete in `finally`/global teardown,” plus an age-based cleanup job for interrupted runs. A small set of stable fixture accounts can instead be reused for tests that do not need signup semantics; Playwright’s `storageState` lets a suite authenticate once and reuse that state, and Clerk tells developers to keep those state files under something such as `playwright/.clerk/` and put the directory in `.gitignore`. ([Clerk](https://clerk.com/docs/guides/development/testing/playwright/test-authenticated-flows?utm_source=chatgpt.com))

### Does Clerk recommend a separate Clerk application for automated tests?

There is an important distinction here. **I found no current public Clerk E2E guide that says every team must create a completely separate Clerk application solely for automated tests.** Clerk’s official Playwright demo instead says to supply **development-instance keys**, and its test user is automatically created in that dev instance. ([GitHub](https://github.com/clerk/clerk-playwright-nextjs))

Clerk *does*, however, explicitly recommend a **separate Clerk application** when you need an independently isolated staging environment and user pool. Its environment documentation says Clerk only exposes Development and Production instance types to ordinary applications; for staging, create a separate application so staging data does not mix with live production data. Sharing production credentials with staging is explicitly described as “not recommended.” ([Clerk](https://clerk.com/docs/guides/development/managing-environments?utm_source=chatgpt.com))

So the defensible reading in September 2026 is: **using the normal Development instance is Clerk’s documented baseline for CI E2E tests; a dedicated application is an isolation choice, not a stated requirement.** For a team with heavy CI, using a separate application’s Development instance is sensible because it isolates the 100-user quota, config mutations, webhooks, and test identities from developers’ day-to-day dev data—but that last sentence is an operational recommendation derived from Clerk’s isolation model, not a direct Clerk mandate.

Clerk itself uses stronger isolation internally. Its JavaScript repository says its integration tests run against development instances owned by a dedicated “Integration testing” organization, with multiple environment-specific Clerk instances/configurations and test users that are deleted in `afterAll`. That is evidence of how Clerk’s own engineering team structures a large real-instance test suite, rather than a customer requirement. ([GitHub](https://github.com/clerk/javascript/blob/main/integration/README.md?utm_source=chatgpt.com))

### What does not work cleanly, and the workarounds

Direct Clerk webhooks to `localhost` do not work. Clerk’s webhook service is on the public internet and cannot initiate a request to a developer’s private `localhost`; Clerk’s troubleshooting docs say this explicitly. The documented workarounds are a public tunnel such as ngrok, localtunnel, Cloudflare Tunnel or Pinggy, or a hosted webhook inspector/forwarder such as Beeceptor. ([Clerk](https://clerk.com/docs/guides/development/webhooks/debugging?utm_source=chatgpt.com))

As of 2026 there is also a first-party Clerk CLI workflow: `clerk webhooks listen` opens a relay and forwards real Clerk webhook deliveries to the developer’s local endpoint while preserving the `svix-*` headers needed for signature verification. The relay URL still has to be registered as the webhook endpoint in Clerk. This removes much of the ngrok setup. ([Clerk](https://clerk.com/docs/cli?utm_source=chatgpt.com))

Webhook delivery itself should not be treated as synchronous test setup. Clerk describes webhooks as asynchronous and not guaranteed to arrive immediately or at all; flows that must proceed immediately after user creation should read Clerk state directly or call the Backend API rather than waiting for a webhook. Svix retries failed deliveries and Clerk supports replay. ([Clerk](https://clerk.com/docs/guides/development/webhooks/overview?utm_source=chatgpt.com))

Other current, documented testing traps include Playwright’s `--disable-web-security`: it strips the cross-origin `Origin` header, preventing Clerk from loading the full environment configuration and causing the `<SignUp />` component to fall back to a reduced form. Clerk says to remove that Chromium flag. Another is using Playwright’s old function-style `globalSetup`; because it executes in another process, environment variables populated by `clerkSetup()` do not reach test workers, yielding errors such as `"Clerk Frontend API URL is required"`. Clerk’s fix is a **project-based setup with dependencies**. ([Clerk](https://clerk.com/docs/guides/development/testing/playwright/overview?utm_source=chatgpt.com))

Production keys on ordinary `localhost` are another non-starter: Clerk performs production-origin validation, so `pk_live_`/`sk_live_` are tied to the configured production domain. Clerk documents a special hosts-file/subdomain trick for troubleshooting, but notes that OAuth has redirect limitations and webhooks still cannot reach localhost without a tunnel. ([Clerk](https://clerk.com/docs/guides/development/troubleshooting/using-production-keys-in-development?utm_source=chatgpt.com))

There have also been user reports of `@clerk/testing` failing under multiple Playwright workers—for example, a February 2026 GitHub issue where `clerk.signIn()` succeeded with one worker but timed out with two or more. That issue is now **closed**, so I would treat it as historical evidence that high parallelism has exposed Clerk/session-testing edge cases, not as a current documented `--workers=1` requirement. The durable limits to design around are the published per-IP Frontend limits and per-instance Backend limit. ([GitHub](https://github.com/clerk/javascript/issues/7891?utm_source=chatgpt.com))

### Terms: is automated testing allowed?

The important legal distinction is between Clerk’s **Website Terms** and the terms governing the **Clerk Service**.

Clerk’s Website Terms prohibit using robots, spiders, or other automated processes to access or scrape the Clerk **website**. But those same Website Terms explicitly say that Clerk’s products and services, including free trials, are instead governed by Clerk’s Order Form and **Standard Terms & Conditions**. ([Clerk](https://clerk.com/legal/website-terms))

The current Standard Terms, last updated **July 2, 2026**, do not contain a blanket “no automated access” or “no robots” provision. They grant customers the right to use the Service for internal business purposes **in accordance with the Documentation**; they impose restrictions such as no reverse engineering, unlawful use, malicious code, unauthorized access, and use outside the agreed service scope, and Clerk may suspend usage that violates the agreement, threatens the hosted environment, or exceeds applicable paid usage. ([Clerk](https://clerk.com/legal/standard-terms))

That matters because Clerk’s own Documentation expressly provides Testing Tokens, `@clerk/testing`, automated Playwright/Cypress integrations, and Backend API endpoints “meant for use by end-to-end test suites.” In other words, ordinary automated E2E testing through the documented product APIs is not merely tolerated—it is a documented product use case. The website anti-bot clause should not be read as forbidding an E2E suite that uses Clerk’s supported testing APIs. ([Clerk](https://clerk.com/docs/reference/backend-api?utm_source=chatgpt.com))

### A production-quality operating model

For a team building this today, I would use one Clerk **Development** instance dedicated to CI if the test volume is non-trivial; configure it to match the auth features under test, but never point CI at the real production user pool. Keep `sk_test_*` only in CI secrets, use `@clerk/testing` and a single Testing Token per run, and use `clerk.signIn({emailAddress})` for tests that need authentication but do not need to test the login UI. Reserve actual UI signup/OTP flows for a smaller set of auth-specific tests.

Those signup tests should generate unique `+clerk_test` addresses, use `424242`, record the returned Clerk user IDs, and delete them through the Backend API in teardown. Tag BAPI-created users with a unique `externalId` or private metadata so a periodic janitor can remove abandoned runs. Reuse a few persistent fixture users plus Playwright `storageState` for the bulk of authenticated application tests. Throttle highly parallel auth flows enough to stay below both the per-IP Frontend limits and the 100-request/10-second development Backend API limit. For webhook-dependent tests, either run against a publicly reachable deployed test environment or use the Clerk CLI/ngrok relay; do not wait for a webhook as a synchronous prerequisite when a Backend API read can establish the same state. ([Clerk](https://clerk.com/docs/reference/backend/user/create-user))

The net effect is that Clerk works quite well as a **real external dependency in a thin E2E layer**, provided the suite treats the development instance as a finite shared resource—especially the 100-user pool and auth rate limits—and makes cleanup and isolation first-class parts of the test harness.

---

If you want, I can:

- Summarize key Clerk testing limits and cleanup best practices
- Explain Clerk's recommended setup for Playwright-based E2E testing
- Outline workarounds for Clerk webhook testing limitations
