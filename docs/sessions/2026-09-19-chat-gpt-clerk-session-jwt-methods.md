# Clerk Session JWT Methods

Source: https://chatgpt.com/share/6aae6754-5f9c-83ed-9de5-a1e5dc1d9b67

---

## Turn 01: User

_2026-09-19T10:38:00.610Z_

For Clerk (2026, current Backend API version), document every supported way a server-side automated test can obtain a session JWT for a user it created via the Backend API, with no browser and no human. Cover: POST /sign_in_tokens, session creation endpoints, POST /sessions/{id}/tokens, testing tokens, and the +clerk_test email/phone convention with fixed verification codes. For each: exact endpoint and version, whether it works on a development instance, whether the resulting token is accepted by a third-party JWT verifier using the instance's JWKS, its lifetime, and rate limits. Cite Clerk's official docs and API reference for each claim, and state clearly anything that is undocumented or was removed.

---

## Turn 02: ChatGPT

_2026-09-19T10:38:10.671Z_

# Clerk 2026: Obtaining a session JWT in a server-side automated test

**Scope:** Clerk's Backend API version `2026-05-12`, current as of September 19, 2026. The REST API's base URL is `https://api.clerk.com/v1`. Backend requests use a Clerk secret key; the API version and URL path are separate concepts. <Cite refs={["turn997028search0","turn997028search1"]}/>

## Executive summary

Clerk documents a direct, browserless workflow for precisely this use case:

1. Create a user using the Backend API.
2. Create a session for that user.
3. Create a session token using the session ID.
4. Send the resulting JWT as `Authorization: Bearer <session_token>` to your application.

Clerk explicitly recommends this workflow in its testing documentation. The session JWT lasts **60 seconds**, and Clerk recommends obtaining another token through the session-token endpoint when it expires. <Cite refs={["turn997028search5","turn997028search6"]}/>

The important distinction is that a sign-in token, a testing token, and a session token are different credentials. Being called a JWT does not automatically make a credential suitable for your application's session-authentication middleware.

The following examines each mechanism separately, including development-instance support, third-party JWKS verification, expiration, rate limits, and documentation gaps.

---

## Turn 03: ChatGPT

_2026-09-19T10:39:20.863Z_

## 1. The complete Backend API workflow

The current OpenAPI specification confirms that `POST /sessions` is explicitly intended for testing and is unavailable on production instances. It also confirms that `POST /sessions/{session_id}/tokens` returns a session JWT. Neither operation has been removed from version `2026-05-12`. <Cite refs={["turn689063view0","turn689063view1"]}/>

<box border={{size:1,color:"default"}} radius="xl" padding={3} gap={3}>
  <title size="lg">Browserless authentication flow</title>
  <list connector="solid" marker="number" gap={3}>
    <list-item>
      **Create the user**

      `POST https://api.clerk.com/v1/users`

      Save the response's `id`, such as `user_123`.
    </list-item>
    <list-item>
      **Create the active session**

      `POST https://api.clerk.com/v1/sessions`

      Request body:
      ```json
      {"user_id":"user_123"}
      ```

      Save the returned session's `id`, such as `sess_123`.
    </list-item>
    <list-item>
      **Mint a JWT for that session**

      `POST https://api.clerk.com/v1/sessions/sess_123/tokens`

      An empty JSON body is sufficient; `expires_in_seconds` is optional. Read the response's `jwt` property.
    </list-item>
    <list-item>
      **Authenticate the test request**

      ```http
      Authorization: Bearer <JWT>
      ```

      Use a newly generated token if the earlier one has expired.
    </list-item>
  </list>
  <divider color="subtle"/>
  <text color="secondary" size="xs">Sources: Clerk's official testing guide and versioned Backend API specification. <Cite refs={["turn997028search5","turn689063view0","turn907935view1"]}/></text>
</box>

### The exact session-creation contract

`POST /v1/sessions` accepts JSON containing required `user_id` and optional `active_organization_id`. It returns a Session object, not a JWT. It is available on development instances for testing but explicitly not on production instances. <Cite refs={["turn689063view0","turn927179search8"]}/>

### The exact session-token contract

`POST /v1/sessions/{session_id}/tokens` takes the session ID in the path and returns HTTP 200 with an object containing `object: "token"` and `jwt: "<JWT>"`. <Cite refs={["turn907935view1","turn689063view1"]}/>

