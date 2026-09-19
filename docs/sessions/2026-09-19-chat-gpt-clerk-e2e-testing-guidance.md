# Clerk E2E Testing Guidance

Source: https://chatgpt.com/share/6aae66d7-42e4-83eb-90de-340064c2ed32

---

## Turn 1: User

_2026-09-19T10:38:17.853Z_

For Clerk, document the official guidance and known practice for automated end-to-end testing against a real development instance: creating and deleting users through the Backend API, bot/CAPTCHA behaviour for programmatic sign-ins, rate limits that apply to test traffic, whether a development instance has user or request caps, and how to make webhooks (user.created, user.updated, user.deleted) reach a locally running server — including whether clerk webhooks listen-style relays exist, what they require, and their limits. Cite official sources, and say where practice differs from documentation.

---

## Turn 2: ChatGPT

_2026-09-19T10:38:23.396Z_

# Clerk: automated end-to-end testing against a real development instance

**Research date:** 19 September 2026

**Scope:** Real Clerk development instances, Backend API user lifecycle operations, automated authentication, rate limits, instance capacity, and webhook delivery to a locally running application.

## Executive summary

Clerk explicitly supports automated testing against real instances. Its official testing guidance includes Backend API session creation, short-lived testing tokens that bypass bot detection, and Playwright/Cypress integrations. Its webhook documentation supports synchronizing application data from user lifecycle events. <Cite refs={["turn660637search6","turn660637search0"]}/>

The important distinctions are:

- **User provisioning is separate from signing in.** Backend API user creation can establish a test identity without exercising an interactive sign-up flow. A browser test still needs an authenticated session.
- **Bot protection is expected in automated authentication.** Clerk documents testing tokens specifically to bypass bot detection rather than relying on CAPTCHA-solving or disabling production security controls.
- **Development instances are rate-limited.** The documented general Backend API limit is 100 requests per 10 seconds per instance, with separate limits for certain operations. Frontend authentication requests have tighter IP-based limits. <Cite refs={["turn940754view0","turn940754view2"]}/>
- **Webhooks are asynchronous.** Creating a user successfully does not guarantee that your application's corresponding webhook has already arrived. Test suites must wait for observable delivery or downstream state rather than assume synchronous completion. <Cite refs={["turn660637search4","turn660637search0"]}/>
- **Clerk now documents a native local webhook relay.** The Clerk CLI includes `clerk webhooks listen`, in addition to the ngrok-based approach documented in Clerk's webhook guides. <Cite refs={["turn660637search7","turn660637search0"]}/>

The sections below distinguish documented guarantees, operational guidance, and areas where the published documentation does not establish a firm guarantee.

---

---

## Turn 3: ChatGPT

_2026-09-19T10:38:54.152Z_

## 1. Creating, updating and deleting test users

<badge color="success">Officially supported</badge>

Clerk provides both Backend API endpoints and SDK methods for these operations. They operate on a real Clerk instance, not an authentication mock. <Cite refs={["turn146119search9","turn285346search2"]}/>

### Backend API operations

| Operation | HTTP endpoint | JavaScript SDK |
|---|---|---|
| Create user | `POST /v1/users` | `users.createUser(params)` |
| Update user | `PATCH /v1/users/{user_id}` | `users.updateUser(userId, params)` |
| Delete user | `DELETE /v1/users/{user_id}` | `users.deleteUser(userId)` |

Clerk documents the creation and deletion endpoints directly, including their SDK wrappers. <Cite refs={["turn146119search2","turn146119search0","turn146119search9"]}/>

Use the development instance's secret key as the Backend API bearer token. Keep it in the test runner or server environment, not browser code.

Here is a minimal test-fixture example using `@clerk/backend`:

<CodeBlock language="typescript" editable={true}>import { createClerkClient } from '@clerk/backend'

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
})

const user = await clerk.users.createUser({
  emailAddress: ['e2e+clerk_test_001@example.com'],
  password: process.env.E2E_TEST_PASSWORD!,
  firstName: 'E2E',
  lastName: 'User',
})

const userId = user.id

