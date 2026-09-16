# Compare API Testing Approaches

Source: https://chatgpt.com/share/6aa9f9bf-75a0-83eb-8056-741576c3c521

---

## Turn 1: User

_2026-09-16T02:04:21.446Z_

Compare, with real examples from open-source repositories: projects that test against a
locally run fake of a third-party HTTP API, and projects that record and replay real traffic.
What breaks in each approach over time, and what do maintainers say about keeping the fake
honest?

---

## Turn 2: ChatGPT

_2026-09-16T02:04:19.944Z_

I’ll ground this in repo code, test fixtures, and maintainer discussions rather than generic testing advice. I’m looking for examples where the fake is a real local HTTP process, and where recordings are checked into the repository and replayed offline.

---

## Turn 3: ChatGPT

_2026-09-16T02:04:43.503Z_

The strongest “fake” examples are Stripe’s SDKs using `stripe-mock` and LocalStack emulating AWS. For replay, Gumroad’s Stripe/PayPal tests and Canonical’s Launchpad client are unusually explicit about when recordings must be regenerated. The interesting distinction is that fakes drift semantically; recordings drift temporally.

---

## Turn 4: ChatGPT

_2026-09-16T02:04:59.476Z_

There are two distinct failure modes here:

- A **local fake** tends to become a *plausible but wrong implementation* of the provider.
- **Record/replay** tends to become an *accurate fossil* of what the provider did at one point in time.

The open-source projects that have lived with these approaches for years reflect that difference quite clearly.

| Approach | Concrete OSS examples | What it catches well | What decays |
|---|---|---|---|
| Locally run API fake | Stripe SDKs → `stripe-mock`; LocalStack → AWS | request paths, serialization, protocol shape, broad offline integration flows | behavioral semantics, obscure errors, new provider features, API-version skew |
| Recorded real traffic | Gumroad → VCR for Stripe/PayPal; Canonical Launchpad → vcrpy; ChartMogul Go → go-vcr | actual payloads, headers, errors and provider quirks observed in reality | freshness, request matching, credentials/state needed to re-record, fixture secrecy |

### The local-fake side: Stripe is a particularly clean example

`stripe-go`, `stripe-ruby`, `stripe-node`, and `stripe-java` all run their test suites against the locally running `stripe-mock` server. In `stripe-go`, tests actually refuse to proceed with an old enough `stripe-mock`: the code has a `MockMinimumVersion`, specifically so a newer SDK feature doesn't merely produce a mysterious series of `404`s against an older fake. ([GitHub](https://github.com/stripe/stripe-go/blob/master/testing/testing.go))

That is a very concrete example of the first thing that breaks over time: **the client and fake get out of lockstep**. The SDK learns `/v1/something-new`; yesterday's fake has never heard of it.

