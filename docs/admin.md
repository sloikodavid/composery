# Admin

An admin is a person on the Composery team, working through the Convex dashboard or the Convex CLI against a deployment. There is no admin interface and no admin account: the deployment's own admin key is the authority, which is why every operation here is an internal function rather than a public one.

Several documents say that an admin decides something. This says what an admin can actually do, so that "an admin decides" is a plan rather than a shrug.

## What an admin can do today

Every one of these is `convex run <path> '<arguments>'`, or the equivalent in the dashboard.

| Operation | What it is for |
|---|---|
| `quotas:setForUser` | give one user room for more servers, or take it away |
| `quotas:setForDeployment` | cap the whole deployment. Zero stops new servers and leaves existing ones running |
| `allocations/hetzner_cloud/worker_state:retry` | take a blocked allocation and try again now, with a new epoch so an outstanding run cannot undo it. Takes `confirmedAbsent` when a resource was uncertain and the admin has established at the provider that it does not exist |
| `allocations/hetzner_cloud/inventory:run` | scan the provider for resources Composery does not own, and record them as findings |
| `ssh/bootstrap:renewForAdmin` | mint Composery's way back into one server and return the program that installs it. What gets that program onto a server nobody can reach is the case's own business; this is only so that minting, sealing and the window are never hand-rolled |
| `ssh/secrets:reEncrypt` | encrypt every stored secret again with the key that encrypts now, and report which keys are still named |
| `convex data <table>` | read what the deployment holds |
| `convex env set` / `remove` | change a deployment's settings, including the encryption keys |

An allocation that is not moving says so in `serverAllocations`, with the code and the day it stopped; what the provider itself said is in `hetznerCloudAllocations`, as `error` and `hetznerErrorCode`.

## What an admin deliberately cannot do

- **Repair a customer's server.** Nothing puts Composery's key back, changes an address, or reboots a machine. `docs/policy.md` says why: we cannot tell a broken server from one the customer meant to change.
- **Delete a resource a finding names.** A finding is evidence for a person, and the controller never acts on one. An admin who decides a resource is not ours removes it at the provider by hand.
- **Read a secret.** Stored secrets are encrypted with a key held in the deployment's settings, and nothing returns the plaintext.

Nothing tells an admin that any of this is needed, and nothing records that an admin acted. Both are in `docs/roadmap.md`, with what they cost and what they wait on.
