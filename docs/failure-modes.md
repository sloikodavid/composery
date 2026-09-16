# Failure modes

What can be true about an allocation that Composery did not ask for, what it costs, and what is decided about each. `docs/policy.md` says how we choose; this says what there is to choose about.

## What can change under us

An allocation is one server, its two addresses, and Composery's SSH access to it. They are created and deleted together, but they fail apart, and three different people can cause it: the customer, who has root; an admin, who has the provider dashboard and the API token; and the provider, during an incident.

| What breaks | Can a program repair it? | What it costs |
|---|---|---|
| Composery's SSH access, because the customer removed the management key | Yes. Hetzner rescue boots a temporary system with a key we choose, and the disk can be mounted and the key written back | a reboot, and it fails on an encrypted or unusual disk |
| An address is detached or deleted | Only by replacement. A Primary IP that is gone cannot come back; a new one can be created and attached, and the server must be off to attach it | the address changes, which is a new identity for everyone who used the old one |
| The server is gone, its addresses remain | No. Creating another server is not repair: the disk is gone | - |
| The customer replaced the operating system, or moved the SSH port, or forbade root login | Nothing to repair. This is allowed, and the SSH features degrade visibly while power, deletion and status keep working | - |

The middle row is the one to be careful about. Replacing an address looks like repair and is not: it is a customer-visible identifier changing. Panels that hide that cause the damage. The observable sequence is `degraded → a replacement exists → the endpoint changed → access re-established`, never `degraded → healthy`.

## What is built now

- The worker compares what Hetzner reports against what Composery recorded, and refuses to act on a mismatch instead of writing over it.
- Inventory scans record a resource Composery does not own as a finding for an admin, and never delete it.
- Nothing repairs anything. An allocation that does not match is blocked, and an admin decides.

Hetzner publishes no webhooks, so the scan is how state at the provider is noticed. Clerk does publish webhooks, and is reconciled hourly as well, because delivery is not guaranteed.

## What is missing, in the order it matters

1. **Say which part is unavailable.** `blocked` means both "we do not know" and "this one part is broken", so a lost management key can stop a power operation that would have worked. The parts of an allocation already have their own status; what is missing is reporting them separately and deriving the customer-facing one, rather than collapsing them. This is worth doing before any repair, because every repair needs to know what is broken. It is also what the rule about not promising more than the system enforces asks for.
2. **A support runbook.** What a person is told to do for each row above, written before there is anyone to tell. Until it exists, these are answered case by case, which is right while there are no customers and wrong immediately after.
3. **Restoring management access.** Rescue, driven through the provider's API. Built as an admin action or as something that keeps trying on a schedule, not as a button for the customer: it reboots their server, and the customer did not necessarily do anything wrong. Keeping the customer's system free to be anything does not stop us from putting our own key back on a schedule.
4. **Replacing an address.** Only after 1, and only with the identity change stated plainly to whoever asks for it.

## What Composery does about it

The worker compares what the provider reports against what was recorded, and refuses to act on a difference rather than writing over it. An allocation that does not match becomes `blocked`, which stops nothing on the customer's server: it runs, and power and deletion still work. A blocked allocation is looked at again every hour, so a difference that goes away is picked up without anybody doing anything.

Inventory scans record a resource Composery does not own as a finding for an admin, and never delete it. Hetzner publishes no webhooks, so scanning and the worker's own polling are how anything at the provider is noticed; Clerk does publish webhooks and is reconciled hourly as well, because delivery is not guaranteed.

Nothing repairs anything, and per `docs/policy.md` nothing is owed. What is missing is that `blocked` tells nobody: there is no alerting and no admin surface, so it waits to be noticed.

## What is undecided

When a server is deleted, its row goes and so does its SSH access, but the allocation, its operations and the backend's own row stay, holding a `serverId` that no longer resolves. That may be right: an allocation is the record of what ran a server, billing will want it, and name claims are already kept on purpose. It may also be an oversight. Nothing says which, and the two look identical from the code, so decide it and write one line in `docs/decisions.md`.

## What is decided

Addresses are not exposed. A customer cannot disable, change or release one, because every address is part of an allocation and is released with it. Floating IPs are a separate provider resource with their own quota, and are not sold. A server always has one IPv4 and one IPv6; an IPv6-only server would be cheaper and would fail for anyone on an IPv4-only network.
