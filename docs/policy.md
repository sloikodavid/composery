# Policy

What Composery is for, and what it will and will not do to somebody's server. The rules in `AGENTS.md` say how to write the code; this says what the code is trying to be, so that a judgement the rules do not cover can still be made the same way twice.

It is deliberately short, and it is not a checklist. Where it and a sensible design disagree, say so and choose the design; a policy that forces a worse implementation has stopped being useful.

## The customer has root

We sell a server, not a sandbox. The person who owns it may replace the operating system, move the SSH port, remove our key, or make the whole thing unreachable, and none of that is misuse. It is the product working.

So the question is never "how do we stop this". It is "what do we do when it happens".

## Break cleanly

A failure must leave the system in a state a person can act on.

- **Say which part is unavailable**, not that something is wrong. Losing our SSH access says nothing about whether the server runs.
- **Keep working where we still can.** Power, deletion, status and quota come from the provider and do not depend on anything inside the server. A customer who breaks SSH keeps all of them.
- **Never write over what we do not understand.** When the provider reports something other than what we recorded, stop and keep the record. An allocation that does not match is not repaired by guessing.
- **Never make it worse.** No destructive action recovers from an unexpected state.
- **Never promise more than is enforced.** This one is checkable, so it is an inviolable rule in `AGENTS.md` rather than a principle here.

## The smallest surface that does everything

Two kinds of person use this. Someone who does not want to know what SSH is should be able to get to a working server in one step. Someone who does should find the whole native surface, unsimplified, with no presets deciding for them.

What must not exist is the middle: a panel control that does part of what the underlying tool does, so that the simple path is limiting and the advanced path is somewhere else. Where a thing can be done with the full native surface, that is the surface, and the one-step path is a convenience on top of it rather than a different, smaller system.

This is also why something is shown rather than hidden when a customer needs it to do anything else with their server. Hiding a fact they cannot change does not simplify anything; it just moves where they have to go to find it.

## Do not repair what may have been meant

A missing management key can mean "help, I broke it" or "I do not want you in here". We cannot tell which, so we do not decide for them.

That is not an argument against automatic repair. It is an argument about consent: anything that puts our access back, or changes an identifier the customer relies on, is a thing they ask for or are told about, not a thing that quietly happens. Where an action is unambiguous and reversible, doing it on a schedule is fine. Where it reboots their server, changes their address, or restores access they may have removed on purpose, it is theirs to trigger.

## Keep every path open

We are pre-release and there are no customers. That is a reason to build less, not a reason to build carelessly.

The test is not "can it repair itself" but **"if this goes wrong, can somebody still fix it?"** A failure that is recorded, named and visible can be handled by a support email today and by a feature later. A failure that is silent, or that leaves the system unable to describe itself, cannot be handled at all.

So: no repair feature is owed. A state that cannot be reasoned about afterwards is not acceptable.

## Handle edge cases, do not defer them

An edge case that is known and unhandled is a defect, whether or not anything has hit it. The order of preference:

1. **Design it away.** The best edge case is one the shape of the system makes impossible.
2. **Handle it.** State what happens, make it happen, and prove it with a test that could fail.
3. **Name it.** If it genuinely cannot be handled yet, write down what it is and what it would take, in the document that owns the subject.

What is not acceptable is discovering it and moving on.

## Degrade by feature, never by server

When something we depend on is missing, the feature that needs it reports what is unavailable and every other feature keeps working. This is why the SSH features can fail without touching power, and why an unreadable secret stops management rather than the machine.

SSH management currently supports the POSIX shell, Python 3, and OpenSSH command surface used by its scripts. It discovers the executable paths and effective settings on each server. It pairs OpenSSH's effective configuration with its native debug assignments when quote boundaries are needed, and reports the operation as unsupported when those boundaries are ambiguous. Each operation reports its own missing guest interface: for example, IPv6 discovery needs the guest's kernel interface and hostname changes need a working native hostname tool. A missing tool, a different SSH implementation, or an operating system the scripts cannot inspect makes that SSH operation unsupported and is reported as such; it does not make the customer-controlled server unavailable. Windows guests remain allowed; their SSH management command surface needs a native implementation and an external system test before it can be supported.

## Saying it out loud

Breaking cleanly is only half of it. A state that is recorded but that nobody is told about satisfies the letter of every rule above and not the point of any of them. What has to be said, and to whom, is in `docs/notices.md`.
