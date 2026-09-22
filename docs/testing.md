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

`tests/convex/ssh/connection.test.ts` runs discovery, a read, a write, a separate key acceptance check, and a reread against OpenSSH, then counts successful management logins in the daemon's log. It also checks that file errors leave management access available and that transport closure changes its status. Allocation transition tests cover stale results and invalid completion combinations; worker tests use the deployed functions and provider fake to cover lost replies, deletion, and recovery.

## Fakes

Fake what a test is not about. Never fake what decides whether it passes.

- Do not reimplement another system to test against it, such as `convex-test` for Convex or a fake SSH server for OpenSSH. A reimplementation can give a plausible wrong answer that no test detects.
- A fake may script an outcome that Composery must survive, such as a provider reply that never arrives. It uses only outcomes that the real system has been seen to produce.
- Do not replace modules at import time. Pass a dependency in, or point a configurable address at a server that the test controls.

## Layout

`tests/` lies over the repository: a path under it is the same path, with `.test.ts` in place of `.ts`. The test of `convex/ssh/key_pair.ts` is `tests/convex/ssh/key_pair.test.ts`, and the test of `contracts/check.ts` is `tests/contracts/check.test.ts`. A test keeps the name of what it tests, letter for letter, so a search for the name finds both files. A test of a behavior that spans modules is named for the behavior, in the spelling of the folder it sits in, such as `tests/convex/ssh/authorized_keys_agreement.test.ts`.

The mirror decides where a test goes, never that one must exist. A source file with nothing worth testing has no test, and a file never gets a second test file for a second kind of case: that would be symmetry for its own sake, and the reader would have to guess which of the two to open.

The mirror has no exception. `harness/` sits at the top of the repository beside `convex/`, `contracts/` and `src/`, because it is source like any of them: it starts, isolates and stops what a test needs. It is grouped by the world each file builds, so `clerk/`, `convex/`, `hetzner/` and `openssh/` each hold what it takes to stand that system up or to stand in for it, and what every world uses sits beside them.

So the harness can be tested like anything else, at `tests/harness/<path>.test.ts`. `tests/harness/fake.test.ts` proves that scripted and lost replies still pass through the contract oracle. A contract checker does decide, which is why the checkers are not harness code at all: an oracle nothing proves is worse than none, so they live in `contracts/` and are tested through the mirror like any other source.

## Running

`bun test` runs every test that is safe to run: nothing it starts costs money or reaches a system that someone depends on. `docs/requirements.md` says what a machine needs; a missing requirement fails the run with a message that says what to do, and nothing is skipped quietly.

`HCLOUD_MODE=real bun test tests/convex/allocations` runs the same tests against a real Hetzner project. Nothing about the tests changes: the fake passes each request on, so what is real is the run, not a second kind of test, and there is no category here to name or to keep in step.

One variable per system says which of the two that run wants, and the credentials sit in `.env.test` between runs without meaning anything on their own. Bun loads that file into every run, so what it holds is the default; the environment beats the file, so a single run says otherwise with `HCLOUD_MODE=real` or `HCLOUD_MODE=fake` in front of the command. A run that asks for the real thing without a token fails rather than falling back, because a fake run that reports success in the same words as a real one hides what did not happen.

## Pins

`harness/pins.ts` holds every external version a test depends on: the Ubuntu image and the day of the archive its packages come from, and the Convex backend release with its digest for each platform. Each one says what it is and when to move it.

A pin here cannot rot the way an apt version pin does. We pin the day of the archive, not the version of a package, and the archive keeps every day: a snapshot from June 2024 still installs today. So an old pin gives an old OpenSSH, never a broken build. That is the reason to move these on purpose: to test against what people really run, not to keep the tests working.

## Isolation

- A child process gets an environment built from nothing. It never inherits the shell's variables, which can name a real deployment or hold a real token.
- A test that needs a user makes a whole one, with `createAccount`: held by Clerk and synced into our tables. Half of one is a person Clerk never heard of, and the hourly reconcile deletes them part way through the test, which is exactly what it is for.
- Each test file starts its own environment and closes it in `afterAll`. A standalone test uses a disposal scope. `startConvexBackend` owns its backend process, storage, issuer, provider fakes, contract checkers, secrets, and any real provider run. `stop()` closes these in reverse order, stopping the backend before removing provider resources. It is safe to call twice. Failed setup disposes everything already acquired, and one cleanup failure does not prevent the remaining cleanup. An OpenSSH server has the same explicit lifetime. There is no global cleanup list or provider singleton. A killed run leaves resources that name their owner, and the next run removes those whose owner is gone.