try {
  // Run tests using this Clerk user.
  // You can also update the user here.
} finally {
  await clerk.users.deleteUser(userId)
}</CodeBlock>

The `+clerk_test` address follows Clerk's documented test-email convention. Use a unique address per concurrently running fixture; ordinary identifier uniqueness still matters. <Cite refs={["turn146119search1","turn146119search2"]}/>

**Important details:**

Clerk's user-creation endpoint respects your configured user model: fields marked required must be provided, and disabled fields cannot be supplied. Email addresses and phone numbers created through this method are verified automatically by default. Clerk also supports explicitly reserving identifiers instead of marking them verified. <Cite refs={["turn940754view3","turn146119search2"]}/>

Clerk's official Playwright sign-up guide specifically recommends deleting test users after a run using global teardown and the Backend API. The implementation above additionally uses `finally` to handle cleanup when an individual test fails. <Cite refs={["turn146119search3","turn146119search0"]}/>

There is no general bulk-delete operation. Clerk's user-management documentation says bulk deletion is not currently available through the Dashboard or programmatically. Delete individually, retain the created IDs, and provide a recovery cleanup procedure for interrupted runs. <Cite refs={["turn146119search5","turn146119search0"]}/>

### Creating an authenticated session

Creating a user does not automatically authenticate your test browser.

For backend-to-backend integration tests, Clerk documents this sequence:

<box border radius="xl" padding={3} gap={2} align="center">
  <box background="surface-secondary" radius="md" padding={3} width="100%" align="center">
    **Create test user**

    `users.createUser()`
  </box>
  <icon name="arrow-down" color="secondary"/>
  <box background="surface-secondary" radius="md" padding={3} width="100%" align="center">
    **Create session**

    Backend Sessions API
  </box>
  <icon name="arrow-down" color="secondary"/>
  <box background="surface-secondary" radius="md" padding={3} width="100%" align="center">
    **Mint session token**

    Backend session-token endpoint
  </box>
  <icon name="arrow-down" color="secondary"/>
  <box background="surface" border={{size:1,color:"#389E72"}} radius="md" padding={3} width="100%" align="center">
    **Call your application's API**

    `Authorization: Bearer <session_token>`
  </box>
</box>

Clerk documents a 60-second session-token lifetime for this testing workflow. Refresh the token using the session-token endpoint when necessary. This is not the same as saying the underlying user session expires after 60 seconds. <Cite refs={["turn940754view0","turn287395search6"]}/>

For browser E2E tests, Clerk's Playwright helper supports creating authenticated browser state and reusing it across tests. This avoids repeating interactive authentication for every test case. <Cite refs={["turn285346search1"]}/>

**Practical distinction:** Use the Backend API when testing authenticated application behavior without the login UI. Use an actual Frontend API or browser sign-in flow when authentication itself is the subject of the test.

---

## 2. Programmatic sign-in, bot detection and CAPTCHA

<badge color="success">Official testing mechanism available</badge>

Clerk has two relevant protections that should not be conflated.

Its automated-traffic safeguards can reject E2E requests with a `Bot traffic detected` error. Separately, Clerk's configurable bot sign-up protection can present an interactive CAPTCHA challenge when it suspects a client is automated. Clerk's application logs also identify CAPTCHA events for sign-in flows. <Cite refs={["turn285346search11","turn285346search3","turn285346search10"]}/>

### Method A: Testing Tokens

Clerk's prescribed E2E mechanism is a Testing Token.

You can create one using:

```typescript
const testingToken =
  await clerk.testingTokens.createTestingToken()
```

The underlying Backend API endpoint is `POST /v1/testing_tokens`. Include the resulting token in the `__clerk_testing_token` query parameter of Frontend API requests. Tokens are short-lived and instance-specific. <Cite refs={["turn285346search5","turn940754view0"]}/>

A typical request has the following structure:

```http
POST /v1/client/sign_ins?__clerk_testing_token=TOKEN
```

The exact host and API path depend on the Frontend API integration. Clerk's documentation explicitly demonstrates the same parameter on a sign-up request. <Cite refs={["turn940754view0","turn285346search5"]}/>

The token bypasses Clerk's documented bot-detection safeguards for testing. It is not a user session token, a substitute for valid authentication credentials, or an exemption from published rate limits.

