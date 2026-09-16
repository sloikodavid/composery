# OpenAPI Contract Practices

Source: https://chatgpt.com/share/6aaa268b-5c0c-83eb-a140-7e7733009709

---

## Turn 1: User

_2026-09-16T05:11:44.495Z_

Teams sometimes commit a trimmed copy of a third-party API's OpenAPI description into their repository and check two things against it: the requests their own code sends, and the replies their in-repo fake of that vendor returns. Survey how this is actually done in the wild. Where does the pinned file live relative to tests and to the generator that produces it; how is drift from the vendor detected and reviewed; what is this practice called and how does it relate to consumer-driven contract testing tools like Pact, Prism, Schemathesis and Microcks; and — most importantly — how do teams record a justified difference between what a vendor's description claims and what the vendor's service actually does, including whether a recorded exception that is no longer needed is treated as a failure. Give concrete public examples with sources, and report where the practice is considered a bad idea.

---

## Turn 2: ChatGPT

_2026-09-16T05:11:43.206Z_

I’ll look for public repos that pin or generate a reduced OpenAPI schema, then trace how they validate outbound requests, fake responses, drift, and exception lifecycle. I’ll also separate this from broader “contract testing” terminology so the comparison to Pact/Prism/Schemathesis/Microcks stays precise.

---

## Turn 3: ChatGPT

_2026-09-16T05:12:06.456Z_

A useful distinction is emerging: there are really two layers. The vendored/trimmed OpenAPI file is usually treated as a **test fixture or generated artifact**, while disagreements with upstream are better kept as a **patch/overlay/waiver layer** rather than silently editing the fixture; that separation is what makes vendor drift reviewable.

---

## Turn 4: ChatGPT

_2026-09-16T05:13:29.971Z_

I found one unusually complete public example worth drilling into rather than just citing its README: an unofficial dev.to client keeps the upstream spec, a machine-readable overlay of corrections, recorded fixtures, and CI drift checks separately. I’m checking whether its exception entries are merely documented or actively proved/removable in CI.

---

## Turn 5: ChatGPT

_2026-09-16T05:16:39.625Z_

Yes. This is a recognizable practice in public repositories, but it does **not** have one universally agreed name. The most accurate description is usually **vendored/pinned OpenAPI + schema-based contract/conformance tests**. When the spec is reduced to the operations a client uses, “curated” or “trimmed OpenAPI” also appears. It is importantly different from Pact-style **consumer-driven contract testing**.

The strongest pattern I found is:

> **verbatim upstream snapshot → deterministic filter/overlay → composed test contract → client/fake tests**, with a separate job that checks both **upstream-description drift** and, where feasible, **live-service drift**.

The important refinement is that a vendor discrepancy should normally be represented as a *small, reviewable, falsifiable exception* layered over the upstream snapshot—not baked invisibly into a forked copy.

## What public repositories actually do

