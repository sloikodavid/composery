# Roadmap

What is not built, in one place. Every other document describes what is there, and says nothing about what is not, so that a reader can trust what it says. A line goes from here when the thing is built, and the document that describes it becomes the truth.

The order is what it costs to be without each one.

1. **Notices.** Everything below assumes somebody finds out, and nothing in the deployment reaches a person. `docs/notices.md` lists every state that already needs one, and what is not decided about them.
2. **A record of what an admin did.** `retry` leaves a new epoch and `quotas:setForUser` leaves a row; neither says who did it or why, which is the first thing wanted the second time somebody asks. `docs/admin.md` says what an admin can do today.
3. **A support runbook.** What a person is told to do for each row of `docs/failure-modes.md`, written before there is anybody to tell. Until it exists, these are answered case by case, which is right while there are no customers and wrong immediately after.
4. **Putting the project's rules back.** A server that somebody took the firewall off keeps running, and Composery reports that it is unprotected. Attaching it again is one request, and it is the one repair where nothing about the customer's own system is touched.
5. **Restoring management access.** Hetzner's rescue system boots with a key we choose, so the disk can be mounted and the management key written back. It reboots the customer's server, and the customer did not necessarily do anything wrong, so it belongs to an admin or to a schedule, never to a button in the panel.
6. **Replacing an address.** Only after 4 and 5, and only with the identity change stated plainly to whoever asks for it. An address that is gone cannot come back, and a panel that presents a new one as a repair is the damage.
7. **A run against a real Hetzner project.** The harness already does it: given a token in `.env.hetzner`, the fake passes every request to Hetzner itself, and the run makes its own firewall, labels what it creates and removes all of it at the end. Nobody has run it yet, so nothing here has met the real provider since the harness was built. `docs/setups/hetzner-cloud.md` says how.
8. **A run against a real Clerk instance.** The same shape, and not built: the fake has no way to pass a request on, and a test would need Clerk to hold the accounts it makes. Until then Clerk's contract proves the shape of what we send and accept, and nothing more.
9. **Snapshots.** `docs/snapshots.md` holds the analysis, which is the hard part.
10. **SSH host certificates.** Deliberately waiting: a certificate's principal is a name, so it needs the naming scheme that the app feature will define. `docs/ssh-certificates.md` holds the sketch.
11. **An API for clients other than the web app.** The functions are already the API; what is missing is how another client authenticates and what it is allowed to spend. `docs/api.md` says what it would add.