There is one important qualification to the 60-second default: **the current API supports a configurable JWT lifetime.** Its optional JSON parameter, `expires_in_seconds`, accepts an integer from 30 to 315,360,000 seconds (10 years). That is the documented input range, not a promise that every requested duration will remain valid independently of session status or other constraints. <Cite refs={["turn907935view1","turn997028search5"]}/>

Clerk explicitly documents verifying session JWTs using the instance's public key. The available JWKS endpoints are:

- Backend: `GET https://api.clerk.com/v1/jwks`
- Frontend: `https://<your-frontend-api-domain>/.well-known/jwks.json`

A third-party verifier can authenticate these JWTs using the appropriate public key. It must also check relevant claims, including expiration, issuer, and any configured audience or authorized-party requirements. A matching signature alone is not sufficient for authorization. <Cite refs={["turn997028search8","turn328453search8"]}/>

---

## Turn 04: ChatGPT

_2026-09-19T10:40:48.277Z_

## 2. `POST /sign_in_tokens`: a sign-in ticket, not a session JWT

**Endpoint:** `POST https://api.clerk.com/v1/sign_in_tokens`, Backend API `2026-05-12`.

```json
{
  "user_id": "user_123",
  "expires_in_seconds": 3600
}
```

The response is a `SignInToken` object containing a `token`, not a Session object or a session JWT. Clerk calls sign-in tokens JWTs, but specifies that they are **single-use credentials redeemed through the Frontend API's `ticket` sign-in strategy**. The Backend API accepts a required `user_id`, optional `org_id`, and optional `expires_in_seconds`. The default lifetime is **2,592,000 seconds (30 days)**; the documented minimum is **1 second**, with no maximum specified in the current schema. This lifetime belongs to the *sign-in ticket*, not to the session JWT subsequently obtained. <Cite refs={["turn312870search2","turn824865view2","turn356510view2"]}/>

The documented redemption endpoint is:

```http
POST https://<your-frontend-api-domain>/v1/client/sign_ins
Content-Type: application/x-www-form-urlencoded

strategy=ticket&ticket=<sign-in-token>
```

The versioned Frontend API specification explicitly supports the `ticket` strategy and requires the `ticket` parameter for it. This is a Frontend API authentication flow, even when an automated HTTP client performs the requests without rendering a webpage; the test must handle the Frontend API's client state and then obtain a session JWT. A Backend API secret key alone does not turn a sign-in ticket into a session bearer token. <Cite refs={["turn824865view0","turn312870search2"]}/>

**Development-instance support:** Yes. The endpoint is present in the current specification without the development-only or production-only restriction applied to session creation. Its documented purpose is to sign a user in; Clerk even points production integrations toward sign-in tokens instead of the testing-only session-creation endpoint. <Cite refs={["turn824865view2","turn312870view1"]}/>

**Third-party JWKS verification:** Do not use the sign-in ticket as a session JWT. Clerk does not document a guarantee that the sign-in ticket itself passes signature verification against the instance's *session-token* JWKS, and a successful cryptographic check alone would not give it session-token semantics. The appropriate output for your test is a session JWT obtained **after redemption**, which can be verified against Clerk's JWKS. The sign-in ticket cannot safely be substituted for it. <Cite refs={["turn312870search2","turn312870search4"]}/>

**Rate limits:** Creation consumes the general Backend API allowance: **100 requests per 10 seconds per development instance** or **1,000 per 10 seconds per production instance**, shared with the other ordinary Backend API operations. Ticket redemption additionally encounters Frontend API sign-in limits; Clerk publishes **5 sign-in-creation requests per 10 seconds per IP**. These are shared limits, not a dedicated allowance of 100 sign-in tokens. <Cite refs={["turn824865view4","turn202478view0"]}/>

---

## Turn 05: ChatGPT

_2026-09-19T10:41:22.956Z_

## 3. The other session-creation endpoints: Frontend API sign-in and sign-up

Clerk has two distinct kinds of session creation:

| Endpoint | What it does | Browserless development test? |
|---|---|---|
| Backend `POST https://api.clerk.com/v1/sessions` | Creates an active session for a supplied `user_id` without sign-in. | **Yes; explicitly testing-only.** It is unavailable on production instances. |
| Frontend `POST https://<frontend-domain>/v1/client/sign_ins` | Creates a sign-in attempt; a successful ticket, password, or verification flow can create a session. | **Possible with HTTP requests**, but requires managing Clerk's Frontend API client authentication and completing the enabled authentication requirements. |
| Frontend `POST https://<frontend-domain>/v1/client/sign_ups` | Begins a sign-up flow that can create a session when registration completes. | **Possible with HTTP requests**, but unnecessary for a user already created through the Backend API. |