### Method B: Clerk's official testing integrations

For Playwright and Cypress, use the supported `@clerk/testing` package.

Clerk's Cypress integration obtains a Testing Token during `clerkSetup()` and provides `setupClerkTestingToken()` for tests. <Cite refs={["turn285346search4"]}/>

For Playwright, Clerk documents a reusable authentication-state workflow:

```typescript
import {
  clerk,
  clerkSetup,
} from '@clerk/testing/playwright'

// Run as part of global setup.
await clerkSetup()

// In a test with Playwright's page fixture:
await clerk.signIn({
  page,
  emailAddress: process.env.E2E_CLERK_USER_EMAIL!,
})
```

This is a shortened illustration; follow the official Playwright guide for its complete setup and storage-state configuration.

Clerk's email-address sign-in helper uses a server-side token and bypasses verification steps, including MFA. This makes it useful for getting tests into authenticated state, but it does not test the MFA or password-authentication experience itself. <Cite refs={["turn285346search1"]}/>

### Method C: Real verification flows without real email or SMS

For tests that deliberately exercise the sign-in or sign-up UI, Clerk provides fixed test identifiers in development test mode.

| Test identity | Behaviour |
|---|---|
| `alice+clerk_test@example.com` | Test email; use verification code `424242`. |
| `+12015550100` | Fictional test phone; use verification code `424242`. |

Test mode is enabled by default on development instances. The relevant send-code operation is still required, even though Clerk does not deliver the test OTP. Clerk recommends code-based verification for E2E rather than email-link verification. <Cite refs={["turn146119search1","turn846405search11"]}/>

These mechanisms solve different problems: test identifiers eliminate dependence on real email/SMS delivery; Testing Tokens address bot detection.

### CAPTCHA-specific limitations

Clerk's current bot-protection documentation says:

- Its Smart CAPTCHA appears only when a client is suspected of being a bot.
- Clerk's prebuilt `<SignUp />` handles the challenge automatically.
- Custom sign-up UIs must include a `clerk-captcha` DOM element when CAPTCHA protection is enabled.
- The Native API provides a public pathway that bypasses browser CAPTCHA, but Clerk explicitly advises enabling it only for native applications or browser extensions that need it. <Cite refs={["turn285346search3","turn285346search12"]}/>

For web E2E automation, Testing Tokens and Clerk's testing helpers are the documented approach. Enabling the Native API solely as a testing workaround would change the application's public security posture.

**Documentation versus observed practice:** Reports of programmatic sign-ins encountering bot detection are consistent with Clerk's own documentation and the reason Testing Tokens were introduced. However, the documentation does not establish that every headless-browser sign-in must encounter a CAPTCHA, or that every kind of bot-detection response is itself a CAPTCHA. Avoid treating either as a universal rule.

One historical discrepancy is worth noting: Clerk's April 2024 Testing Token announcement described development-only availability. Its current testing documentation explicitly says Testing Tokens work in both development and production, with restrictions on code-based authentication in production. The newer documentation supersedes the older launch announcement. <Cite refs={["turn285346search11","turn940754view0"]}/>

---

---

## Turn 4: ChatGPT

_2026-09-19T10:39:37.874Z_

## 3. Rate limits affecting test traffic

<badge color="warning">Enforced limits</badge>

Clerk publishes separate rate limits for the Frontend API and Backend API. They apply to test traffic; using a development instance or a Testing Token does not establish an exemption.

### Backend API limits

| Operation | Documented limit | Scope |
|---|---:|---|
| General Backend API | 100 requests / 10 seconds | Development instance |
| General Backend API | 1,000 requests / 10 seconds | Production instance |
| Create user | 100 requests / 10 seconds | Development instance |
| Delete user | General Backend API limit | Instance |
| Update user or metadata | 10 requests / 10 seconds | Per user |
| Create invitation | 100 requests / hour | Endpoint |
| Bulk invitations | 25 requests / hour | Endpoint |
| Retrieve JWKS | No rate limit | Endpoint |

