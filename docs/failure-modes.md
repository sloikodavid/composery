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

## What Composery does about it

The worker compares what Hetzner reports against what Composery recorded, and refuses to act on a difference rather than writing over it. Each part of an allocation is reported on its own: the server, its addresses, the project's rules, and Composery's management access. A part that is wrong then stops only what depends on it, so rules somebody took off do not stop a power command, and a management key the customer removed does not stop deletion. What a member can do is worked out from those parts in one place, so nothing offers an ability that is not there and nothing claims a protection the provider is not enforcing.

Nothing is given up on. What the failure means decides how long the wait is, from ten seconds for a provider that was busy to an hour for something only a person can change, and the allocation is picked up again after it, so a difference that goes away is acted on without anybody doing anything. An allocation that is stuck says so, with the code the provider sent and since when, and an admin can bring the next attempt forward with `retry`.

Inventory scans record a resource Composery does not own as a finding for an admin, and never delete it. Hetzner publishes no webhooks, so the scan is how anything at the provider is noticed, including a server that somebody stopped in Hetzner's own console. Clerk does publish webhooks and is reconciled hourly as well, because delivery is not guaranteed.

Nothing repairs anything, and per `docs/policy.md` nothing is owed. What none of this does is reach anybody: `docs/notices.md` says what is missing, `docs/admin.md` says what a person can do about it once they know, and `docs/roadmap.md` says where both sit against everything else that is not built.

## What is decided

Addresses are not exposed. A customer cannot disable, change or release one, because every address is part of an allocation and is released with it. Floating IPs are a separate provider resource with their own quota, and are not sold. A server always has one IPv4 and one IPv6; an IPv6-only server would be cheaper and would fail for anyone on an IPv4-only network.
