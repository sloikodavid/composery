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
| A system's published description | the shape of what we send, and of what a fake answers | `contracts/<system>.json` |
| Hetzner | that the provider really did it | a project of its own, and `HCLOUD_MODE=real` |

A test against Composery's own parser proves only that the parser agrees with itself. Where OpenSSH decides what a line means, the test asks OpenSSH too, as `tests/convex/ssh/authorized_keys_agreement.test.ts` does.

## Fakes

Fake what a test is not about. Never fake what decides whether it passes.

- Do not reimplement another system to test against it, such as `convex-test` for Convex or a fake SSH server for OpenSSH. A reimplementation can give a plausible wrong answer that no test detects.
- A fake may script an outcome that Composery must survive, such as a provider reply that never arrives. It uses only outcomes that the real system has been seen to produce.
- Do not replace modules at import time. Pass a dependency in, or point a configurable address at a server that the test controls.

## Layout

`tests/` lies over the repository: a path under it is the same path, with `.test.ts` in place of `.ts`. The test of `convex/ssh/key_pair.ts` is `tests/convex/ssh/key_pair.test.ts`, and the test of `contracts/check.ts` is `tests/contracts/check.test.ts`. A test keeps the name of what it tests, letter for letter, so a search for the name finds both files. A test of a behavior that spans modules is named for the behavior, in the spelling of the folder it sits in, such as `tests/convex/ssh/authorized_keys_agreement.test.ts`.

The mirror decides where a test goes, never that one must exist. A source file with nothing worth testing has no test, and a file never gets a second test file for a second kind of case: that would be symmetry for its own sake, and the reader would have to guess which of the two to open.

The mirror has no exception. `harness/` sits at the top of the repository beside `convex/`, `contracts/` and `src/`, because it is source like any of them: it starts, isolates and stops what a test needs. It is grouped by the world each file builds, so `clerk/`, `convex/`, `hetzner/` and `openssh/` each hold what it takes to stand that system up or to stand in for it, and what every world uses sits beside them.

So the harness can be tested like anything else, at `tests/harness/<path>.test.ts`, and today nothing there is: no file in it decides whether a test passes, and the tests that use it are what show it works. The place exists for the day one of them earns a test of its own, which is the point of having no exception. A contract checker does decide, which is why the checkers are not harness code at all: an oracle nothing proves is worse than none, so they live in `contracts/` and are tested through the mirror like any other source.

## Running

`bun test` runs every test that is safe to run: nothing it starts costs money or reaches a system that someone depends on. `docs/requirements.md` says what a machine needs; a missing requirement fails the run with a message that says what to do, and nothing is skipped quietly.

`HCLOUD_MODE=real bun test tests/convex/allocations` runs the same tests against a real Hetzner project. Nothing about the tests changes: the fake passes each request on, so what is real is the run, not a second kind of test, and there is no category here to name or to keep in step.

One variable per system says which of the two that run wants, and the credentials sit in `.env.test` between runs without meaning anything on their own. Bun loads that file into every run, so what it holds is the default; the environment beats the file, so a single run says otherwise with `HCLOUD_MODE=real` or `HCLOUD_MODE=fake` in front of the command. A run that asks for the real thing without a token fails rather than falling back, because a fake run that reports success in the same words as a real one hides what did not happen.

## Pins

`harness/pins.ts` holds every external version a test depends on: the Ubuntu image and the day of the archive its packages come from, and the Convex backend release with its digest for each platform. Each one says what it is and when to move it.

A pin here cannot rot the way an apt version pin does. We pin the day of the archive, not the version of a package, and the archive keeps every day: a snapshot from June 2024 still installs today. So an old pin gives an old OpenSSH, never a broken build. That is the reason to move these on purpose: to test against what people really run, not to keep the tests working.

## Isolation

- A child process gets an environment built from nothing. It never inherits the shell's variables, which can name a real deployment or hold a real token.
- One `sshd` and one Convex backend serve a whole run. Each test creates its own accounts and users, so tests do not share state and can run in any order.
- A test that needs a user makes a whole one, with `createAccount`: held by Clerk and synced into our tables. Half of one is a person Clerk never heard of, and the hourly reconcile deletes them part way through the test, which is exactly what it is for.
- Every resource that a run starts is registered for cleanup at the end of the run. A run that is killed leaves resources that name their owner, and the next run removes those whose owner is gone.

## Contracts

A fake is code we wrote, so nothing in a test can contradict it. That is what a contract is for.

Where a system publishes a machine-readable description of itself, `contracts/` holds the part we depend on. There are two files for each system and two shared ones:

- `contracts/<system>.ts` says which operations we use, where the descriptions are published, and where the system disagrees with its own description. The subset is a declared list, not a hand-cut file, so a reviewer can rerun it.
- `contracts/<system>.json` is what that list produced, with the source, the day it was read, and a digest of the whole published document. A difference here is a change at the system, reviewed like any other change.
- `contracts/schema.ts` is the part of JSON Schema a description uses, and what it says about one value. Where a description allows a value to take one of several shapes, fitting none of them is the problem; which one it fits is the system's business, not ours.
- `contracts/check.ts` holds both halves of an exchange to a description: what Composery sends, and what a fake answers.

`bun contracts` reads the published descriptions again and rewrites the two JSON files. It is how we find out that a system has changed, and it is the only thing in the repository that fetches one: a test never reaches the network, so a run is the same on a train as in an office, and a change at a vendor arrives as a diff somebody reads rather than as a red build nobody asked for.