The limits are documented in Clerk's rate-limit reference. The general Backend API limit applies to all methods, including `GET`, and is scoped to an application instance identified by its secret key. The user-update limit is an additional endpoint-specific constraint. <Cite refs={["turn902586search1","turn146119search2"]}/>

Clerk returns HTTP `429` when a rate limit is exceeded, together with a `Retry-After` header containing the number of seconds until the block expires. <Cite refs={["turn902586search1"]}/>

A practical consequence is that parallel workers using the same development instance compete for the same Backend API capacity. Use shared throttling for fixture creation, deletion, session issuance and polling. On `429`, respect `Retry-After` rather than immediately retrying.

### Frontend API limits

| Operation | Documented limit |
|---|---:|
| Create sign-in | 5 requests / 10 seconds |
| Create sign-up | 5 requests / 10 seconds |
| Attempt first or second sign-in factor | 3 requests / 10 seconds |
| Attempt sign-up verification | 3 requests / 10 seconds |

Clerk describes Frontend API limits as per-user limits identified by IP address. <Cite refs={["turn902586search1"]}/>

This matters particularly in CI: many independent browser workers can share the same public egress IP address.

For predictable test runs, control authentication concurrency, reuse authenticated browser state where appropriate, and keep a small number of authentication-specific tests separate from the larger application test suite.

### Other relevant limits

Clerk also documents that its development instances can send at most 20 SMS messages and 100 emails per calendar month when Clerk is the delivery provider, subject to documented exceptions. Once exhausted, requests that generate SMS or email OTPs are rejected.

Test identifiers, self-delivered messages, SMS to US numbers and applications with paid subscriptions have the documented exemptions. <Cite refs={["turn146119search1","turn902586search6"]}/>

This is an additional reason to use test identifiers instead of disposable real inboxes.

---

## 4. Does a development instance have user or request caps?

<badge color="danger">100-user cap documented</badge>

### User capacity

Clerk's current environment documentation explicitly states:

**A development instance is capped at 100 users.**

The same document says development user data cannot be transferred between instances. Development instances are not intended to serve production workloads. <Cite refs={["turn846405search4"]}/>

An older Clerk changelog confirms the 100-user cap and warns that reaching development limits can prevent sign-ups or sign-ins. <Cite refs={["turn287395search7"]}/>

For automated testing, this means a suite that continually creates users without reliably deleting them can exhaust its development instance.

Deleting fixtures should therefore be part of the test architecture, not occasional manual maintenance. Keep a fixture registry, scope cleanup to users owned by the test run, and avoid deleting unrelated developer accounts.

Clerk's published documentation does not establish a safe exception that allows Backend API-created users to exceed the 100-user cap. Even if someone observes a different enforcement threshold in practice, that should not be relied on as a supported capability.

### Request capacity

The published general Backend API limit is 100 requests per 10 seconds for development instances. Frontend API endpoints have separate limits, as detailed above. <Cite refs={["turn940754view2"]}/>

I found no documented general monthly or lifetime request quota for ordinary development-instance authentication traffic in the reviewed official references.

That is a limited finding, not a guarantee of unlimited traffic: Clerk's documentation establishes specific rate limits and other feature-specific quotas, rather than an unrestricted testing allowance.

Also, do not confuse the pricing page's production-oriented monthly retained user allowance with the development instance's 100-user capacity. They describe different restrictions. <Cite refs={["turn287395search5","turn846405search4"]}/>

**Capacity planning conclusion:** For ordinary E2E workloads, design around a maximum of 100 users resident in the development instance, 100 Backend API requests per 10 seconds, and much tighter authentication-endpoint limits.

---

## 5. Making Clerk user webhooks reach localhost

<badge color="success">Multiple officially documented options</badge>

Clerk uses <Entity value="Svix" category="company"/> to deliver webhooks. Webhook delivery is an outgoing HTTP POST from Clerk's infrastructure; Clerk cannot directly reach a server bound to your machine's `localhost`. <Cite refs={["turn902586search0","turn902586search3"]}/>

There are now two useful approaches: a native Clerk CLI relay and an ordinary HTTP tunnel.

### Events to subscribe to