| Example | Where the spec lives | Generator / transformation | Tests and drift |
|---|---|---|---|
| **svyatov/devto-client** (third-party dev.to/Forem client) | `spec/api_v1.json` is the pinned upstream; `spec/overlay.json` holds corrections; `spec/composed.json` is generated | `scripts/compose-spec.ts`, then `openapi-typescript` | Recorded live replies are in `tests/fixtures/recorded`; tests live in `tests/`. A daily job fetches Forem's current spec, structurally diffs it against the pin, and reports stale recordings; a separate manual “reality check” re-records dev.to replies and runs them against the composed spec. ([GitHub](https://github.com/svyatov/devto-client?utm_source=chatgpt.com)) |
| **openintegrations/openSDKs / Slack** | Both `slack.orig.oas.json` and the derived `slack.oas.json` sit at the SDK package root | `src/slack.oas.ts` imports the original and post-processes it; generated types are next to the spec | The `download` command is the networked acquisition step; generation is intentionally offline. The transform removes Slack's per-operation `token` parameter and derives scope metadata. ([GitHub](https://github.com/openintegrations/openSDKs?utm_source=chatgpt.com)) |
| **StackQL OpenAI provider** | Vendor spec is pinned by commit and hash in `provider-dev/config/spec_pin.json`; filtered artifacts remain under `provider-dev/` | `provider-dev/scripts/clean_specs.mjs`, normalization, then provider generation | `npm run fetch-spec -- --check` is a non-writing drift check; refreshes are explicitly reviewed diffs. Exclusions are deterministic and reason-coded in code plus `filter_report.csv`. It also has mock integration tests and live smoke tests. ([GitHub](https://github.com/stackql-registry/stackql-provider-openai/blob/main/README.md?utm_source=chatgpt.com)) |
| **Tectalic public OpenAI PHP client** | A copy lives directly under `tests/openapi.yaml` | No elaborate transform layer in the documented test setup | CI starts `prism mock tests/openapi.yaml`, then runs the integration tests against the generated fake rather than OpenAI. This is the “test fixture colocated with tests” variant. ([GitHub](https://github.com/tectalichq/public-openai-client-php/blob/main/README.md?utm_source=chatgpt.com)) |

The layouts cluster into two styles. In SDK-generator repositories the OpenAPI tends to live with the **generation inputs** (`spec/`, `api_reference/`, `provider-dev/`, or package root), with tests referring into that area. In repositories where the spec exists only to drive an integration fake, putting it under `tests/` is common. The former scales better once you need provenance, filtering and vendor-drift review.

A useful producer-side analogue is OpenAI's own Python/CLI repositories: the transformed OpenAPI is under `api_reference/`, while test scripts live separately. The Python mock launcher even compares the checked-in transformed spec's hash with generation metadata and refuses to start if they disagree. ([GitHub](https://github.com/openai/openai-python/blob/main/scripts/mock))

## Drift: there are actually three kinds

A mature setup distinguishes **upstream-description drift**, **derived-artifact drift**, and **service-reality drift**.

For upstream-description drift, the robust pattern is to pin a commit/hash, periodically fetch the current vendor document, regenerate/filter deterministically, and expose the resulting diff for review rather than silently taking the update. StackQL states this explicitly: refreshes are “reviewed diffs, never silent regenerations.” ([GitHub](https://github.com/stackql-registry/stackql-provider-openai/blob/main/README.md?utm_source=chatgpt.com)) The dev.to client runs its upstream check daily and creates or refreshes one issue containing the structural changes and stale-fixture “shot list”; a clean run closes it. 

Derived-artifact drift is simpler: rerun the generator in CI and require `git diff --exit-code`, or record a hash tying generated output to its input. The dev.to client has a `check:drift` script that regenerates signatures/schemas/routing and fails on a Git diff. 

Service-reality drift is the one a spec-only job cannot see. The dev.to project explicitly calls this out: the spec can remain unchanged while the server behavior changes, so its manual reality job re-records real dev.to responses into an ephemeral `tests/fixtures/recorded` tree and reruns the conformance tests. A failure raises a “Server reality drift detected” issue.  That extra independent oracle is important; without it, the client and fake can both agree with the same wrong document.

## Recording “the vendor's spec is wrong”

This is where the dev.to repository is unusually instructive. Its `spec/overlay.json` entries aren't simply arbitrary patched schema fragments. An entry contains:

```json
{
  "target": "/some/json/pointer",
  "expect": { "...the upstream shape this patch assumes..." },
  "reason": "why the upstream description is wrong",
  "patch": { "...the observed/corrected shape..." },
  "provenance": {
    "instrument": "devto-fixture | local-forem | forem-source | spec-structure",
    "forem": "optional pinned commit",
    "corroborated": true
  }
}
```

Those semantics are enforced in the composer: `expect` is asserted against the unmodified upstream node before applying the patch; `null` means “this node must currently be absent.” A changed or dangling upstream target therefore fails composition instead of allowing the patch to slide onto some new meaning. Each correction also carries a non-empty reason and provenance identifying whether the evidence came from an actual dev.to recording, a pinned local Forem, source code, or inspection of the spec itself. 

That is very close to what I would call a **falsifiable contract waiver** rather than a normal patch.

Most importantly, that repository also implements the stale-exception check you asked about. During composition, if the upstream node already equals the patch value, the entry is classified as `deletable`; the real-spec test asserts that the current overlay contains **no deletable entries**. In other words, “upstream now agrees with our correction but we forgot to remove the correction” makes the test suite fail. 

There are two distinct stale cases worth handling:

1. **The upstream document changed under the waiver.** The `expect` precondition should fail. A human decides whether the upstream fix supersedes the waiver, conflicts with it, or merely rearranged the schema.
2. **The vendor has incorporated exactly your correction.** Applying your patch is now a no-op. Treat that as a stale waiver and fail CI with “remove this exception.”

The OpenAPI ecosystem now has a standardized mechanism for the transformation half of this design: **OpenAPI Overlay 1.0** defines a separate JSON/YAML document containing repeatable `update`/`remove` actions applied to a base OpenAPI description. ([OpenAPI Initiative Publications](https://spec.openapis.org/overlay/v1.0.0.html?utm_source=chatgpt.com)) The standard itself doesn't provide the dev.to project's `expect`, evidence, or stale-waiver semantics, so a team wanting those properties needs conventions/extensions or a wrapper around the overlay processor.

Keeping the modification separate is increasingly explicit guidance for third-party specs. Aklivity, for example, says directly that hand-patching a vendored/third-party document means forking something that is supposed to remain synchronized, requiring every upstream update to be manually reapplied; it uses an overlay instead. ([Aklivity Docs](https://docs.aklivity.io/latest/ai-gateway/mcp-gateway/openapi-overlay/?utm_source=chatgpt.com))

## Should an exception that stops being necessary fail?

For a **deterministic targeted waiver, yes**. There is good precedent beyond OpenAPI. The Model Context Protocol conformance suite has an expected-failures YAML baseline where all four states are explicit: expected failure continues to fail → success; new failure → failure; normal pass → success; and, importantly, **an expected failure that starts passing → failure, because the baseline is stale and must be removed**. ([GitHub](https://github.com/modelcontextprotocol/conformance?utm_source=chatgpt.com)) This is essentially `xfail(strict=true)` semantics.

Schemathesis deliberately makes a finer distinction. It supports a committed baseline of known API failures, and `--baseline-prune` removes an entry only when its operation was actually exercised and the failure failed to reproduce. An *unobserved* entry is not automatically declared stale because property-based input generation is randomized—the run may simply not have generated the witness again. ([Schemathesis](https://schemathesis.readthedocs.io/en/latest/guides/baseline/?utm_source=chatgpt.com))

That gives a useful rule: **fail on stale exceptions only when you have deterministically retested the exact condition the exception covers**. For a Schemathesis fuzz finding, “not seen today” isn't proof. For a specific `/users/{id}` field discrepancy with a saved response/reproduction case, it can be.

## Relation to Pact, Prism, Schemathesis and Microcks

These tools occupy overlapping but different positions.

**Pact** is the odd one out conceptually. Pact calls itself code-first, consumer-driven contract testing: executing the consumer tests creates concrete request/response interactions, and the provider verifies those interactions. It explicitly contrasts Pact contracts with a static OAS document. Pact's FAQ goes as far as saying that generating a Pact contract from Swagger/OpenAPI defeats the point and is like “marking your own exam.” ([Pact Docs](https://docs.pact.io/?utm_source=chatgpt.com)) So a pinned vendor OpenAPI checked against your client is **not Pact-style CDC**. In Pact's vocabulary, checking a provider against OpenAPI is closer to *provider contract testing*; Pact notes that this alone does not prove consumers are using the provider correctly. ([Pact Docs](https://docs.pact.io/?utm_source=chatgpt.com))

**Prism** is almost exactly the mechanical tool for the OpenAPI approach. Its mock mode turns the description into a fake server; its validation proxy examines both requests going to an implementation and responses coming back, reporting discrepancies with the same OpenAPI document. It can be inserted into an existing E2E suite with `--errors` so mismatches fail tests. ([GitHub](https://github.com/stoplightio/prism/blob/main/README.md?utm_source=chatgpt.com)) This is therefore **spec-driven contract/conformance testing**, not consumer-driven contracts.

**Schemathesis** treats OpenAPI principally as a generator and oracle for testing an actual implementation. It creates valid/invalid/property-based requests and checks response status codes, response schemas, headers and server errors. ([Schemathesis](https://schemathesis.readthedocs.io/en/stable/reference/checks/?utm_source=chatgpt.com)) You can also graft response validation onto an existing test suite. ([Schemathesis](https://schemathesis.readthedocs.io/en/stable/guides/schema-conformance/?utm_source=chatgpt.com)) It is especially useful for your “is the vendor really behaving like this description?” leg.

**Microcks** combines the roles more explicitly: it turns OpenAPI examples into mocks *and* uses the contract/examples to test an implementation for conformance. Its documentation describes the latter explicitly as contract/conformance testing. ([Microcks](https://microcks.io/documentation/references/artifacts/openapi-conventions/?utm_source=chatgpt.com)) Thus Microcks is probably the closest off-the-shelf analogue to maintaining one artifact for both a development fake and provider-conformance tests.

## Where the approach becomes a bad idea

The core problem is **correlated oracles**. If the same wrong OpenAPI description generates the fake *and* validates your consumer, your client can pass perfectly against the fake while failing against the real vendor. Pact's documentation makes essentially this criticism of static OpenAPI comparison: it gives a weaker guarantee because it depends on the actual provider not drifting from the published description. ([Pact Docs](https://docs.pact.io/blog/2024/09/30/pact-open-source-update-sept-2024?utm_source=chatgpt.com))

Pact's FAQ is even more pointed about using a vendor schema as the origin of a supposedly consumer-driven contract: deriving the contract from Swagger does not demonstrate that the actual consumer and actual provider are compatible. ([Pact Docs](https://docs.pact.io/faq?utm_source=chatgpt.com))

There are several concrete versions of the same trap:

- **Hand-editing the vendored spec.** You lose the distinction between vendor changes and local corrections and eventually cannot tell whether a diff is upstream drift or your own fork. OpenAPI Overlay exists specifically to keep such transformations separate, and third-party tooling explicitly recommends that separation. ([OpenAPI Initiative Publications](https://spec.openapis.org/overlay/v1.0.0.html?utm_source=chatgpt.com))
- **Trimming without a reproducible filter.** A hand-cut 500-line spec can quietly omit a newly important status/field forever. StackQL's answer is deterministic, reason-coded filtering rather than an opaque edited subset. ([GitHub](https://github.com/stackql-registry/stackql-provider-openai/blob/main/README.md?utm_source=chatgpt.com))
- **Testing only against the generated fake.** Tectalic's Prism setup is fast and useful, but on its own says nothing about whether today's OpenAI service still agrees with `tests/openapi.yaml`; the remedy is an independent live/replay conformance leg. ([GitHub](https://github.com/tectalichq/public-openai-client-php/blob/main/README.md?utm_source=chatgpt.com))
- **Putting a validation proxy in production's critical path.** Prism itself suggests using the proxy in development/staging/pre-production and says it is probably best kept out of production. ([GitHub](https://github.com/stoplightio/prism/blob/master/docs/guides/03-validation-proxy.md?utm_source=chatgpt.com))
- **Accepting “known violations” forever.** Once a waiver becomes an unconditional ignore or broad validator disable, the test has ceased to describe a contract. Schemathesis' baseline metadata/expiry/pruning and the dev.to `expect`+no-op tests are much healthier models. ([Schemathesis](https://schemathesis.readthedocs.io/en/latest/guides/baseline/?utm_source=chatgpt.com))

So I would treat the architecture as sound when the local file is a **reproducibly derived, reviewable test contract with an independent reality check**. I would treat “download vendor Swagger once, edit it until the fake works, and make all integration tests point at that fake” as an anti-pattern.

### A useful canonical form

If designing this today, I'd make the repository boundary explicit:

```text
contracts/vendor-x/
    upstream.openapi.yaml        # verbatim, pinned
    selection.yaml               # operations/components we consume
    reality.overlay.yaml         # factual vendor-description corrections
    tooling.overlay.yaml         # generator/ergonomic corrections
    pin.json                     # upstream commit/hash/date
    composed.openapi.yaml        # generated; optionally committed

scripts/
    fetch-vendor-x
    compose-vendor-x
    check-vendor-x-drift

tests/
    contract/                    # assert actual client requests
    fake/                        # assert fake responses
    fixtures/vendor-x-live/      # independent observations/repros
```

For a **reality** exception I would require an ID, target, old-value precondition, replacement, reason, evidence/reproducer, observation date/vendor revision, and upstream issue if one exists. CI should prove that every exception still changes something; a deterministic exception that has become unnecessary should be a red build saying **“waiver is stale; delete it.”** Keep purely ergonomic/tooling overlays in a different category, because those may intentionally remain even after the vendor's description is factually correct.

That separation—**upstream truth claim, consumer subset, reality corrections, tooling transforms, and independent observations**—is the main difference between this being a useful lightweight contract system and merely testing your code against a sophisticated mock of your own assumptions.
