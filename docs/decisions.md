# Decisions

Only choices that the code does not explain. Rewrite an entry when it changes; git keeps the history.

Node runs Next.js; Bun only installs, runs scripts, and tests. Next.js on Bun has open runtime issues.

The Content Security Policy is static in next.config.ts. Clerk's generated policy allows scripts from any host unless nonces make every page dynamic.

The header and the page fill the large viewport, so the footer is below the fold and every page scrolls. The scrollbar is then always present, and no `scrollbar-gutter` is reserved. A reserved gutter doubles the scrollbar padding that Clerk's modal adds when it locks scrolling, which moves the page sideways.

`/` is one page for everyone. Signed-in parts render in the browser inside fixed-size regions, so the page stays static. Each server gets its own protected page.

Clerk's prebuilt components do sign-in, sign-up, and the profile inside the app: `<SignIn />` on `/sign-in`, and `<UserButton />`, which opens `<UserProfile />`. They include CAPTCHA, legal consent, the username step after Google sign-up, and reverification, which custom flows must build and maintain. There is no sign-up URL, so `<SignIn />` signs up new users in the same flow and shows no sign-up link. Sign-in is email code or Google, sign-up is public, and usernames are required. Passkeys and MFA need a paid plan.

Clerk's components keep its default theme. `--clerk-*` CSS variables refer to the semantic tokens, and Clerk hard-codes round avatars, so element classes make them square. Clerk's primary color is the neutral primary, not the brand color, because Clerk also uses it for text links and selected items.

Clerk's component code loads from Clerk's CDN, not from the `@clerk/ui` package. The package pins that code but adds hundreds of dependencies, and clerk-js loads from the CDN anyway.

A username is the user's only handle and display name. Clerk stores usernames in lowercase and rejects duplicates that differ only in case.

Convex keeps a users table synced from Clerk, because users will see other users when servers are shared, and billing needs a local user. It is keyed by the Clerk user ID, not tokenIdentifier: the deployment trusts one issuer, and Clerk's webhooks and API know only that ID.

One function syncs a user from Clerk's current state. The Clerk webhook, the client, and hourly reconciliation call it because webhook delivery is not guaranteed. Incomplete profiles disable app access while retaining existing ownership. Confirmed account deletion removes the user and requests durable cleanup of owned infrastructure.

Server ownership is stored on the server, separate from memberships. The owner has no membership and holds every permission. A membership gives another user reads and its checked permissions. Rename, power, member management, SSH management, and deletion have independent permissions; new memberships default to every permission the caller can grant. Delegates can grant only permissions they hold and cannot change or remove a member with broader permissions. Only the owner can transfer ownership, to an existing active member; that membership is removed, and the previous owner receives a membership with every permission. The owner cannot leave; deleting the owner's account requests durable server deletion. An operation completes if its requester had the permission when requesting it, even if that permission is removed while the operation runs. A server that is being deleted accepts no change except its own deletion.

Platform permissions do not restrict direct SSH or filesystem access. Membership removal does not remove native SSH authorizations. SSH entries have no required platform-member association.

An authorized key entry is an occurrence in one file revision, not a key fingerprint: the same key can appear twice with different options, and an edit names the line it changes. Option order is meaningful to OpenSSH, so edits preserve ordered options and every untouched byte. `sshd -T` reports the configuration on disk, not the settings of the running daemon, and `sshd -t` accepts entries that authentication later rejects, so neither validates an entry. An `expiry-time` value without a `Z` suffix uses the server's timezone, and a date without a time means midnight at the start of that date, so new values are written in UTC with `Z` and shown in both forms.

SSH files remain authoritative on the server. Explicit file updates compare observed bytes and metadata, coordinate cooperating writes, replace the file, and verify the result. This is not compare-and-swap against independent editors. An uncertain outcome must not trigger a blind retry or rollback. OpenSSH authentication and sessions retain their native behavior.

Each allocation has a separate backend management key. Its private key is encrypted with an allocation-bound AES-GCM envelope. Cloud-init receives only its public key and a short-lived host key registration token. The server generates its host key locally; authenticated registration pins the public key without trusting the first SSH response. A repeated report can confirm the same key but never replace it; a different key is refused and recorded as a conflict, because it means either a copied bootstrap token or a replaced machine. The report URL must be HTTPS, because the token travels in the request body. Deletion removes the stored secrets after infrastructure cleanup. Host-key registration and provider running state do not establish SSH reachability.