| Event | What triggers it | Typical local action |
|---|---|---|
| `user.created` | User registration or creation through Dashboard/Backend API | Insert application user |
| `user.updated` | User modification through Clerk components, Dashboard or Backend API | Update application user |
| `user.deleted` | Account deletion through user action, Dashboard or Backend API | Delete or soft-delete application user |

Clerk explicitly documents these triggers in its synchronization guide. <Cite refs={["turn902586search2"]}/>

The three events must be selected for the webhook endpoint that will receive them. Selecting only `user.created` is insufficient for lifecycle testing.

### Option A — Native Clerk CLI relay

<badge color="success">Available in Clerk CLI 2.0</badge>

Clerk announced its native webhook tooling on 9 July 2026. The CLI documentation confirms that `clerk webhooks listen` opens a local relay and that `clerk webhooks verify` performs offline signature verification. Neither operation requires a linked Clerk project. <Cite refs={["turn768786search1","turn940754view1"]}/>

<box border radius="xl" padding={3} gap={2} align="center">
  <box border radius="md" padding={3} width="100%" align="center">
    **Clerk development instance**

    Creates `user.created` / `user.updated` / `user.deleted`
  </box>
  <icon name="arrow-down" color="secondary"/>
  <box background="surface-secondary" radius="md" padding={3} width="100%" align="center">
    **Clerk/Svix delivery**

    Sends to registered endpoint
  </box>
  <icon name="arrow-down" color="secondary"/>
  <box border radius="md" padding={3} width="100%" align="center">
    **Clerk relay inbox**

    `https://webhooks.clerk.com/in/c_.../`
  </box>
  <icon name="arrow-down" color="secondary"/>
  <box background="surface-secondary" radius="md" padding={3} width="100%" align="center">
    **Running Clerk CLI**

    `clerk webhooks listen`
  </box>
  <icon name="arrow-down" color="secondary"/>
  <box border={{size:1,color:"#389E72"}} radius="md" padding={3} width="100%" align="center">
    **Your local webhook handler**

    `http://localhost:3000/api/webhooks`
  </box>
</box>

Install the current CLI:

```bash
npm install -g clerk
```

Start your local application, then start the relay:

```bash
clerk webhooks listen \
  --token "$(clerk webhooks token)" \
  --forward-to http://localhost:3000/api/webhooks
```

Clerk's official CLI recipes document that command and the relay inbox URL it generates. <Cite refs={["turn848982view0","turn940754view1"]}/>

Now open Clerk Dashboard → Webhooks → Add Endpoint. Register the printed relay URL, selecting all three user lifecycle events.

For this method, register the relay inbox URL itself. The local path is already specified through `--forward-to`.

Copy that endpoint's signing secret into your local environment:

```bash
CLERK_WEBHOOK_SIGNING_SECRET=[redacted]
```

Keep the application and listener running, then perform a real user creation or update through the Backend API. The CLI forwards the delivery to your handler, preserving the `svix-*` headers required for signature verification. <Cite refs={["turn846405search1","turn848982view0"]}/>

#### What the Clerk relay requires

The listener itself needs a current Clerk CLI and network connectivity to the relay, but does not need `clerk auth login`, a linked project, or Platform API credentials.

However, that does not mean the whole setup is account-free: you still need a Clerk instance, access to configure its Dashboard webhook endpoint, and the endpoint's signing secret. The relay does not automatically register its URL with your application. <Cite refs={["turn848982view0","turn846405search1"]}/>

#### Native relay limitations

| Limitation | Consequence |
|---|---|
| Listener must run | The local forwarding path depends on a running CLI process and server. |
| URL may change | Without a pinned token, restarting can generate a new inbox URL. |
| Dashboard registration required | Running `listen` alone will not cause Clerk to send events to it. |
| Delivery remains asynchronous | The relay does not turn webhooks into synchronous API operations. |
| Connectivity matters | A dropped relay connection can interrupt local forwarding. |

These limitations follow from Clerk's CLI instructions and webhook reliability documentation. The CLI's agent-mode reference explicitly describes a long-running listener and a `reconnecting` event when the relay connection drops. <Cite refs={["turn317352search0","turn317352search2","turn902586search0"]}/>

