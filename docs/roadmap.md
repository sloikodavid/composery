# Roadmap

Everything that is not built, is wrong, or is not decided, in one place. Every other document describes what is there and says nothing about what is not, so that a reader can trust what it says. A line goes from here when it is settled, and the document that describes the thing becomes the truth.

Nothing here is ranked against everything else, because that order was invented and kept being wrong. Where one thing genuinely needs another first, the line says so.

## Not built

- **A panel that shows any of this.** Each part of a server, what a member can do with it, why it is stuck and the address it answers on are all in `getStatus`, and nothing in `src/` reads them.
- **Notices.** Nothing in the deployment reaches a person. Decided: customers get them before release, by email, with the panel saying the same thing. `docs/notices.md` lists every state that already needs one.
- **Who an address found.** Sharing takes an email address and answers with an account or a refusal. It cannot show a name, because no name is stored: Clerk's first and last names are optional and nothing reads them. Wanted before a panel asks somebody to confirm who they are about to give a server to.
- **A record of what an admin did.** There is no admin account: an admin is a person holding the deployment's key, working through the Convex dashboard or CLI, so the deployment cannot know who ran anything. A record therefore needs each operation to take who and why as arguments, which is a change of shape rather than a field.
- **A support runbook.** What a person is told to do for each row of `docs/failure-modes.md`. Worth writing once the operations it would name exist.
- **Restoring management access.** Hetzner's rescue system boots with a key we choose, so the disk can be mounted and the management key written back. It reboots the customer's server, so it belongs to a person who decided to do it, never to a schedule that decides by itself.
- **Replacing an address.** Only after restoring management access, and only with the identity change stated plainly to whoever asks for it. An address that is gone cannot come back, and a panel that presents a new one as a repair is the damage.
- **A run against a real Clerk instance, actually run.** The harness does it: given the credentials, accounts are made at Clerk and signed in with tokens Clerk signed. Nobody has run it, because it needs a development instance of its own. `docs/setups/clerk.md` says what that instance needs.
- **Pacing by what a provider says.** Every Hetzner reply carries `ratelimit-limit`, `ratelimit-remaining` and `ratelimit-reset`, read from a real reply on 19 September: the limit is 3600 an hour and the reset is a unix second. The deployment paces itself by a constant under that instead, which can only ever be wrong in one of two directions.
- **Ports.** Exposing one port of a server to the internet, from the panel and through the API alike. This is what decides whether a server ever has a name, so host certificates wait on it.
- **What a new server comes with.** A server is Ubuntu and nothing else. What Composery installs at creation is decided in principle and the list is open; how that list is defined and kept current is the part worth designing.
- **Suspending an account, and seeing what the deployment is doing.** Taking quota away stops new servers and leaves the running ones; nothing stops abuse in progress, and nothing shows the deployment's own rates and failures.
- **A run of the suite on macOS and Windows.** CI runs Ubuntu only. What differs between platforms is our own code and its toolchain rather than Docker, so the parts that need no container are worth running everywhere first.
- **The flow that gives an agent access to a server.** Deferred on purpose: designing it beside everything else would have made hasty decisions.
- **An API for clients other than the web app.** The functions are already the API; what is missing is how another client authenticates and what it may spend. Scoped credentials are wanted, including one a server could hold to act on itself. `docs/api.md` says what exists.
- **Snapshots.** `docs/snapshots.md` holds the analysis, which is the hard part.
- **SSH host certificates.** Waits on ports, because a certificate's principal is a name and ports decide whether there is one. `docs/ssh-certificates.md` holds the sketch.
- Billing, and a production environment separate from this one.

## Wrong today

Nothing known.

## Not decided

Nothing known.
