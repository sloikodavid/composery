# Testing

## What earns a test

A test earns its place when a behavior could plausibly break and nothing cheaper, such as a type or an exhaustive `switch`, already makes the mistake impossible or obvious. A test must be able to fail for a reason that matters. A test that only records what the code does today is not a test of correctness: when the code changes, it fails whether or not anything broke.

## Who decides the answer

Every test asks one authority whether the result is right, and the authority must not be the code under test. Where another system owns the truth, ask that system.

| Authority | What it settles | What the test needs |
|---|---|---|
| The code's own rules | parsing, arithmetic, formats that Composery defines | nothing |
| OpenSSH | whether a key signs in, what a key file means, what a setting does | a real `sshd` in Docker |
| The Convex backend | functions, authorization, error codes, transactions | a real local Convex backend |
| Clerk's own SDK | that a webhook is genuine | a fake Clerk on loopback |
| A system's published description | the shape of what we send, and of what a fake answers | `contracts/<system>/contract.json` |
| Hetzner | that the provider really did it | not built; see below |

A test against Composery's own parser proves only that the parser agrees with itself. Where OpenSSH decides what a line means, the test asks OpenSSH too, as `tests/convex/ssh/authorized_keys_agreement.test.ts` does.

## Fakes

Fake what a test is not about. Never fake what decides whether it passes.

- Do not reimplement another system to test against it, such as `convex-test` for Convex or a fake SSH server for OpenSSH. A reimplementation can give a plausible wrong answer that no test detects.
- A fake may script an outcome that Composery must survive, such as a provider reply that never arrives. It uses only outcomes that the real system has been seen to produce.
- Do not replace modules at import time. Pass a dependency in, or point a configurable address at a server that the test controls.

## Layout

`tests/` lies over the repository: a path under it is the same path, with `.test.ts` in place of `.ts`. The test of `convex/ssh/key_pair.ts` is `tests/convex/ssh/key_pair.test.ts`, and the test of `contracts/waiver.ts` is `tests/contracts/waiver.test.ts`. A test keeps the name of what it tests, letter for letter, so a search for the name finds both files. A test of a behavior that spans modules is named for the behavior, in the spelling of the folder it sits in, such as `tests/convex/ssh/authorized_keys_agreement.test.ts`.

The mirror decides where a test goes, never that one must exist. A source file with nothing worth testing has no test, and a file never gets a second test file for a second kind of case: that would be symmetry for its own sake, and the reader would have to guess which of the two to open.

One folder is not part of that mirror. `tests/harness/` is what a test uses to build a world: it starts, isolates and stops an `sshd`, a Convex backend, or a fake. It is the only folder under `tests/` that mirrors nothing, and it holds no `.test.ts` file at all. That is not a carve-out but the same rule read backwards: a thing under `tests/` has nowhere to put its own test, because `tests/tests/` is not a place. So code that needs proving of its own does not belong under `tests/`, and a test file appearing in the harness means something living there should live elsewhere. That is how the contract checkers came to be in `contracts/`.

## Running

`bun test` runs every test that is safe to run: nothing it starts costs money or reaches a system that someone depends on. `docs/requirements.md` says what a machine needs; a missing requirement fails the run with a message that says what to do, and nothing is skipped quietly.

## Pins

`tests/harness/pins.ts` holds every external version a test depends on: the Ubuntu image and the day of the archive its packages come from, and the Convex backend release with its digest for each platform. Each one says what it is and when to move it.

A pin here cannot rot the way an apt version pin does. We pin the day of the archive, not the version of a package, and the archive keeps every day: a snapshot from June 2024 still installs today. So an old pin gives an old OpenSSH, never a broken build. That is the reason to move these on purpose: to test against what people really run, not to keep the tests working.

## Isolation

- A child process gets an environment built from nothing. It never inherits the shell's variables, which can name a real deployment or hold a real token.
- One `sshd` and one Convex backend serve a whole run. Each test creates its own accounts and users, so tests do not share state and can run in any order.
- A test that needs a user makes a whole one, with `createAccount`: held by Clerk and synced into our tables. Half of one is a person Clerk never heard of, and the hourly reconcile deletes them part way through the test, which is exactly what it is for.
- Every resource that a run starts is registered for cleanup at the end of the run. A run that is killed leaves resources that name their owner, and the next run removes those whose owner is gone.

## Contracts

A fake is code we wrote, so nothing in a test can contradict it. That is what a contract is for.

Where a system publishes a machine-readable description of itself, `contracts/<system>/` holds the part we depend on:

- `selection.ts` says which operations we use and where the descriptions are published. The filter is a rule, not a hand-cut subset, so a reviewer can rerun it.
- `contract.json` is what that filter produced, with the source, the day it was read, and a digest of the whole published document. A difference here is a change at the system, reviewed like any other change.
- `check.ts` reads it and holds both halves of an exchange to it: what Composery sends, and what a fake answers.
- `waivers.ts` names each place where the system and its own description disagree.

`bun contracts` reads the descriptions again. It is how we find out that a system has changed, and it is the only part that reaches the network; nothing a test runs does.

A description is a system's word about itself, not the system. Where running it says otherwise, running wins, and the difference is a waiver with the evidence that settled it. A waiver must be able to fail, or it is an ignore with a comment: it stops applying when the description at that place changes, it fails the run when its operation runs and the difference no longer appears, and `tests/contracts/<system>/waivers.test.ts` carries a reproducer for each one, so a waiver added without proof fails there. One of the first two waivers we wrote turned out to be invented; the stale check deleted it.

There is a trap in all of this worth naming: if the same wrong description both shapes the fake and judges our requests, the two agree with each other and neither is right. Only the real system settles that. We have run against real Hetzner; we have not run against real Clerk, so Clerk's contract proves shape and nothing more.

## Hetzner

No test reaches Hetzner. A run starts a fake on loopback and gives the deployment its address in `HCLOUD_FAKE_URL`, with a token that is not a token. Hetzner's own address is built in and no deployment can replace it: the variable accepts only `127.0.0.1` or `[::1]`, so a deployment that sets it by mistake reaches nothing and sends nothing anywhere.

The fake answers what Composery asks, and produces what Hetzner cannot be asked for: a reply that never arrives. It never decides whether a test passes.

Tests of the worker wait on the deployment's own pacing, which is slow on purpose: it sweeps every ten seconds and limits its own requests. A test may ask for a sweep, but not faster than the deployment's own pace, or the worker starves.

Hetzner itself is still to be tested, with a separate token and project, and never from plain `bun test`.

## Clerk

No test reaches Clerk either. A run starts a fake on loopback and gives the deployment its address in `CLERK_API_URL`, under the same rule as Hetzner's.

Clerk's own client builds our requests, so checking those checks Clerk's code, not ours. What is worth checking is everything we accept: the client reads a reply without validating it, so a field a fake invents would never be refused, and a hand-written webhook body would never be questioned. Both are held to Clerk's published descriptions of its backend API and of its events.

The version of Clerk's API is pinned by the one its own client asks for. The fake refuses a request that carries any other, so an upgrade that changes it says so rather than quietly leaving the contract behind.