For a stable address across restarts or machines, persist a generated relay token and reuse it through `--token`. Treat that token as a secret because it identifies your relay inbox. <Cite refs={["turn768786search1","turn848982view0"]}/>

Clerk's published materials reviewed here do not specify an authoritative numeric delivery-throughput limit, maximum listener lifetime, guaranteed offline queue duration, or contractual uptime guarantee for this relay. Do not assume it provides durable production-grade message transport.

The URL can be made stable; that is not equivalent to guaranteeing the listener is always connected.

### Option B — ngrok or another tunnel

Clerk's detailed webhook synchronization guide currently uses <Entity value="ngrok" category="software"/> and requires an ngrok account for that particular walkthrough. <Cite refs={["turn660637search0"]}/>

With your local application listening on port 3000, start a tunnel:

```bash
ngrok http 3000
```

If you have configured ngrok's static domain, Clerk documents using:

```bash
ngrok http --url=<YOUR_FORWARDING_URL> 3000
```

Register the resulting public URL plus the local handler path as your Clerk webhook endpoint:

```text
https://your-domain.ngrok-free.app/api/webhooks
```

Unlike the Clerk CLI relay, the tunnel exposes the local HTTP server through a public forwarding address, so the handler path belongs in the registered URL.

Clerk's debugging guide also names localtunnel, Cloudflare Tunnel and Pinggy, as well as the hosted inspection service Beeceptor with optional forwarding. <Cite refs={["turn660637search0","turn902586search3"]}/>

The tunnel must remain active and the registered hostname must remain correct. A changed public URL requires updating the Clerk endpoint unless a stable hostname has been configured.

### Option C — Svix CLI's `listen`

An independent relay also exists:

```bash
svix listen http://localhost:3000/api/webhooks
```

Svix officially documents this command and says it does not require a Svix account. It generates a public URL and proxies incoming requests to the specified local address. <Cite refs={["turn230453search3","turn230453search2"]}/>

You still need to register the generated URL as an endpoint with Clerk.

The Svix CLI has a separate release lifecycle from Clerk's CLI. Svix announced improvements to support multiple simultaneous listener instances in January 2025. <Cite refs={["turn230453search10"]}/>

This is a valid alternative to the Clerk-branded relay, but it should not be confused with automatically subscribing to Clerk events.

---

---

## Turn 5: ChatGPT

_2026-09-19T10:40:28.980Z_

## 6. Webhook handler correctness and reliability

Receiving a request is only part of a successful webhook test. Clerk's guidance requires signature verification and correct HTTP response handling.

### Required handler behaviour

Your webhook endpoint should be accessible without Clerk session authentication, because webhooks originate from an external server. However, it must verify the webhook signature using the endpoint's signing secret. Clerk recommends its framework-specific `verifyWebhook()` helper. <Cite refs={["turn660637search0","turn846405search1"]}/>

For example, a minimal Next.js handler:

<CodeBlock language="typescript" editable={true}>import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  let event

  try {
    event = await verifyWebhook(req)
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  const userId = event.data.id

  switch (event.type) {
    case 'user.created':
      // Upsert user into your database.
      break

    case 'user.updated':
      // Update or upsert the user.
      break

    case 'user.deleted':
      // Delete or soft-delete user if ID is present.
      break
  }

  return new Response('OK', { status: 200 })
}</CodeBlock>

This illustrates the event dispatch, not a complete database implementation.

Be aware that `user.deleted` should be handled as a deleted-object payload, not assumed to contain every field available on a full user record. Clerk's webhook guide exposes `DeletedObjectJSON` and `UserJSON` as distinct types. <Cite refs={["turn644634search0"]}/>

For Express, Clerk's official examples use `express.raw({ type: 'application/json' })` on the webhook route to preserve the request body for signature verification. A global JSON parser placed before the webhook handler can interfere with that requirement. <Cite refs={["turn644634search0","turn644634search1"]}/>

### Delivery, retries and replay

Clerk documents that successful handling must return an HTTP 2xx response. A 4xx or 5xx response, or no response, causes failed delivery to enter Svix's retry process. <Cite refs={["turn660637search0","turn902586search0"]}/>

