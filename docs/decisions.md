# Decisions

Only choices that the code does not explain. Rewrite an entry when it changes; git keeps the history.

Node runs Next.js; Bun only installs, runs scripts, and tests. Next.js on Bun has open runtime issues.

The Content Security Policy is static in next.config.ts. Clerk's generated policy allows scripts from any host unless nonces make every page dynamic.

`/` is one page for everyone. Signed-in parts render in the browser inside fixed-size regions, so the page stays static. Each server gets its own protected page.

Clerk's hosted Account Portal does sign-in, sign-up, and the profile; the app has no Clerk UI. Sign-in is email code or Google, sign-up is public, and usernames are required. Passkeys and MFA need a paid plan.

A username is the user's only handle and display name. Clerk stores usernames in lowercase and rejects duplicates that differ only in case.

Convex keeps a users table synced from Clerk, because users will see other users when servers are shared, and billing needs a local user. It is keyed by the Clerk user ID, not tokenIdentifier: the deployment trusts one issuer, and Clerk's webhooks and API know only that ID.

One function syncs a user from Clerk's current state, so webhook order does not matter. The Clerk webhook, the client (when the signed-in user has no row), and an hourly reconciliation call it, because Clerk does not guarantee delivery. A user without a required field has no row, and neither has a deleted user, so a still-valid session token finds nothing.

Server access is one members table with a role: owner, write, or read. The owner is a member, so access is checked in one place, and transferring ownership swaps two roles. Server members can reach every app on the server. The owner cannot leave; deleting the owner's account deletes the server.

Server slugs are globally unique and never reused: every slug a server has had stays in serverSlugs, and an old slug redirects to the current one. Slugs follow DNS label rules because they may become subdomains. The reserved list in convex/slugs.ts is deliberately large, and a reserved slug is reported as taken.

Rate limits exist to protect the system, not to slow people down: an account may have one server or hundreds. Limits are per user; a global limit would let one attacker block everyone. Expected failures such as a taken slug are returned instead of thrown, because a thrown error rolls back the rate limit attempt it counted.

Server pages call `auth.protect()` themselves instead of matching routes in the proxy. Clerk deprecates `createRouteMatcher` in favor of checks at the resource.

Research in docs/research is input, not instruction. `bun run research:import <share-url>` adds a conversation.
