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
| Hetzner | that the provider really did it | not built; see below |

A test against Composery's own parser proves only that the parser agrees with itself. Where OpenSSH decides what a line means, the test asks OpenSSH too, as `tests/ssh/authorized-keys-agreement.test.ts` does.

## Stand-ins

Stand in for what a test is not about. Never stand in for what decides whether it passes.

- Do not reimplement another system to test against it, such as `convex-test` for Convex or a fake SSH server for OpenSSH. A reimplementation can give a plausible wrong answer that no test detects.
- A stand-in may script an outcome that Composery must survive, such as a provider reply that never arrives. It uses only outcomes that the real system has been seen to produce.
- Do not replace modules at import time. Pass a dependency in, or point a configurable address at a server that the test controls.

## Layout

Tests live under `tests/`, grouped by domain like the code they test. `bunfig.toml` sets `tests` as the test root, and `check:test-files` fails when a test file exists anywhere else, because Bun would silently never run it. The code that starts and stops what tests need lives in `tests/harness/`.

## Running

`bun test` runs every test that is safe to run: nothing it starts costs money or reaches a system that someone depends on. It needs:

- Docker, for `sshd`.
- Node on the path, for the Convex CLI and the backend's Node runtime.
- On Windows, permission to create symbolic links (Developer Mode). The repository already needs it for `CLAUDE.md`.
- The network on the first run: the harness downloads the pinned Convex backend, checks its SHA-256 digest, and builds a storage template, which takes about a minute. Later runs start from the template in seconds.

A missing requirement fails the run with a message that says what to do. Nothing is skipped quietly.

## Isolation

- A child process gets an environment built from nothing. It never inherits the shell's variables, which can name a real deployment or hold a real token.
- One `sshd` and one Convex backend serve a whole run. Each test creates its own accounts and users, so tests do not share state and can run in any order.
- Every resource that a run starts is registered for cleanup at the end of the run. A run that is killed leaves resources that name their owner, and the next run removes those whose owner is gone.

## Hetzner

No test creates Hetzner resources yet. When one does, plain `bun test` must never run it, it must use a separate token and project, and a reply that never arrives is tested against a stand-in, because Hetzner cannot produce one on demand.
