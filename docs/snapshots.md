# Snapshots

Not built. This is what has to be true before they are, written down now because the analysis is the hard part and the implementation follows from it.

A snapshot is a copy of a server's disk, taken by the provider from outside. A server made from one starts with every byte the original had. That is the point, and it is also the problem: **a disk cannot tell which machine it is running on**, so everything on it claims to belong to the machine it came from.

## Four kinds of state, not one

The useful question is not "what should we delete". It is what each piece of state is *for*.

| Kind | What it should be after a restore | What goes wrong when it is copied |
|---|---|---|
| **Identity** | different | two live servers are taken for one |
| **Credential** | different, or deliberately re-enrolled | the new server holds authority granted to the old one |
| **Cached outside state** | matched to the new server | first-boot work is skipped, or stale configuration is replayed |
| **History** | depends what the restore is for | missed or repeated jobs, wrong measurements, misattributed logs |
| **Data identity** | often deliberately the same | only wrong when both copies enter the same system at once |

That last row is why "regenerate every identifier" is not the answer either. A restored filesystem needs its own UUID if `/etc/fstab` names it, and a database being *replaced* rather than *cloned* may need to keep the identity of the member it replaces.

## What the customer expects, and where that parts from the truth

Someone taking a snapshot knows they are copying their whole disk. So they expect their files, their packages, their configuration, their own SSH keys, their cron jobs and their data to come with it, and they would be annoyed if we quietly changed any of it.

What they cannot predict is the state they never put there. Two examples matter most:

- **Composery's management key.** It is in `authorized_keys` on the original, and Hetzner documents that keys already present in a snapshot keep working. So a server made from that snapshot accepts the *original allocation's* key. Nothing about the product tells anyone this: a reasonable person, beginner or expert, would assume our access is arranged from outside, through the provider, and is per server. It is not; it is a line in a file on their disk.
- **Machine identity.** `/etc/machine-id`, the systemd journal keyed by it, DHCP identifiers derived from it, saved entropy, and the cloud-init cache that decides whether first-boot work runs at all.

An expert is not much better placed than a beginner here. They will know host keys are an issue; they are unlikely to have considered that the panel's own access travels in the image, because that depends on our architecture, which we have not published.

## What the platform's own machinery already does

Not nothing, and not enough.

- **SSH host keys are regenerated**, as long as cloud-init treats the new server as a new instance, which it does when the provider's instance identifier differs, and Hetzner gives a new server a new identifier. Its SSH module runs once per instance and deletes the image's host keys by default. **Our pin therefore breaks, loudly, and we notice** - which is the correct outcome, not a bug.
- **`authorized_keys` is not touched.** Injecting a new key does not remove an old one. This is documented behaviour, not an oversight.
- **Storage identity is not reset**: iSCSI initiator names, NVMe host NQN and host ID persist, and stock cloud images have no module that changes them.
- **Subscription and agent enrolment is not reset**, and each installed agent can add its own machine identity and token.

There is no finite list that covers an arbitrary customer's server. Once they install a configuration-management agent, a monitoring agent, a VPN or a cluster member, they have added identity we cannot know about. **So the platform has to decide what a snapshot-derived server is supposed to mean, and say so, rather than pretend to sanitise everything.**

## What Composery must do

1. **Stop our own access travelling in an image.** Our public key line currently carries no comment, so a key inherited from another allocation is indistinguishable from one the customer added. It should carry a marker naming it as Composery's management key for one allocation, and the bootstrap should remove every entry carrying that marker that is not this allocation's, leaving everything else alone. This is precise, it does not touch the customer's own keys, and without it every restored server keeps an authorized key that we placed and can no longer account for.
2. **Expect the host key to differ, and treat it as first contact.** A server made from a snapshot is a new allocation that has never reported. The existing bootstrap flow is the right one; what must not happen is carrying the old pin forward.
3. **Say what a restore does and does not change.** Whatever we decide, the customer is told before it happens. The state we alter is the state that would otherwise let two servers impersonate each other; everything else is theirs.
4. **Decide what a restore is for.** Replacing a broken server and cloning a working one want different things from identity, and no default is right for both. This is a product decision and it belongs with the feature.

The bootstrap token does not travel: it is written to `/run`, which is memory, so it is never on the disk a snapshot copies. That is worth keeping true.

## Still to decide

Whether a snapshot is per allocation or outlives one; whether restoring is a new server or a replacement of an existing one, which decides what happens to the addresses and therefore to everything pointing at them; and whether a snapshot can be shared with another account, which turns every question above from a hygiene problem into somebody else holding the customer's keys.