Stripe has done a lot to reduce that drift. `stripe-mock` is generated from Stripe's OpenAPI description, and response fixtures are themselves derived from Stripe's API, so new resources, parameters and field types can flow into the fake mechanically rather than being hand-maintained. ([GitHub](https://github.com/stripe/stripe-mock))

But Stripe's own README is unusually candid about where this stops working. `stripe-mock` is stateless; POSTed data generally doesn't affect later calls, polymorphic endpoints only produce one alternative, it only models the latest API version, its validation is incomplete, and it generally can't produce requested error cases. Its responses have the correct *shape* but are explicitly not guaranteed to be realistic. ([GitHub](https://github.com/stripe/stripe-mock))

That means a test can stay green while the production integration is wrong in ways such as:

- the real API rejects a combination that the fake accepts;
- a create/read/update sequence depends on server state the fake never modeled;
- retry logic is wrong because the fake only returns success;
- an old Stripe API version behaves differently from the fake's latest-version model;
- a field is structurally valid but its real values or cross-field invariants differ.

Stripe therefore doesn't treat parity as a solved problem. The maintainers explicitly call `stripe-mock` a basic sanity-check tool and say sophisticated integration changes should still be tested against Stripe's real test mode; they warn that mock Stripe implementations can differ in subtle, potentially important ways. ([GitHub](https://github.com/stripe/stripe-mock))

### LocalStack shows what “keeping the fake honest” looks like when fidelity is the product

LocalStack has the harder problem: it is implementing a very large fake of AWS. Its testing rules essentially turn the real service into the oracle.

Their integration-test documentation says, “Ideally every integration is tested against real AWS.” ([GitHub](https://github.com/localstack/localstack/blob/main/docs/testing/integration-tests/README.md)) More interestingly, they record responses from AWS as snapshots and then compare LocalStack's response against them; the project says those AWS-validated snapshot tests are preferred because they increase parity. ([GitHub](https://github.com/localstack/localstack/blob/main/docs/testing/integration-tests/README.md))

Their current development instructions make the workflow explicit: capture AWS behavior first, compare it with the documentation, then run the same test against LocalStack. “Run new tests against AWS first” is listed as a best practice. ([GitHub](https://github.com/localstack/localstack/blob/main/AGENTS.md))

This tells you something important about maintainable fakes: **unit tests of the fake aren't enough**. If both the test expectation and fake implementation came from the maintainer's interpretation of the docs, they can agree perfectly while both disagree with reality. You need differential/conformance testing against the upstream service.

And real discrepancies continually appear. For example, a LocalStack issue reported a Step Functions/S3 error whose `cause` differed from real AWS—exactly the kind of detail an ordinary happy-path fake test can miss. ([GitHub](https://github.com/localstack/localstack/issues/12139?utm_source=chatgpt.com)) Other issues concern SDK-visible differences such as checksum behavior and even an integer-vs-float field type. ([GitHub](https://github.com/localstack/localstack/issues/6659?utm_source=chatgpt.com))

So, across Stripe and LocalStack, the maintainers' recipe for an “honest” fake is roughly: generate as much surface area as possible from the provider's machine-readable contract, make fake/client version skew visible, and continuously run parity tests against the real provider. Don't claim semantic fidelity you haven't measured.

### Record/replay: Gumroad gives a good picture of the maintenance burden

Gumroad records real Stripe, PayPal and other HTTP interactions with VCR and commits the cassettes. CI then replays them instead of calling those services. ([GitHub](https://github.com/antiwork/gumroad/blob/main/docs/testing.md?utm_source=chatgpt.com))

This eliminates a large category of fake bugs: if Stripe really returned a particular JSON structure and set of headers during recording, that is what the test gets. Nobody had to reverse-engineer that response.

But Gumroad's own instructions show what breaks instead. If code changes its parameters, the old cassette no longer matches. If code makes a previously absent external call, there is no recording for it. Their documented fix for changed API parameters is to delete the old cassette and re-record it; they also tell contributors to delete stale cassettes when the corresponding test or endpoint disappears. ([GitHub](https://github.com/antiwork/gumroad/blob/main/docs/testing.md))

Their most revealing rule is: **don't paper over a missing cassette by stubbing the API call; make the real request locally and record it.** ([GitHub](https://github.com/antiwork/gumroad/blob/main/docs/testing.md)) That is record/replay's equivalent of “keeping the fake honest”: keep the provenance chain from fixture → actual upstream response intact.

Canonical's Launchpad client says the same thing even more directly. Its test fixtures are generated by vcrpy from real Launchpad calls; when “the API has changed,” maintainers delete the relevant cassette and regenerate it using real credentials. ([GitHub](https://github.com/canonical/canonicalwebteam.launchpad))

So the characteristic long-term problem is not primarily incorrect simulated semantics. It is **silent staleness**: a five-year-old cassette can replay perfectly even though today's API no longer returns that response.

### ChartMogul exposes another replay problem: fixtures are production-like data

`chartmogul-go` uses ordinary local HTTP mocks for unit tests but `go-vcr` for integration tests against the real ChartMogul API. Its README specifically says to re-record affected integration tests when the Import API application changes—and warns contributors to remove API credentials from fixtures before committing them. ([GitHub](https://github.com/chartmogul/chartmogul-go))

That illustrates two replay-specific costs that a hand-written fake largely avoids:

1. **Re-recording needs access to reality.** Someone needs valid credentials, suitable test accounts/data, and possibly money/rate-limit budget.
2. **Reality may contain secrets or personal data.** A cassette is essentially a sanitized packet capture checked into Git. Headers, query strings, IDs, webhook secrets, tokens and response payloads all require scrutiny.

The VCR project itself eventually added automatic re-recording based on cassette age, which is an acknowledgement that recordings have a freshness dimension. ([GitHub](https://github.com/vcr/vcr/blob/master/CHANGELOG.md?utm_source=chatgpt.com)) A maintainer discussion also captures an architectural objection to enormous cassette suites: if minor HTTP implementation changes force hundreds of recordings to be regenerated, tests may have become overly coupled to *how* an abstraction performs its work rather than the abstraction's contract. ([GitHub](https://github.com/vcr/vcr/discussions/864))

### What actually rots

For a **fake**, the dangerous failure is a false sense of coverage. You add functionality to your application and faithfully add the same assumption to your fake. Tests pass, but neither has ever encountered the upstream service. The more behavioral the fake becomes—state machines, validation rules, retries, pagination, eventual consistency, idempotency, bizarre error semantics—the more you're maintaining a second implementation of somebody else's product.

For **record/replay**, fidelity is inverted. The individual response is unusually trustworthy, because it really happened. But the suite only knows about the tiny set of interactions that happened during recording, and it knows them as of a particular date. New upstream behavior will not make an offline replay test fail. In fact, one of replay's biggest virtues—determinism—is exactly what prevents it from detecting upstream drift.

There's also an interesting difference around request evolution. A fake can often tolerate harmless client changes if it implements a semantic parser. A cassette matcher may fail because an SDK started adding a query parameter, changed serialization, introduced a default header, or reordered calls. Conversely, loose cassette matching can do the opposite and accidentally replay a response for a request that is meaningfully different.

### The pattern mature projects converge on

These repositories don't really support “fake **versus** replay” as an exclusive choice. The durable arrangement is usually layered:

1. Keep most tests pure/unit-level.
2. Use a local fake for lots of cheap integration coverage, but narrowly define what it promises.
3. Validate the fake against the provider's published schema where possible.
4. Maintain a smaller corpus of **real-provider contract/parity tests** that exercises the assumptions most likely to hurt if wrong.
5. If using recordings, periodically regenerate or run those scenarios live so a cassette cannot remain authoritative indefinitely.
6. Treat errors, pagination, state transitions, idempotency and versioning as first-class parity cases—not just successful CRUD.
7. Fail visibly on stale emulator versions or missing recordings rather than silently substituting another mock.

The clearest maintainer message comes from Stripe and LocalStack together: **a fake stays honest by having an external oracle**. Stripe deliberately limits what `stripe-mock` claims and points users back to test mode; LocalStack goes further and systematically captures AWS behavior and compares the emulator against it. ([GitHub](https://github.com/stripe/stripe-mock))

Record/replay moves the oracle into your repository, which gives you higher point-in-time realism for less emulator code—but then **freshness becomes your responsibility**. Gumroad's “re-record rather than stub,” Canonical's explicit regeneration on API changes, and ChartMogul's fixture-refresh instructions are all manifestations of that tradeoff. ([GitHub](https://github.com/antiwork/gumroad/blob/main/docs/testing.md))