Every Convex environment starts with empty storage and pushes the current code once. The backend executable remains cached by its pinned release; mutable database templates are not copied. Each environment has distinct accounts, provider state, signing keys, encryption keys, webhook secrets, and temporary folders. Tests obtain the provider fake from their backend rather than finding a process-wide fake. `tests/harness/convex/backend.test.ts` checks that two environments stay separate and that closing one leaves the other working.

The disposable workspace also installs `harness/convex/quota-writes.ts` as a test-only Convex module. It writes through the same mutation boundary as product code, without calling the product lifecycle. `tests/convex/functions.test.ts` proves that these writes update quota usage and that a caught accounting failure still rolls back the whole mutation. This module is absent from the product's Convex directory.

## Contracts

A fake is code we wrote, so nothing in a test can contradict it. That is what a contract is for.

Where a system publishes a machine-readable description of itself, `contracts/` holds the part we depend on:

- `contracts/<system>.ts` says which operations we use, where the descriptions are published, and where the system disagrees with its own description. The subset is a declared list, not a hand-cut file, so a reviewer can rerun it.
- `contracts/<system>.json` keeps the native OpenAPI operations and every referenced object they need. It records the source, the day it was read, and a digest of the whole published document. References stay references, including recursive ones. A difference here is a change at the system, reviewed like any other change. These generated files keep the publisher's text, so the character check excludes these two files.
- `contracts/openapi.ts` selects that graph and reads its HTTP shapes. Ajv checks schemas using OpenAPI 3.0's Draft 4 rules or OpenAPI 3.1's 2020-12 rules. The compiler view removes example annotations and handles 3.0 reference and nullable semantics; the pinned document stays unchanged. Validation does not coerce JSON bodies, add defaults, or remove fields.
- `contracts/check.ts` checks exchanges and tracks waivers. Required bodies, bodyless replies, path parameters, and query parameters are distinct checks. Unknown request fields remain allowed where the vendor's schema permits them.

The supported HTTP surface is JSON bodies and scalar or array path and query parameters. Query arrays use form, space, or pipe serialization. A missing reference, unsupported dialect, unsupported parameter shape, unknown schema keyword or format, or directional property fails compilation before traffic is checked. Tests do not fetch external references. Standard formats are checked; Hetzner's `decimal` is an explicit format annotation because it publishes no validation rule for that name. This checker does not check HTTP headers or authentication.

`bun contracts` reads the published descriptions again and compiles both contracts before it rewrites either JSON file. It is how we find out that a system has changed, and it is the only thing in the repository that fetches one: a test never reaches the network, so a run is the same on a train as in an office, and a change at a vendor arrives as a diff somebody reads rather than as a red build nobody asked for.

A description is a system's word about itself, not the system. Where running it says otherwise, running wins, and the difference is a waiver with the evidence that settled it. Each waiver names one operation, value location, and schema keyword, and accepts only the evidenced values. A changed claim or an operation that runs without using its waiver fails the check. `tests/contracts/<system>.test.ts` carries a reproducer for each waiver and checks values it must still refuse. The image waiver permits positive integer IDs, not arbitrary values that disagree with a string type.

Running a contract and reading one find different things. Running it compares what a fake happens to send against the description, so it can only ever catch what a test already produces. Reading it catches what our code assumes: take every field the code pulls out of a reply, find the same field in the pinned contract, and ask whether the description permits a value that read would refuse. The cases worth looking for are a `type` that includes `"null"` read by something that rejects null, a field absent from `required` read unconditionally, a union type where one branch is assumed, an `enum` with a member nothing handles, and a field read that the description does not mention at all. Doing this once over the Hetzner and Clerk readers found six defects that running the same contracts had never tripped, so it is worth doing again whenever a reader or a contract changes.

A fake must not invent a rule the system does not have. Tying two of its fields together, so that one is decided by the other, looks like tidiness and is really a constraint: a test can then only ever see the pairs that rule allows, and the pairs it forbids are exactly where the code has never been tried. Clerk says whether somebody uploaded a picture in one field and where to find one in another, and it fills the second even when the first is false; a fake that derived one from the other would have hidden that from every test forever.