The Frontend API endpoints above are from Clerk's `2026-05-12` specification, whose route prefix is `/v1/client/`. They are **not** equivalent to the Backend API's `/v1/sessions` route, and they do not accept a Backend API secret key as a shortcut to signing in an arbitrary user. Clerk describes the Frontend API as a form-encoded API for browser or native clients. <Cite refs={["turn312870view1","turn823705view0","turn823705view2","turn803623view2"]}/>

For a development-instance HTTP client, the specification adds a prerequisite often omitted in simplified examples:

```http
POST https://<frontend-domain>/v1/dev_browser
```

This creates a development-browser token. Subsequent development Frontend API requests use it as the `__dev_session` query parameter, including requests to otherwise public endpoints. The client must also preserve the Clerk client state established through `POST /v1/client` or `PUT /v1/client`, as appropriate. **No graphical browser is inherently required to make these HTTP calls, but a plain `POST /sign_ins` with only the Backend API secret key is not the documented complete flow.** <Cite refs={["turn803623view0","turn803623view1"]}/>

Once a Frontend API client is authenticated and owns the session, it can request its session JWT through:

```http
POST https://<frontend-domain>/v1/client/sessions/{session_id}/tokens
```

This returns a `jwt` in the response. Unlike the Backend API endpoint with the similar name, it operates on the **authenticated requesting client**; it cannot be used as a generic server-side minting endpoint for any known session ID. The Frontend API schema does not expose `expires_in_seconds` on this route. Its ordinary session JWT is verifiable using the instance JWKS and has the documented **60-second default lifetime**. <Cite refs={["turn312870search4","turn803623view2","turn709768search4"]}/>

**Rate limits:** Frontend sign-in creation is documented at **5 requests per 10 seconds per IP**, and verification attempts at **3 requests per 10 seconds per IP**. The published rate-limit page does **not** give a separate numeric limit for the Frontend session-token endpoint or every preparatory Client API request, so a precise independent limit for those calls is **undocumented**. The Backend API's 100-per-10-seconds development allowance must not be presented as their Frontend API allowance. <Cite refs={["turn824865view4","turn823705view1"]}/>

---

## Turn 06: ChatGPT

_2026-09-19T10:41:41.514Z_

## 4. JWT templates: supported, but not interchangeable with session JWTs

Clerk also exposes two template-based token endpoints in Backend API `2026-05-12`:

```http
POST https://api.clerk.com/v1/sessions/{session_id}/tokens/{template_name}
POST https://api.clerk.com/v1/jwt_templates
```

The first generates a JWT for an existing session using a named JWT template. The second creates a template; it does not itself issue a user token. Both are documented in the current Backend API specification, so the template-token endpoint has **not been removed**. Development instances can use the session-and-template flow. <Cite refs={["turn0search0","turn875038view2"]}/>

A template has its own configured lifetime, **60 seconds by default**. The token-generation endpoint can override it with `expires_in_seconds`, whose documented range is **30–315,360,000 seconds**. Creating the template and generating its tokens consume the general development Backend API limit of **100 requests per 10 seconds per instance**. <Cite refs={["turn0search0","turn875038view2","turn824865view4"]}/>

**JWKS acceptance depends on the signing key.** Clerk documents that ordinary template JWTs use a Clerk-generated private key and that third-party services can verify them through the instance's JWKS. But a template may explicitly configure `custom_signing_key: true` and supply a separate signing key and algorithm. In that case, do **not** assume the instance JWKS contains the corresponding public key. <Cite refs={["turn875038view0","turn875038view2"]}/>

More importantly, Clerk states that custom JWTs do **not** include session-bound claims such as `sid`, `v`, `pla`, or `fea`. Thus a correctly signed template JWT might pass a generic third-party signature verifier while failing an application that requires a **Clerk session JWT**. For a test of normal session authentication, use the non-template `/sessions/{session_id}/tokens` endpoint; customize Clerk's *session token* if you need additional claims. <Cite refs={["turn0search0","turn0search14"]}/>

---

