# Decisions

Only choices that the code does not explain. Rewrite an entry when it changes; git keeps the history.

Node runs Next.js; Bun only installs, runs scripts, and tests. Next.js on Bun has open runtime issues.

The Content Security Policy is static in next.config.ts. Clerk's generated policy allows scripts from any host unless nonces make every page dynamic.

`/` is one page for everyone. Signed-in parts render in the browser inside fixed-size regions, so the page stays static. Each server gets its own protected page.

Clerk's hosted Account Portal does sign-in, sign-up, and the profile; the app has no Clerk UI. Sign-in is email code or Google, sign-up is public, and usernames are required. Passkeys and MFA need a paid plan.

A username is the user's only handle and display name. Clerk stores usernames in lowercase and rejects duplicates that differ only in case.

Convex keeps a users table synced from Clerk, because users will see other users when servers are shared, and billing needs a local user. It is keyed by the Clerk user ID, not tokenIdentifier: the deployment trusts one issuer, and Clerk's webhooks and API know only that ID.

One function syncs a user from Clerk's current state. The Clerk webhook, the client, and hourly reconciliation call it because webhook delivery is not guaranteed. Incomplete profiles disable app access while retaining existing ownership. Confirmed account deletion removes the user and requests durable cleanup of owned infrastructure.

Server access is one members table with a role: owner, write, or read. The owner is a member, so access is checked in one place, and transferring ownership swaps two roles. Server members can reach every app on the server. The owner cannot leave; deleting the owner's account deletes the server.

Read and write describe control-panel permissions, not SSH or filesystem permissions. Owners will have root access. The credential model for added server members remains open and can also grant root. App-only grants will not grant server membership.

Server names are permanently claimed by one server identity. A server can rename back to its own historical name; other servers cannot claim it, even after deletion. Every claim stays in serverNames, and an old name resolves to the current one. The name follows DNS label rules because it may become a subdomain. The reserved list in convex/names.ts is deliberately large, and a reserved name is reported as taken.

The code and product copy use the same term, name. There is no separate display name.

Rate limits exist to protect the system, not to slow people down: an account may have one server or hundreds. Limits are per user; a global limit would let one attacker block everyone. Expected failures such as a taken name are returned instead of thrown, because a thrown error rolls back the rate limit attempt it counted.

Provider API pacing is separate from user admission. Cleanup has reserved worker capacity and API allowance. Operator grants authorize billable allocations before billing exists. Capacity is released only after owned provider resources are confirmed absent.

The server identity is independent of its allocation backend and provider name. Hetzner resources use an opaque controller identifier, allocation identifier, and resource kind for ownership checks. Human-readable infrastructure names contain no project or deployment name. New allocations resolve the current configuration; existing allocations retain theirs.

Convex function module paths do not accept hyphens, so Convex modules use snake_case with a directory-specific filename lint rule.

Server pages call `auth.protect()` themselves instead of matching routes in the proxy. Clerk deprecates `createRouteMatcher` in favor of checks at the resource.

Research in docs/research is input, not instruction. `bun run research:import <share-url>` adds a conversation.