This creates three test requirements.

**Idempotency:** A retried delivery must not insert the same user twice or cause duplicate side effects. Clerk's official webhook guidance identifies `svix-id` as a suitable deduplication key. <Cite refs={["turn846405search1","turn644634search1"]}/>

**Eventual consistency:** Do not assert that the application database has been updated immediately after `createUser()` returns. Instead, wait for the expected downstream state within a bounded test timeout. Clerk explicitly warns that delivery may be delayed or occasionally fail. <Cite refs={["turn660637search4","turn660637search0"]}/>

**Replay:** Clerk's Dashboard supports replaying individual failed messages, all failed messages over a selected range, or missing messages over a range. This provides a recovery and debugging mechanism, but is not a substitute for running a reliable receiver. <Cite refs={["turn902586search0"]}/>

### Verifying the local pipeline

First, send a direct HTTP POST to a simple local test route to confirm the server is listening. Then use the webhook endpoint's Testing tab in the Clerk Dashboard and select Send Example.

Clerk documents checking the resulting Message Attempts entry for a successful delivery and checking the local server's logs. <Cite refs={["turn660637search3","turn660637search0"]}/>

A Dashboard example establishes that the transport and handler work. It does not establish that your real Backend API operations emit all expected events. Test those separately using actual create, update and delete operations.

---

## 7. Where documented guidance differs from current practice

The following distinctions are particularly important when combining Clerk's documentation, older articles and examples into one testing strategy.

| Area | Documentation or historical guidance | Current documented practice / qualification |
|---|---|---|
| Local webhook delivery | The detailed synchronization guide instructs developers to create an ngrok account and tunnel. | Clerk CLI 2.0 provides `clerk webhooks listen`, so ngrok is no longer a universal prerequisite. <Cite refs={["turn660637search0","turn768786search1"]}/> |
| Testing Token availability | Clerk's April 2024 announcement describes development-only availability. | Current documentation says development and production are supported, subject to production authentication limitations. <Cite refs={["turn5search11","turn940754view0"]}/> |
| Programmatic sign-in | An ordinary sign-in flow appears sufficient in a simple integration example. | Automated traffic can trigger bot detection. Clerk provides Testing Tokens and server-side sign-in helpers for this purpose. <Cite refs={["turn802794search2","turn802794search3"]}/> |
| Playwright setup | Generic Playwright examples may use a function-based `globalSetup`. | Clerk specifically requires project-based setup for its testing integration because environment variables populated by `clerkSetup()` do not propagate from a separate global-setup process. <Cite refs={["turn802794search0"]}/> |
| Rate limits | Older references may mention 100 requests per 10 seconds for Backend API traffic generally. | The current distinction is 100/10s for development and 1,000/10s for production, with endpoint-specific limits. <Cite refs={["turn940754view2","turn8search8"]}/> |
| Development capacity | Pricing pages describe much larger included user allowances. | Development-instance documentation explicitly caps the instance at 100 users. Production pricing allowances do not supersede that cap. <Cite refs={["turn846405search4","turn287395search5"]}/> |
| Webhook synchronization | A simple example inserts a user immediately after receiving `user.created`. | Real delivery is asynchronous and can be retried, so synchronization and tests need idempotency and bounded waiting. <Cite refs={["turn660637search4","turn846405search1"]}/> |

There are also several limits to what can be concluded from public documentation.

I did not find sufficiently reliable evidence to establish that Backend API user creation bypasses the development user cap, that Testing Tokens bypass rate limits, or that the Clerk relay guarantees a particular volume of deliveries or offline retention period. None should be treated as a supported exception.

Likewise, the existence of a CLI relay has been verified from Clerk's published documentation, but I have not run it against a live Clerk instance here. The operational instructions above are documented behaviour, not an independently executed test report.

---

## 8. Recommended end-to-end test design

For an application that needs to verify the complete user lifecycle through Clerk and a local database, the following is a practical implementation based on Clerk's documented capabilities.

