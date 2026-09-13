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

4. Set the Clerk secret key on the Convex deployment:

   ```sh
   bunx convex env set CLERK_SECRET_KEY <secret-key>
   ```

5. In the Clerk Dashboard, open **Webhooks** and add an endpoint. The Clerk CLI and API cannot create endpoints.
   - Endpoint URL: `https://<deployment>.convex.site/webhooks/clerk`
   - Events: `user.created`, `user.updated`, `user.deleted`

   Copy the endpoint's signing secret to the Convex deployment:

   ```sh
   bunx convex env set CLERK_WEBHOOK_SIGNING_SECRET <signing-secret>
   ```

Convex refuses to push functions until all three variables in `.env.convex.example` are set.
