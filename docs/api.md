# API

Every public Convex function (`query`, `mutation`, `action`) is the application API. The web app is its first client. A future public API documents and exposes these same functions to other clients; it adds authentication for those clients, not a second set of operations. Internal functions (`internalQuery`, `internalMutation`, `internalAction`) are not part of it.

## Rules for public functions

- **Authorize inside the function.** Use `requireUser`, `requireServerAccess`, and `requireServerOwner`. Never trust an ID, an address, or a permission that the client sends.
- **Validate the contract.** Every function has argument and return validators. The return validator is the documented response.
- **Report failures with a code.** `convex/errors.ts` holds every code and its message, so one condition has one code and one wording. A function returns `failure` (`{ ok: false, code, field, message }`) when it has already counted a rate limit attempt, because a thrown error would roll that attempt back. Otherwise it throws `toConvexError(code)`, whose data is `{ code, message }`. A client handles both by `code`. Internal state, such as a backend's own error codes, stays out of public results.
- **Make repeatable requests safe.** A request that starts work outside Convex takes a client-generated `requestId`. Repeating the same request returns the same operation instead of starting new work.
- **Bound lists.** Lists paginate with `paginationOpts`, and `toBoundedPagination` limits a page to `maxPageSize` items.
- **Return only what a client needs.** A return validator names each field. A stored document is not a response.
- **Name by resource.** The module path names the resource and the function names the action: `api.servers.lifecycle.create`, `api.servers.memberships.add`.

## Changes

These changes keep existing clients working: a new function, a new optional argument, a new return field, and a new code.

These changes break clients: moving or renaming a function, removing or renaming an argument, a return field, or a code, and changing what a value means. Until the public API is released, make them and update the web app in the same change. After release, add a new function next to the old one, and remove the old one only when no client uses it.

## HTTP routes

`convex/http.ts` holds routes for callers that cannot use a Convex client. `/webhooks/<system>` receives events from another system. Other paths name the resource they act on, such as `/ssh/host-keys`. A route authenticates its caller itself and does no work before it has checked the request.

## Repeatable requests, in practice

A `requestId` is one of three ways a repeat is made safe, and the other two are already in use where they fit better. `requestDelete` needs none: a deletion is a flag on the allocation, so asking twice asks for the state it is already in. `ssh.keys.add`, `update` and `remove` need none either: an edit names the revision of the file it was planned against, and the second attempt cannot apply because the first one changed the file. `ssh.bootstrap.renew` is the third kind: asking again inside the window hands back the same program rather than minting one that would invalidate it.

What matters is that a repeat cannot do the work twice, not which of the three does it. A function that starts outside work and has none of them is a defect.

## Not built yet

- Secrets for clients other than the web app, such as API tokens that `requireUser` accepts. Scoped ones: to one server, to what may be done with it, and to what it may spend. A server holding a credential to act on itself is one of the shapes wanted, and it must not be able to read anything about another server.
- Rate limits for each such token.
- The choice between calling Convex functions directly and a versioned HTTP layer over the same helpers.
- Public documentation of each function.
- A client cannot read a quota before it is refused, so it learns its room by failing.
- An operation that has been superseded cannot be read by its own id, so a client holding one from `requestPower` cannot learn how it ended.
- Sharing refuses an address no account holds, and nothing records a grant for somebody who has not signed up yet.
- Servers a caller owns and servers shared with them are two paginated lists, so a client that wants everything it can see pages both and merges them itself.