<box border radius="xl" padding={3} gap={3}>
  <title size="lg">Test-run lifecycle</title>
  <list connector="solid" marker="number" gap={3}>
    <list-item>
      **Preflight**

      Start the application, configure development keys, start the webhook relay, and confirm its Dashboard endpoint subscribes to all three events.
    </list-item>
    <list-item>
      **Provision**

      Create a uniquely named test user through the Backend API. Record its Clerk user ID immediately.
    </list-item>
    <list-item>
      **Verify creation**

      Wait until the application's database contains the user with the correct Clerk ID and expected attributes.
    </list-item>
    <list-item>
      **Authenticate**

      Use Clerk's testing helpers for authenticated browser state, or obtain a Backend API session token for direct API testing.
    </list-item>
    <list-item>
      **Modify**

      Update the user's name or another selected property through the Backend API. Wait until the corresponding `user.updated` processing is reflected in the database.
    </list-item>
    <list-item>
      **Delete**

      Delete the user through the Backend API. Verify that the application's expected deletion or soft-deletion behaviour occurs.
    </list-item>
    <list-item>
      **Cleanup and recovery**

      Remove any remaining run-owned users individually, respecting Backend API rate limits. Preserve diagnostic logs for failures, and use the Dashboard's webhook replay functionality when necessary.
    </list-item>
  </list>
</box>

For stronger reliability, separate the tests into authentication UI tests, authenticated application tests, and webhook integration tests. They exercise different behaviours and have different failure modes.

Keep the number of concurrently provisioned users comfortably below 100, use shared throttling for API calls, and make webhook assertions against observable application state rather than fixed sleeps.

The native CLI relay is a convenient choice for local development. For unattended CI, make relay startup, stable endpoint configuration, readiness checks and teardown explicit parts of the job. That is an engineering recommendation rather than a Clerk guarantee.

---

## Primary official references

These are the main sources underpinning the document, including Clerk's own documentation and official source repository.

<box border radius="lg" gap={0}>
  {#each [
    {name:"Testing with Clerk",desc:"Testing Tokens, backend sessions and authentication testing.",url:"https://clerk.com/docs/guides/development/testing/overview"},
    {name:"Rate limits",desc:"Frontend and Backend API limits, 429 responses and endpoint exceptions.",url:"https://clerk.com/docs/guides/how-clerk-works/system-limits"},
    {name:"Instances and environments",desc:"Development-instance characteristics and 100-user cap.",url:"https://clerk.com/docs/guides/development/managing-environments"},
    {name:"Test emails and phones",desc:"Fixed OTPs, test identifiers and monthly delivery limits.",url:"https://clerk.com/docs/guides/development/testing/test-emails-and-phones"},
    {name:"Webhook synchronization",desc:"User lifecycle events, ngrok configuration, signatures and delivery tests.",url:"https://clerk.com/docs/guides/development/webhooks/syncing"},
    {name:"Webhook overview",desc:"Asynchronous delivery, Svix, retries and replay.",url:"https://clerk.com/docs/guides/development/webhooks/overview"},
    {name:"Clerk CLI",desc:"Official CLI documentation including webhooks listen and verify.",url:"https://clerk.com/docs/cli"},
    {name:"Clerk CLI official recipes",desc:"Relay token, endpoint URL, forwarded headers and stable inbox configuration.",url:"https://github.com/clerk/skills/blob/main/skills/core/clerk-cli/references/recipes.md"}
  ] as source,i}
    <pressable key={source.url} onClick={() => GenUI.openUrl(source.url)} padding={3} direction="row" align="center" gap={3}>
      <favicon url={source.url} size="28px"/>
      <box flex="1" gap={1}>
        <text weight="medium" color="default">{source.name}</text>
        <caption>{source.desc}</caption>
      </box>
      <icon name="arrow-up-right" color="secondary"/>
    </pressable>
    {#if i<7}<divider color="subtle"/>{/if}
  {/each}
</box>

**Bottom line:** A real Clerk development instance supports this E2E testing architecture. The main constraints are its documented 100-user capacity, API rate limits, bot-detection requirements and asynchronous webhook delivery. The `clerk webhooks listen` relay now provides a first-party local forwarding option, but it still requires a registered Dashboard endpoint and should not be mistaken for a durable webhook-delivery guarantee.