A description is a system's word about itself, not the system. Where running it says otherwise, running wins, and the difference is a waiver with the evidence that settled it. A waiver must be able to fail, or it is an ignore with a comment: it stops applying when the description at that place changes, it fails the run when its operation runs and the difference no longer appears, and `tests/contracts/<system>.test.ts` carries a reproducer for each one, so a waiver added without proof fails there. One of the first two waivers we wrote turned out to be invented; the stale check deleted it.

Running a contract and reading one find different things. Running it compares what a fake happens to send against the description, so it can only ever catch what a test already produces. Reading it catches what our code assumes: take every field the code pulls out of a reply, find the same field in the pinned contract, and ask whether the description permits a value that read would refuse. The cases worth looking for are a `type` that includes `"null"` read by something that rejects null, a field absent from `required` read unconditionally, a union type where one branch is assumed, an `enum` with a member nothing handles, and a field read that the description does not mention at all. Doing this once over the Hetzner and Clerk readers found six defects that running the same contracts had never tripped, so it is worth doing again whenever a reader or a contract changes.

A fake must not invent a rule the system does not have. Tying two of its fields together, so that one is decided by the other, looks like tidiness and is really a constraint: a test can then only ever see the pairs that rule allows, and the pairs it forbids are exactly where the code has never been tried. Clerk says whether somebody uploaded a picture in one field and where to find one in another, and it fills the second even when the first is false; a fake that derived one from the other would have hidden that from every test forever.

A fake hides a defect by being unable to produce a value the description permits. These are the ones known to be unreachable today, and each is a path nothing exercises: a Hetzner list that comes back empty, a server type that is not the one asked for, an image that is deprecated or not `available`, a firewall with no labels or another controller's, an action that is `running` or `error`, a second page of anything, a 429 with `Retry-After`, and a `user.deleted` event with no `data.id`. Widening a reply builder so a test can express one of these is worth more than another test of what it can already say.

There is a trap in all of this worth naming: if the same wrong description both shapes the fake and judges our requests, the two agree with each other and neither is right. Only the real system settles that. We have run against real Hetzner; we have not run against real Clerk, so Clerk's contract proves shape and nothing more.

## Hetzner

No test reaches Hetzner. A run starts a fake on loopback and gives the deployment its address in `HCLOUD_FAKE_URL`, with a token that is not a token. Hetzner's own address is built in and no deployment can replace it: the variable accepts only `127.0.0.1` or `[::1]`, so a deployment that sets it by mistake reaches nothing and sends nothing anywhere.

The fake answers what Composery asks, and produces what Hetzner cannot be asked for: a reply that never arrives. It never decides whether a test passes.

Tests of the worker wait on the deployment's own pacing, which is slow on purpose: it sweeps every ten seconds and limits its own requests. A test may ask for a sweep, but not faster than the deployment's own pace, or the worker starves.

The same tests can meet Hetzner itself, and never by accident. Given a token in `.env.test` and `HCLOUD_MODE=real` for that run, the fake passes every request on to Hetzner and brings back exactly what Hetzner said: the tests do not change, the contract still holds both halves, and a test that loses a reply loses a real one. The run makes its own firewall, labels everything it creates with its own identity, removes all of it at the end, and removes what a killed run left behind, so anything still in that project is a leak. `docs/setups/hetzner-cloud.md` says what the project needs. The whole of `tests/convex/allocations` passed against a real project on 19 September 2026, which is what proved the firewall is found by its label at a provider that answers, that rules taken off a real server go back on, and that a run leaves nothing behind. Two defects only that run could find were fixed on the way: a control that edited this fake's own memory and changed nothing at Hetzner, and one that returned before Hetzner had carried the change out.

## Clerk

By default no test reaches Clerk. A run starts a fake on loopback and gives the deployment its address in `CLERK_API_URL`, under the same rule as Hetzner's.

Clerk's own client builds our requests, so checking those checks Clerk's code, not ours. What is worth checking is everything we accept: the client reads a reply without validating it, so a field a fake invents would never be refused, and a hand-written webhook body would never be questioned. Both are held to Clerk's published descriptions of its backend API and of its events.

The version of Clerk's API is pinned by the one its own client asks for. The fake refuses a request that carries any other, so an upgrade that changes it says so rather than quietly leaving the contract behind.

The same tests can meet Clerk itself, given `CLERK_SECRET_KEY` and `CLERK_FRONTEND_API_URL` in `.env.test` and `CLERK_MODE=real` for that run. Accounts are then real: the run makes them through Clerk's own API, marks each with an `external_id` of its own, and signs in by asking Clerk for a session and a token for it, which Clerk documents for tests and allows on a development instance alone. So a signed-in test takes the verification path a signed-in person takes, down to whose key signed the token. Every account the run made is deleted at the end, and what a killed run left behind goes first: a development instance holds a hundred accounts, and one that fills up refuses sign-ups.

Two things such a run does not cover, and it says so rather than passing quietly.

A test that scripts Clerk cannot run against Clerk: an account that is there, one that is gone, a refusal, keys from another instance. Those are what `tests/convex/clerk.test.ts` and `tests/convex/clerk_http.test.ts` are made of, and each test in them is skipped and reported when the run meets Clerk. The controls behind them refuse too, so a test that reaches for one is told which run it belongs in rather than changing a fake nobody is reading.

Clerk delivering a webhook is the other. Those arrive over the internet, and a test runs a backend on this machine. The webhook tests sign the body themselves, which proves what the route does with an event and never that Clerk sent one.
