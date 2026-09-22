# Roadmap

Everything that is not built, is wrong, or is not decided, in one place. Every other document describes what is there and says nothing about what is not, so that a reader can trust what it says. A line goes from here when it is settled, and the document that describes the thing becomes the truth.

Nothing here is ranked against everything else, because that order was invented and kept being wrong. Where one thing genuinely needs another first, the line says so.

## Not built

- **A panel that shows any of this.** Each part of a server, what a member can do with it, why it is stuck and the address it answers on are all in `getStatus`, and nothing in `src/` reads them.
- **Notices.** Nothing in the deployment reaches a person. Decided: customers get them before release, by email, with the panel saying the same thing. `docs/notices.md` lists every state that already needs one.
- **Who an address found.** Sharing takes an email address and answers with an account or a refusal. It cannot show a name, because no name is stored: Clerk's first and last names are optional and nothing reads them. Wanted before a panel asks somebody to confirm who they are about to give a server to.
- **A record of what an admin did.** There is no admin account: an admin is a person holding the deployment's key, working through the Convex dashboard or CLI, so the deployment cannot know who ran anything. A record therefore needs each operation to take who and why as arguments, which is a change of shape rather than a field.
- **A support runbook.** What a person is told to do for each row of `docs/failure-modes.md`. Worth writing once the operations it would name exist.
- **Ports.** Exposing one port of a server to the internet, from the panel and through the API alike. A port gets a name from the same namespace a server's name comes from; who routes that name is below, under what is not decided.
- **What a new server comes with.** A server is Ubuntu and nothing else. What Composery installs at creation is decided in principle and the list is open; how that list is defined and kept current is the part worth designing.
- **Suspending an account, and seeing what the deployment is doing.** Taking quota away stops new servers and leaves the running ones; nothing stops abuse in progress, and nothing shows the deployment's own rates and failures.
- **A run of the suite on macOS and Windows.** CI runs Ubuntu only. What differs between platforms is our own code and its toolchain rather than Docker, so the parts that need no container are worth running everywhere first.
- **The flow that gives an agent access to a server.** Deferred on purpose: designing it beside everything else would have made hasty decisions.
- **An API for clients other than the web app.** The functions are already the API; what is missing is how another client authenticates and what it may spend. Scoped credentials are wanted, including one a server could hold to act on itself. `docs/api.md` says what exists.
- **Snapshots.** `docs/snapshots.md` holds the analysis, which is the hard part.
- **SSH host certificates.** A principal is a name and a server now has one, so what is left is an authority to hold and rotate. `docs/ssh-certificates.md` holds the sketch.
- Billing, and a production environment separate from this one.

## Behind what a vendor publishes

Each of these is a version somebody chose once and nobody has moved since. Moving one is deliberate work, because the run that proves it is the whole suite.

- **The Convex backend the tests run** is pinned a week behind what Convex has released. `harness/pins.ts` holds it, with a digest for each platform that has to move with it.
- **Six dependencies have newer releases**, one of them a major: `@convex-dev/rate-limiter` 0.3 to 0.4, which shapes every limit this deployment keeps. The others are `@clerk/backend`, `@clerk/nextjs`, `@convex-dev/workpool`, `@biomejs/biome` and `@types/node`.

## Wrong today

Nothing known.

## Not decided

- **Who routes a port's name.** DNS carries no port, so a name for one exposed port is reached by Host or SNI, and the thing that routes it sits either on the customer's server or at Composery's edge. On their server it is state the customer can remove, so it degrades as the SSH features do, and they hold their own certificate for a name in our domain. At our edge nothing degrades and one `*.composery.cloud` certificate covers it, and Composery then carries the traffic and serves what the customer put there. The second is not only a routing choice: it decides whether Composery points at what somebody hosts or hosts it. `docs/decisions.md` holds the two kinds of name that frame it.