## Turn 07: ChatGPT

_2026-09-19T10:42:00.491Z_

## 5. `POST /testing_tokens`: bypasses bot detection; does not authenticate a user

**Endpoint:** `POST https://api.clerk.com/v1/testing_tokens`, Backend API `2026-05-12`. No user ID is required. It returns a `TestingToken` object with `token` and `expires_at`. The token is intended for Clerk Frontend API requests as a query parameter:

```http
POST https://<frontend-domain>/v1/client/sign_ins?__clerk_testing_token=<testing-token>
```

This is an **instance-scoped anti-bot bypass**, not proof of a user's identity, not a session, and not a session JWT. A third-party session-JWT verifier using the instance JWKS must **not** accept it as a user session token. You still need to sign in, create a session, and retrieve the actual session JWT. <Cite refs={["turn0search5","turn0search10","turn0search11"]}/>

**Development-instance support:** Yes. Clerk says Testing Tokens work in both development and production instances. It separately cautions that its testing *helpers* do not support code-based authentication in production; that limitation should not be confused with a prohibition on creating Testing Tokens themselves. <Cite refs={["turn0search5","turn0search11"]}/>

**Lifetime:** Clerk describes them as short-lived and exposes an absolute Unix expiration timestamp in `expires_at`. The current API schema shows an example whose timestamps differ by **one hour**, but neither that example nor the testing guide establishes a contractual, fixed one-hour lifetime. Read `expires_at` from each response instead of hard-coding an assumed TTL. <Cite refs={["turn0search5","turn0search11"]}/>

**Rate limits:** Creation falls under the general Backend API development limit of **100 requests per 10 seconds per instance**; no separate testing-token-specific creation limit is listed. Subsequent Frontend API sign-in and verification calls retain their respective Frontend API limits. A Testing Token is not documented as a rate-limit exemption. <Cite refs={["turn824865view4","turn0search5"]}/>

---

## Turn 08: ChatGPT

_2026-09-19T10:42:00.491Z_

## 6. Reserved test emails, fictional phone numbers, and code `424242`

These are **verification fixtures**, not an endpoint or a token type. They let an automated test complete an enabled email- or phone-code authentication flow without a delivered message or a human reading it.

<box border={{size:1,color:"default"}} radius="lg" padding={3} gap={2}>
  <title size="md">Accepted test identifiers</title>
  <table>
    <table-row>
      <table-cell width="28%">Email</table-cell>
      <table-cell>
        `jane+clerk_test@example.com`

        Clerk also uses `testuser+clerk_test_123@example.com` in its test examples for unique addresses.
      </table-cell>
    </table-row>
    <table-row>
      <table-cell>Phone</table-cell>
      <table-cell>
        Fictional North American numbers in the `+1 (XXX) 555-0100` through `555-0199` range, such as `+12015550100`.
      </table-cell>
    </table-row>
    <table-row>
      <table-cell>OTP</table-cell>
      <table-cell>`424242` for the applicable email-code or phone-code verification.</table-cell>
    </table-row>
  </table>
  <caption>There is no literal `+clerk_test` suffix for phone numbers. <Cite refs={["turn494270search0","turn494270search1"]}/></caption>
</box>

**Development support:** Test mode is enabled by default on development instances. It can also be enabled on production instances, although Clerk explicitly discourages that configuration. The fixed code works for test identifiers in test mode; it is not a universal backdoor for arbitrary real email addresses or telephone numbers. <Cite refs={["turn494270search0","turn494270search1"]}/>

For a user already created by the Backend API with the test email or phone identifier, the versioned Frontend API defines this sign-in sequence:

<list marker="number" gap={2}>
  <list-item>
    Establish the development Frontend API client, including `/v1/dev_browser` and its `__dev_session` token.
  </list-item>
  <list-item>
    Call `POST /v1/client/sign_ins` with the user's `identifier`, then obtain the applicable factor identifier from the sign-in response.
  </list-item>
  <list-item>
    Call `POST /v1/client/sign_ins/{sign_in_id}/prepare_first_factor`, specifying `strategy=email_code` and the returned `email_address_id`, or `strategy=phone_code` and `phone_number_id`. Clerk explicitly says that this preparation step is still required even though no test message is sent.
  </list-item>
  <list-item>
    Call `POST /v1/client/sign_ins/{sign_in_id}/attempt_first_factor` with the strategy and `code=424242`. Complete any other authentication requirements configured for the instance.
  </list-item>
  <list-item>
    Once the sign-in is complete, obtain the resulting session ID and call `POST /v1/client/sessions/{session_id}/tokens`, or mint a token for that session using the Backend API endpoint.
  </list-item>