Server names are permanently claimed by one server identity. A server can rename back to its own historical name; other servers cannot claim it, even after deletion. Every claim stays in serverNames, and an old name resolves to the current one. The name follows DNS label rules because it may become a subdomain. The reserved list in convex/servers/reserved_names.ts is deliberately large, and a reserved name is reported as taken.

Rate limits exist to protect the system, not to slow people down: an account may have one server or hundreds. Limits are per user; a global limit would let one attacker block everyone. Expected failures such as a taken name are returned instead of thrown, because a thrown error rolls back the rate limit attempt it counted.

Quotas limit how many servers one user owns and how many the whole deployment holds. Both are counted from the create request until the provider confirms that the infrastructure is absent, and the owner's quota follows an ownership transfer. A missing quota row means a limit of zero, so a deployment creates nothing until an admin sets both. An admin sets quotas today and billing sets the user quota later. The deployment quota stays at or below the Hetzner project's server limit, which the API does not report; Hetzner allows two Primary IPs for each server in that limit and every server uses exactly two, so a separate address quota would only repeat the server quota. Rate limits are separate: they limit how often an account acts, not how much it holds.

Provider API pacing is separate from user admission. Cleanup has reserved worker capacity and API allowance.

The server identity is independent of its allocation backend and provider name. Hetzner resources use an opaque controller identifier, allocation identifier, and resource kind for ownership checks. Human-readable infrastructure names contain no project or deployment name. New allocations resolve the current configuration; existing allocations retain theirs.

A Hetzner create request is recorded as uncertain before it is sent, so a lost response is resolved by looking the resource up, never by sending the request again. Each worker run takes an epoch and a lease; the lease fences database writes, not requests already sent. A result may change its operation's status only while that operation is still the allocation's current one, so a late result cannot finish or block the operation that replaced it. An admin retry takes a new epoch, so an outstanding run cannot undo it. Both Primary IPs are created before the machine and deleted after it, and quotas are released only after Hetzner confirms that every owned resource is absent. Inventory scans record unknown resources as findings for an admin and never delete them. Start, graceful stop, and forced stop are separate operations; a graceful stop never becomes a forced one.

Each backend keeps its own state in its own table, with one row for each allocation, instead of fields or a nested object in `serverAllocations`. The worker changes its lease fields every few seconds, and a change to `serverAllocations` reruns every status query that reads it. A second backend adds its own table and one `backend` value, and changes no existing table. A backend's own error codes stay in its table, for admins; the shared status says only that an allocation is blocked or missing.

Convex function module paths do not accept hyphens, so Convex modules use snake_case with a directory-specific filename lint rule.

Server pages call `auth.protect()` themselves instead of matching routes in the proxy. Clerk deprecates `createRouteMatcher` in favor of checks at the resource.

All corners are sharp. The icon is a sharp square, so the site uses the same shape at every size. The Tailwind theme has no radius tokens.

Two typefaces give two voices. Chakra Petch (`font-brand`, or `font-wordmark` without the size adjustment, which the wordmark's measured metrics need) is for the logo, buttons, labels, and facts such as resource sizes: the places where the product acts or makes a promise. Onest (`font-sans`) is for everything people read, including headings. Chakra Petch alone feels distant to people who have never used a server, and Onest alone does not signal infrastructure. Chakra Petch is loaded at weight 500 only; Onest is variable, with body text at 350 and headings at 550.

Neutral colors are steps of Tailwind's stone palette, not custom values. Each semantic token maps to one step, dark mode uses the mirrored step, and each hover or active state is one step further toward the foreground. Brand states darken the brand color in both themes. Components use only semantic tokens, so a color changes in `globals.css` and nowhere else. The one value between steps is Clerk's dark card, halfway between the page and the surface. Clerk makes muted panels, and the items on them, successively closer to the foreground than the card. In dark mode the muted panels are the surface, and the card must be lighter than the page because shadows do not show. A full step from each would put the card on the surface too.

Every internal link, including the logo, uses one `Link` that fades on hover with the same transition as buttons. An animated underline needs an always-present transparent underline, and Chrome paints it in the selection color when the text is selected.

Components join class names with clsx, not tailwind-merge. A `className` prop adds classes and never overrides the component's own. tailwind-merge does not read the Tailwind theme, so it must be configured by hand for every custom token, and a wrong configuration silently deletes classes, for example `font-body` (a weight) next to `font-sans` (a family).

The theme follows the operating system's light or dark preference. There is no manual toggle, so the server needs no stored preference and the first paint is correct.

Research in docs/research is input, not instruction. `bun run research:import <share-url>` adds a conversation.
