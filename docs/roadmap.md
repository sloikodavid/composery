# Roadmap

Everything that is not built, is wrong, or is not decided, in one place. Every other document describes what is there and says nothing about what is not, so that a reader can trust what it says. A line goes from here when it is settled, and the document that describes the thing becomes the truth.

## Not built

The order is what it costs to be without each one.

1. **A panel that shows any of this.** Each part of a server, what a member can do with it, why it is stuck and the addresses it answers on are all in `getStatus`, and nothing in `src/` reads them. Everything below is worth less until somebody can see the first one.
2. **Notices.** Everything below assumes somebody finds out, and nothing in the deployment reaches a person. `docs/notices.md` lists every state that already needs one, and what is not decided about them.
3. **A record of what an admin did.** `retry` leaves a new epoch and `quotas:setForUser` leaves a row; neither says who did it or why, which is the first thing wanted the second time somebody asks. `docs/admin.md` says what an admin can do today.
4. **A support runbook.** What a person is told to do for each row of `docs/failure-modes.md`, written before there is anybody to tell. Until it exists, these are answered case by case, which is right while there are no customers and wrong immediately after.
5. **Putting the project's rules back.** A server that somebody took the firewall off keeps running, and Composery reports that it is unprotected. Attaching it again is one request, and it is the one repair where nothing about the customer's own system is touched.
6. **Restoring management access.** Hetzner's rescue system boots with a key we choose, so the disk can be mounted and the management key written back. It reboots the customer's server, and the customer did not necessarily do anything wrong, so it belongs to an admin or to a schedule, never to a button in the panel.
7. **Replacing an address.** Only after 5 and 6, and only with the identity change stated plainly to whoever asks for it. An address that is gone cannot come back, and a panel that presents a new one as a repair is the damage.
8. **A run against a real Hetzner project.** The harness already does it: given a token, the fake passes every request to Hetzner itself, and the run makes its own firewall, labels what it creates and removes all of it at the end. Nobody has run it yet, so nothing has met the real provider since the harness was built. `docs/setups/hetzner-cloud.md` says how.
9. **A run against a real Clerk instance.** The same shape, and not built: the fake has no way to pass a request on, and a test would need Clerk to hold the accounts it makes. Until then Clerk's contract proves the shape of what we send and accept, and nothing more.
10. **What a new server comes with.** A server is Ubuntu and nothing else today. What Composery installs at creation, so that a customer's first app has something to run on, is decided in principle and the list is open. It is the last thing that can be decided cheaply, because every server made before it keeps what it was given.
11. **Snapshots.** `docs/snapshots.md` holds the analysis, which is the hard part.
12. **SSH host certificates.** Deliberately waiting: a certificate's principal is a name, so it needs the naming scheme that the app feature will define. `docs/ssh-certificates.md` holds the sketch.
13. **An API for clients other than the web app.** The functions are already the API; what is missing is how another client authenticates and what it is allowed to spend. `docs/api.md` says what it would add.

Also not built, and not ordered against the rest:

- **Pacing by what Hetzner says.** Every reply carries `ratelimit-limit`, `ratelimit-remaining` and `ratelimit-reset`, read from a real reply on 19 September: the limit is 3600 an hour and the reset is a unix second. The deployment paces itself by a constant under that instead, which can only ever be wrong in one of two directions. The constant is deliberately low, so this buys headroom rather than correctness.
- **Suspending an account, and seeing what the deployment is doing.** An admin can take quota away, which stops new servers and leaves the running ones; nothing stops abuse in progress, and nothing shows the deployment's own rates and failures.
- **A run of the suite on macOS.** It has never happened. The code is written for it and CI runs Linux only, so the claim rests on reasoning, which is the weakest kind of evidence this repository accepts.
- **The flow that gives an agent access to a server.** Deferred on purpose: designing it beside everything else would have made hasty decisions.
- Apps and the names that reach them, billing, and a production environment separate from this one, each deferred with its reasons.

## Wrong today

Nothing known.

## Not decided

- **Whether customers get notices before release, and through which channel.** `docs/notices.md`.
- **Whether Composery ever writes a server's SSH configuration.** It only writes authorized keys today, and reads the configuration to know which files apply. One wrong line there locks out every user, including us, which is the whole argument; the counter-argument is that a customer who forbade root login cannot be helped without it.
- **Whether a person here is ever public.** Sharing is by email address, which answers nothing about who exists. Names, profiles and search all follow from one question nobody has answered: whether this is a place people are seen, or a tool people use.