</list>

The Frontend API requests use `application/x-www-form-urlencoded`, and these paths refer to the Frontend API version associated with `2026-05-12`. Their exact contracts are in the versioned Frontend API specification. The **resulting session JWT**, rather than the fixed OTP, is what a third-party JWT verifier can accept using Clerk's instance JWKS. Its ordinary default lifetime is **60 seconds**; Clerk does **not** document a special JWT lifetime created by using a test identifier. Nor does the test-email guide specify a separate guaranteed expiry for the fixed OTP itself. <Cite refs={["turn0search5","turn0search8","turn494270search0","turn25search17"]}/>

**Rate limits and delivery quotas are separate:**

- Frontend sign-in creation: **5 per 10 seconds per IP**; verification attempts: **3 per 10 seconds per IP**. The Backend API user-creation or token-minting calls separately consume the development limit of **100 per 10 seconds per instance**.
- When Clerk delivers messages for a development instance, its published monthly allowance is **20 SMS and 100 emails**. Messages to reserved test numbers and addresses **do not count** toward those monthly allowances; this does not eliminate API request limits.
- Email **verification links** are not the same as fixed-code verification: Clerk says the test-address link is actually emailed and remains valid for **10 minutes**, making it unsuitable for a strict no-email-access, no-human test. Use the email-code strategy instead.

<Cite refs={["turn824865view4","turn494270search0"]}/>

---

## Turn 09: ChatGPT

_2026-09-19T10:42:28.329Z_

## 7. Additional supported routes and important exclusions

The current reference includes further mechanisms that can establish a user session, but they do not offer a simpler, direct `user_id → session JWT` API.

**Password sign-in:** If your Backend API-created user has a password and the instance permits password authentication, `POST https://<frontend-domain>/v1/client/sign_ins` accepts form fields `strategy=password`, `identifier`, and `password`. The specification allows identification and verification in one request. Complete the sign-in, then use the authenticated Frontend client's `POST /v1/client/sessions/{session_id}/tokens`, or the Backend session-token endpoint once you have the session ID. This works on development instances without email delivery or human interaction, subject to the same development-client setup, configured authentication requirements, **5-per-10-seconds-per-IP sign-in limit**, and **60-second default JWT lifetime**. The resulting ordinary session JWT is JWKS-verifiable. <Cite refs={["turn0search5","turn0search8","turn824865view4"]}/>

**Agent Tasks, currently beta:** `POST https://api.clerk.com/v1/agents/tasks` accepts a user identifier or `user_id` and returns a `url`. Visiting that URL creates a session. This is documented for automated tests on development instances; the specification also defines production redirect requirements. The session's default maximum duration is **1,800 seconds (30 minutes)**—**not** the lifetime of a JWT. The endpoint returns an Agent Task and URL, **not** a session JWT or a guaranteed directly usable session ID. The URL's exact expiration and a complete browserless HTTP recipe for extracting a session JWT from the redirect are **not documented**. If a session is established and its ID is obtained, an ordinary JWT from `/sessions/{session_id}/tokens` is JWKS-verifiable and has the usual 60-second default. Agent Task creation uses the general **100-per-10-seconds development Backend API limit**; Clerk lists no separate Agent Task-specific limit. <Cite refs={["turn0search0","turn997028search5","turn824865view4"]}/>

**Actor tokens:** `POST https://api.clerk.com/v1/actor_tokens` can issue a ticket for impersonating a `user_id` using an explicit actor identity. The ticket defaults to **3,600 seconds**, and the resulting impersonation session's maximum duration defaults to **1,800 seconds**. It is not itself a session JWT; redemption and normal session-token retrieval are still required. The eventual ordinary session JWT is verifiable with Clerk's JWKS, but contains impersonation information and therefore is not equivalent to an unimpersonated session for the test user. Its creation uses the general development Backend API rate limit; availability is subject to the feature being enabled. Use this route only when testing impersonation is intentional. <Cite refs={["turn479368search0","turn824865view4"]}/>

