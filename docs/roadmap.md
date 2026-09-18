# Roadmap

Everything that is not built, is wrong, or is not decided, in one place. Every other document describes what is there and says nothing about what is not, so that a reader can trust what it says. A line goes from here when it is settled, and the document that describes the thing becomes the truth.

## Not built

The order is what it costs to be without each one.

1. **Notices.** Everything below assumes somebody finds out, and nothing in the deployment reaches a person. `docs/notices.md` lists every state that already needs one, and what is not decided about them.
2. **A record of what an admin did.** `retry` leaves a new epoch and `quotas:setForUser` leaves a row; neither says who did it or why, which is the first thing wanted the second time somebody asks. `docs/admin.md` says what an admin can do today.
3. **A support runbook.** What a person is told to do for each row of `docs/failure-modes.md`, written before there is anybody to tell. Until it exists, these are answered case by case, which is right while there are no customers and wrong immediately after.
4. **Putting the project's rules back.** A server that somebody took the firewall off keeps running, and Composery reports that it is unprotected. Attaching it again is one request, and it is the one repair where nothing about the customer's own system is touched.
5. **Restoring management access.** Hetzner's rescue system boots with a key we choose, so the disk can be mounted and the management key written back. It reboots the customer's server, and the customer did not necessarily do anything wrong, so it belongs to an admin or to a schedule, never to a button in the panel.
6. **Replacing an address.** Only after 4 and 5, and only with the identity change stated plainly to whoever asks for it. An address that is gone cannot come back, and a panel that presents a new one as a repair is the damage.
7. **A run against a real Hetzner project.** The harness already does it: given a token, the fake passes every request to Hetzner itself, and the run makes its own firewall, labels what it creates and removes all of it at the end. Nobody has run it yet, so nothing has met the real provider since the harness was built. `docs/setups/hetzner-cloud.md` says how.
8. **A run against a real Clerk instance.** The same shape, and not built: the fake has no way to pass a request on, and a test would need Clerk to hold the accounts it makes. Until then Clerk's contract proves the shape of what we send and accept, and nothing more.
9. **What a new server comes with.** A server is Ubuntu and nothing else today. What Composery installs at creation, so that a customer's first app has something to run on, is decided in principle and the list is open. It is the last thing that can be decided cheaply, because every server made before it keeps what it was given.
10. **Snapshots.** `docs/snapshots.md` holds the analysis, which is the hard part.
11. **SSH host certificates.** Deliberately waiting: a certificate's principal is a name, so it needs the naming scheme that the app feature will define. `docs/ssh-certificates.md` holds the sketch.
12. **An API for clients other than the web app.** The functions are already the API; what is missing is how another client authenticates and what it is allowed to spend. `docs/api.md` says what it would add.

Deferred with their reasons, and not ordered against the rest: apps and the names that reach them, billing, and a production environment separate from this one.

## Wrong today

- **The IPv6 address a customer is shown is a network, not an address.** A Primary IP of that kind is a `/64`, and what a client connects to is one address inside it. Hetzner's own description settles what the field holds; the server settles what answers.
- **A run that was given no token for a real service says nothing about it.** It passes, in the same words as a run that met the provider, so what did not happen is invisible.

## Not decided

- **Whether anything checks Composery's way in to a server on a schedule.** Today only an SSH operation discovers that the management key is gone, so a customer who is not using the panel is not told and, when notices exist, cannot be. Against: a probe costs one SSH connection per server per interval and leaves failed logins in the customer's own auth log. For: the customer is paying for a service whose parts we claim to report. Worth settling with notices, because a notice needs somebody to notice first.
- **Whether customers get notices before release, and through which channel.** `docs/notices.md`.
