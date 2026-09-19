# Clerk

Do these steps once for each Clerk instance (development and production) and its Convex deployment.

1. Link the Clerk application and pull its keys into `.env.local`:

   ```sh
   bunx clerk link
   bunx clerk env pull
   ```

2. Copy the Frontend API URL from the Clerk Dashboard, **API keys** page. Set it in `.env.local` as `CLERK_FRONTEND_API_URL`, and on the Convex deployment:

   ```sh
   bunx convex env set CLERK_FRONTEND_API_URL <frontend-api-url>
   ```

3. Put the session token audience that Convex requires on the Clerk instance. This is what **Activate Convex integration** in the Clerk Dashboard does:

   ```sh
   bunx clerk config patch --json '{"session":{"claims":{"aud":"convex"}}}'
   ```

4. Point the instance's sign-in and sign-up paths to the app's sign-in page, which also signs up new users, so links from Clerk open the app instead of the Account Portal:

   ```sh
   bunx clerk config patch --json '{"paths":{"sign_in":"/sign-in","sign_up":"/sign-in"}}'
   ```

5. Set the Clerk secret key on the Convex deployment:

   ```sh
   bunx convex env set CLERK_SECRET_KEY <secret-key>
   ```

6. In the Clerk Dashboard, open **Webhooks** and add an endpoint. The Clerk CLI and API cannot create endpoints.
   - Endpoint URL: `https://<deployment>.convex.site/webhooks/clerk`
   - Events: `user.created`, `user.updated`, `user.deleted`

   Copy the endpoint's signing secret to the Convex deployment:

   ```sh
   bunx convex env set CLERK_WEBHOOK_SIGNING_SECRET <signing-secret>
   ```

Convex refuses to push functions until all three variables in `.env.convex.example` are set.

## An instance for the tests

Tests reach a fake by default and can reach Clerk itself for one run. That run makes accounts and deletes them, and a development instance holds a hundred, so it needs an instance nothing else uses.

1. Create a second Clerk application, development instance, used by nothing that anybody depends on.
2. Put the `aud` claim on it, exactly as step 3 above does for the instance the app uses. It is the one setting that has to match: the deployment accepts a token only if it says `convex`, and a run signs in with tokens Clerk itself signed rather than tokens of its own.

   ```sh
   bunx clerk config patch --json '{"session":{"claims":{"aud":"convex"}}}'
   ```

   The CLI acts on whichever instance is linked, so link that application first and link back afterwards.
3. Copy `.env.test.example` to `.env.test`, and fill in `CLERK_SECRET_KEY` and `CLERK_FRONTEND_API_URL` from that application's **API keys** page.
4. Run `CLERK_MODE=real bun test tests/convex/clerk.test.ts`.

Nothing else has to match. A run makes its accounts through the Backend API and signs in by asking Clerk for a session and a token for it, which Clerk documents for testing and allows on a development instance only, so sign-in methods, bot protection and the Account Portal paths do not come into it.

What such a run does **not** cover is Clerk delivering a webhook: those reach a deployment over the internet, and a test runs a backend on this machine. Tests of the webhook route sign the body themselves and stay with the fake, which proves what the route does with an event and not that Clerk sent one.