**Session refresh is not initial session creation:** `POST https://api.clerk.com/v1/sessions/{session_id}/refresh` remains in `2026-05-12`. Despite its description saying that it creates a new session token, its request requires an existing `expired_token`, a `refresh_token` obtained through the Frontend API handshake, and `request_origin`. It therefore cannot bootstrap a JWT from only a newly created user's ID and a secret key. The refresh operation falls under the general Backend API rate limit; Clerk's current reference does not document a separate refresh-specific numeric limit. <Cite refs={["turn0search0","turn824865view4"]}/>

An M2M token, client token, testing token, sign-in ticket, or actor ticket must likewise not be substituted for a user session JWT simply because it is a credential or, in some cases, a JWT. The issuer's intended token type and your verifier's claim checks matter as well as the signature. <Cite refs={["turn0search5","turn0search8","turn479368search0"]}/>

---

## Turn 10: ChatGPT

_2026-09-19T10:42:28.329Z_

## 8. What is undocumented, deprecated, or removed?

These distinctions are important when comparing older examples with the current reference.

| Question | Finding |
|---|---|
| Was Backend `POST /v1/sessions` removed? | **No.** It is present in `2026-05-12`, explicitly restricted to testing/development instances. |
| Was Backend `POST /v1/sessions/{session_id}/tokens` removed? | **No.** It is present, returns `jwt`, and documents `expires_in_seconds`. |
| Is `POST /v1/users/{user_id}/sessions` a current alternative? | **Not documented in the current Backend API.** Do not assume such a route exists from its plausible-looking name. |
| Can `POST /sign_in_tokens` return a session JWT directly? | **No documented support.** It returns a single-use sign-in ticket that must be redeemed. |
| Can a testing token be exchanged directly for a user's JWT? | **No documented support.** It bypasses bot detection, not authentication. |
| Is the sign-in ticket's signature guaranteed verifiable against the instance's session JWKS? | **Undocumented.** Do not depend on it, regardless of the ticket's JWT format. |
| Is a fixed Testing Token TTL guaranteed? | **Undocumented.** Use its returned `expires_at`; the one-hour API example is not a lifetime contract. |
| Is there a separate numeric rate limit for every Frontend API step? | **Undocumented.** Clerk publishes numbers for sign-in creation and verification attempts, not every Frontend session-token or client-initialization call. |

These findings follow the current [versioned Backend API reference](https://clerk.com/docs/reference/backend-api/2026-05-12), [Frontend API specification](https://github.com/clerk/openapi-specs/blob/main/fapi/2026-05-12.yml), and [rate-limit documentation](https://clerk.com/docs/guides/how-clerk-works/system-limits). <Cite refs={["turn479368search0","turn824865view4"]}/>

There is a narrower **deprecation**, not a removal: the `ticket` field on Frontend `POST /v1/client/sign_ins/{sign_in_id}/attempt_first_factor` is marked deprecated in the `2026-05-12` specification. The supported ticket route remains `POST /v1/client/sign_ins` with `strategy=ticket&ticket=...`. Do not implement a new sign-in-token flow around the deprecated field. <Cite refs={["turn0search0","turn0search5"]}/>

Clerk's `2026-05-12` upgrade also removed certain metadata fields from unrelated user and organization update endpoints. Its versioning guide does **not** identify removal of the session-creation, session-token, sign-in-token, or testing-token operations discussed here. <Cite refs={["turn0search1","turn479368search0"]}/>

## Practical conclusion

For the exact requirement—**a server-side test, a Backend API-created user, no browser, no human, and an ordinary JWT accepted by a third-party verifier using Clerk's JWKS**—the fully documented, direct path is:

```text
POST /v1/users
      ↓ user_id
POST /v1/sessions
      ↓ session_id
POST /v1/sessions/{session_id}/tokens
      ↓ jwt
Authorization: Bearer <jwt>
```

Use a development instance, explicitly select API version `2026-05-12`, and have the third-party verifier check the instance's JWKS alongside expiration, issuer, and relevant application claims. Budget the three Backend API calls against the **shared 100-requests-per-10-seconds development limit**. The JWT defaults to **60 seconds**, but the current token endpoint documents an optional lifetime override; alternatively, mint a fresh JWT for the same session when needed. The `+clerk_test` convention, Testing Tokens, and sign-in tickets are useful for exercising authentication flows, but none is required for this direct Backend API testing path. <Cite refs={["turn997028search5","turn479368search0","turn824865view4","turn0search8"]}/>