A fake hides a defect by being unable to produce a value the description permits. These are the ones known to be unreachable today, and each is a path nothing exercises: a Hetzner list that comes back empty, a server type that is not the one asked for, an image that is deprecated or not `available`, a firewall with no labels or another controller's, an action that is `running` or `error`, a second page of anything, a 429 with `Retry-After`, and a `user.deleted` event with no `data.id`. Widening a reply builder so a test can express one of these is worth more than another test of what it can already say.

There is a trap in all of this worth naming: if the same wrong description both shapes the fake and judges our requests, the two agree with each other and neither is right. Only the real system settles that. We have run against real Hetzner; we have not run against real Clerk, so Clerk's contract proves shape and nothing more.

## Hetzner

No test reaches Hetzner. A run starts a fake on loopback and gives the deployment its address in `HCLOUD_FAKE_URL`, with a token that is not a token. Hetzner's own address is built in and no deployment can replace it: the variable accepts only `127.0.0.1` or `[::1]`, so a deployment that sets it by mistake reaches nothing and sends nothing anywhere.

The fake answers what Composery asks, and produces what Hetzner cannot be asked for: a reply that never arrives. It never decides whether a test passes.

Tests of the worker wait on the deployment's own pacing: each step waits its own delay, and requests are paced by the budget the fake states on every reply, as Hetzner does. One run shares one deployment and one budget, so a test's bound must hold with the tests before it having spent some of it. A test may ask for a sweep, but not faster than the deployment's own pace, or the worker starves.

The same tests can meet Hetzner itself, and never by accident. Given a token in `.env.test` and `HCLOUD_MODE=real` for that run, the fake passes every request on to Hetzner and brings back exactly what Hetzner said: the tests do not change, the contract still holds both halves, and a test that loses a reply loses a real one. The run makes its own firewall, labels everything it creates with its own identity, removes all of it at the end, and removes what a killed run left behind, so anything still in that project is a leak. `docs/setups/hetzner-cloud.md` says what the project needs. The whole of `tests/convex/allocations` passed against a real project on 19 September 2026, which is what proved the firewall is found by its label at a provider that answers, that rules taken off a real server go back on, and that a run leaves nothing behind. Two defects only that run could find were fixed on the way: a control that edited this fake's own memory and changed nothing at Hetzner, and one that returned before Hetzner had carried the change out.

## Clerk

By default no test reaches Clerk. A run starts a fake on loopback and gives the deployment its address in `CLERK_FAKE_URL`, under the same rule as Hetzner's.

Clerk's own client builds our requests, so checking those checks Clerk's code, not ours. What is worth checking is everything we accept: the client reads a reply without validating it, so a field a fake invents would never be refused, and a hand-written webhook body would never be questioned. Both are held to Clerk's published descriptions of its backend API and of its events.

The version of Clerk's API is pinned by the one its own client asks for. The fake refuses a request that carries any other, so an upgrade that changes it says so rather than quietly leaving the contract behind.

The same tests can meet Clerk itself, given `CLERK_SECRET_KEY` and `CLERK_FRONTEND_API_URL` in `.env.test` and `CLERK_MODE=real` for that run. Accounts are then real: the run makes them through Clerk's own API, marks each with an `external_id` of its own, and signs in by asking Clerk for a session and a token for it, which Clerk documents for tests and allows on a development instance alone. So a signed-in test takes the verification path a signed-in person takes, down to whose key signed the token. Every account the run made is deleted at the end, and what a killed run left behind goes first: a development instance holds a hundred accounts, and one that fills up refuses sign-ups.

The account tests run that way only when a person explicitly sets `CLERK_MODE=real` and supplies both Clerk values. They then exercise accounts Clerk creates and tokens it mints. The scripted account and webhook tests are skipped in that mode, because their controls intentionally change Clerk's replies; the real run cannot prove those scripted failure paths.

Two things such a run does not cover, and it says so rather than passing quietly.

A test that scripts Clerk cannot run against Clerk: an account that is there, one that is gone, a refusal, keys from another instance. Those are what `tests/convex/clerk.test.ts` and `tests/convex/clerk_http.test.ts` are made of, and each test in them is skipped and reported when the run meets Clerk. The controls behind them refuse too, so a test that reaches for one is told which run it belongs in rather than changing a fake nobody is reading.

Clerk delivering a webhook is the other. Those arrive over the internet, and a test runs a backend on this machine. The webhook tests sign the body themselves, which proves what the route does with an event and never that Clerk sent one.
