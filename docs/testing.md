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
| Hetzner's published API description | the shape of what we send and what we accept | `tests/harness/hetzner-contract.json` |
| Hetzner | that the provider really did it | not built; see below |

A test against Composery's own parser proves only that the parser agrees with itself. Where OpenSSH decides what a line means, the test asks OpenSSH too, as `tests/convex/ssh/authorized_keys_agreement.test.ts` does.

## Fakes

Fake what a test is not about. Never fake what decides whether it passes.

- Do not reimplement another system to test against it, such as `convex-test` for Convex or a fake SSH server for OpenSSH. A reimplementation can give a plausible wrong answer that no test detects.
- A fake may script an outcome that Composery must survive, such as a provider reply that never arrives. It uses only outcomes that the real system has been seen to produce.
- Do not replace modules at import time. Pass a dependency in, or point a configurable address at a server that the test controls.

## Layout

Tests live under `tests/`, in folders that mirror the source folders they test, so every test has one place: the test of `convex/ssh/key_pair.ts` is `tests/convex/ssh/key_pair.test.ts`. A test keeps the name of what it tests, letter for letter, so a search for the name finds both files. A test of a behavior that spans modules is named for the behavior, in the spelling of the folder it sits in, such as `tests/convex/ssh/authorized_keys_agreement.test.ts`. A folder under `tests/` follows the source tree, so it can hold a single file, as `tests/convex/ssh/scripts/` does. The harness is not a mirror: it is our own code, in `tests/harness/`, named as every other folder of ours is.

## Running

`bun test` runs every test that is safe to run: nothing it starts costs money or reaches a system that someone depends on. `docs/requirements.md` says what a machine needs; a missing requirement fails the run with a message that says what to do, and nothing is skipped quietly.

## Pins

`tests/harness/pins.ts` holds every external version a test depends on: the Ubuntu image and the day of the archive its packages come from, and the Convex backend release with its digest for each platform. Each one says what it is and when to move it.

A pin here cannot rot the way an apt version pin does. We pin the day of the archive, not the version of a package, and the archive keeps every day: a snapshot from June 2024 still installs today. So an old pin gives an old OpenSSH, never a broken build. That is the reason to move these on purpose: to test against what people really run, not to keep the tests working.

## Isolation

- A child process gets an environment built from nothing. It never inherits the shell's variables, which can name a real deployment or hold a real token.
- One `sshd` and one Convex backend serve a whole run. Each test creates its own accounts and users, so tests do not share state and can run in any order.
- Every resource that a run starts is registered for cleanup at the end of the run. A run that is killed leaves resources that name their owner, and the next run removes those whose owner is gone.

## Hetzner

No test reaches Hetzner. A run starts a fake on loopback and gives the deployment its address in `HCLOUD_FAKE_URL`, with a token that is not a token. Hetzner's own address is built in and no deployment can replace it: the variable accepts only `127.0.0.1` or `[::1]`, so a deployment that sets it by mistake reaches nothing and sends nothing anywhere.

The fake answers what Composery asks, and produces what Hetzner cannot be asked for: a reply that never arrives. It never decides whether a test passes.

The fake cannot drift on its own, and neither can we. Hetzner publishes a description of its API, and `scripts/hetzner-contract.ts` writes down the part we depend on. Every request Composery sends and every reply the fake gives is checked against it, and a difference fails the run at the end, whichever test made the request. Running that script again is how we find out that Hetzner has changed: the file changes, and the change is reviewed.

A description is what a system says about itself, not the system. Where the two disagree, running it wins, and the difference is named in `knownDifferences` with the evidence that settled it.

Tests of the worker wait on the deployment's own pacing, which is slow on purpose: it sweeps every ten seconds and limits its own requests. A test may ask for a sweep, but not faster than the deployment's own pace, or the worker starves.

Hetzner itself is still to be tested, with a separate token and project, and never from plain `bun test`.
