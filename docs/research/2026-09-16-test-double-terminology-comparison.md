# Test Double Terminology Comparison

Source: https://chatgpt.com/share/6aa9f9d0-fc00-83eb-b958-639664e256cc

---

**User**

Terminology for test doubles in current practice (2024-2026): where "fake", "stub", "mock"
and "simulator" are used consistently and where they are not, and what large codebases name
the component that answers for a third-party service in tests.

---

**ChatGPT**

I’ll separate the textbook taxonomy from what teams actually name things in 2024–2026, then look at representative large codebases and service-testing tools. The key distinction is likely “role/behavior” versus “deployment shape” (object double vs HTTP/service stand-in).

---

**ChatGPT**

The evidence already shows the terminology split clearly: Google/Fowler preserve a narrow taxonomy, while major frameworks and Microsoft explicitly use broader meanings. At the service boundary, names shift again—`FakeUpstream`, `mock server`, and `emulator` all appear in production-scale projects.

---

**ChatGPT**

In 2024–2026 practice, there is still **no universally enforced vocabulary**. The Meszaros/Fowler taxonomy remains the clean conceptual reference, but mainstream frameworks and large codebases routinely bend it—especially the word **mock**.

| Term | Narrow / textbook meaning | Current real-world consistency |
|---|---|---|
| **fake** | A working alternative implementation, usually simplified or in-memory | **Fairly consistent, but not universal** |
| **stub** | Supplies predetermined behavior/results; the test normally does not verify interactions against it | **Fairly consistent when people deliberately distinguish doubles** |
| **mock** | A double whose expected interactions are part of the test's assertions | **Highly inconsistent**; frequently means almost any substituted dependency |
| **simulator** | Not one of the classic test-double categories; imitates a system's behavior | **Loose term**, especially for process/network/system-level replacements |
| **emulator** | Usually a standalone replacement intended to reproduce a real service/environment with relatively high fidelity | More consistently used for service/platform substitutes than *simulator* |

The classic distinction is still exactly what Fowler documents: a **fake** has a working but production-unsuitable implementation, a **stub** gives canned answers, and a **mock** carries expectations whose satisfaction is verified. ([martinfowler.com](https://martinfowler.com/articles/mocksArentStubs.html?utm_source=chatgpt.com)) Google's testing guidance uses essentially the same distinction, including in its 2024 advice: prefer the real implementation, then a **fake**, and only then a **mock**; Google explicitly describes configuring a mock's behavior as **stubbing** it. ([Google Testing Blog](https://testing.googleblog.com/2013/07/testing-on-toilet-know-your-test-doubles.html?utm_source=chatgpt.com))

### Where the terminology breaks down

**`mock` is the main casualty.** In many ecosystems it has become the generic word for "thing replacing another thing in a test."

Python's `unittest.mock`, for example, explicitly says its `Mock` class is intended to replace the use of "stubs and test doubles"; the same object can return configured values and record calls for assertions. ([Python documentation](https://docs.python.org/3.10/library/unittest.mock.html?utm_source=chatgpt.com)) Mockito similarly creates an object called a **mock**, then distinguishes operations performed on it as **stubbing** (`when(...).thenReturn(...)`) and **verification** (`verify(...)`). ([Mockito](https://site.mockito.org/javadoc/current/org/mockito/Mockito.html?utm_source=chatgpt.com)) Jest's current `Mock` functions likewise both provide return values and record calls; its documentation even says mock functions are also known as spies. ([Jest](https://jestjs.io/docs/mock-function-api?utm_source=chatgpt.com))

So in ordinary Python/JavaScript/Java conversation, "mock the payment client" often means simply **replace it with a programmable test double**, not necessarily a Meszaros-style interaction-expectation mock.

Microsoft goes further and explicitly warns that testing literature and tools use **fake, mock, and stub inconsistently**. Its current .NET guidance uses `fake` as a broader term covering both stubs and mocks, while acknowledging that Fowler/Meszaros use `fake` much more narrowly. ([Microsoft Learn](https://learn.microsoft.com/he-il/dotnet/core/testing/unit-testing-best-practices?utm_source=chatgpt.com))

There are still ecosystems that preserve the distinction strongly. Sinon currently defines a **stub** as a function with preprogrammed behavior and a **mock** as something carrying preprogrammed expectations that can fail the test if those expectations aren't met. ([SinonJS](https://sinonjs.org/concepts/stubs/?utm_source=chatgpt.com))

### Once the double becomes an HTTP server, terminology gets even looser

This is the interesting case in your question: something that **answers on behalf of a third-party service**.

Large systems tend not to worry much about whether the server satisfies the philosophical definition of `Stub` versus `Mock`. They name it according to one of several practical conventions.

**Envoy uses `FakeUpstream`.** Its integration-test framework literally starts "fake upstreams"; `FakeUpstream` accepts real network connections from the Envoy instance and lets tests receive requests and send responses. ([GitHub](https://github.com/envoyproxy/envoy/blob/main/test/integration/README.md?utm_source=chatgpt.com)) This is a very representative large-C++-codebase convention:

`Fake<ServiceRole>` / `FakeUpstream` / `FakeFooService`

Here **fake** means "a controllable test implementation standing where the real system would be," without requiring the strict Fowler property that it implement substantial realistic behavior.

**Stripe calls its equivalent `stripe-mock`.** Stripe describes it as a "mock HTTP server that responds like the real Stripe API." Yet Stripe also says its responses are substantially hard-coded, it is stateless, and it does *not* attempt to reproduce actual Stripe API behavior. Under the strict Meszaros terminology, much of that behavior looks closer to a **stub server** than a mock. ([GitHub](https://github.com/stripe/stripe-mock?utm_source=chatgpt.com)) This is a good concrete demonstration that *mock server* in industry does not imply interaction-expectation verification.

**WireMock uses both words at different levels.** The product describes itself as an **API mocking** tool / mock API server, while individual request→response definitions are explicitly called **stubs**, configured through `stubFor`. ([WireMock](https://wiremock.org/docs/overview/?utm_source=chatgpt.com)) That's a particularly useful modern convention:

> **mock server** = the overall test-service facility  
> **stub/stubbing** = configuring particular responses

Generic infrastructure often avoids the taxonomy altogether. Go's standard library simply calls its facility `httptest.Server`—an HTTP **test server**—rather than deciding whether it is a fake, stub, or mock. ([Go Packages](https://pkg.go.dev/net/http/httptest?utm_source=chatgpt.com)) Kubernetes code frequently combines names such as `fakeRuntime`, `fakeKubelet`, and `testHTTPServer`, illustrating the same tendency: use **fake** for semantic substitutes and **test server** for the network container. ([GitHub](https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/server/server_test.go?utm_source=chatgpt.com))

### Simulator and emulator

I would not put **simulator** on the same taxonomy axis as fake/stub/mock.

`fake`, `stub`, and `mock` primarily describe the **testing role/verification style** of a replacement. `simulator` or `emulator` usually describes **what sort of executable thing it is and how much behavior it attempts to reproduce**.

Cloud platforms increasingly use **emulator** for a reasonably complete standalone local service. Firebase's Local Emulator Suite, for example, supplies service emulators that accept SDK and REST calls like the production Firebase services and can be used as integration-test backends. ([Firebase](https://firebase.google.com/docs/emulator-suite?utm_source=chatgpt.com)) AWS documentation makes the distinction explicit: mocks are normally created as part of test code, whereas **emulators are standalone applications exposing functionality similar to the systems they mimic**. ([AWS Documentation](https://docs.aws.amazon.com/lambda/latest/dg/testing-guide.html?utm_source=chatgpt.com)) LocalStack likewise describes itself in terms of **emulating AWS services** and even distinguishes simple mocked resources from deeper emulation internally. ([Docs](https://docs.localstack.cloud/aws/?utm_source=chatgpt.com))

`simulator` is looser. You see it when the intent is "produce plausible/systematic behavior or conditions" rather than "be a compatible local implementation." API-mocking products themselves freely say they "simulate" APIs even while naming the thing a mock. WireMock is an example. ([WireMock](https://wiremock.org/docs/faq/?utm_source=chatgpt.com))

### What I would expect in a large codebase

For a component that listens on HTTP/gRPC/etc. and answers instead of a third-party service, these names communicate the most information:

- **`FakeStripeServer` / `FakePaymentService`** — good default for a reusable, programmable, possibly stateful test implementation. This is close to the Envoy/Google style.
- **`StripeStubServer`** — especially precise if it is principally request-match → canned-response mappings.
- **`StripeMockServer`** — extremely common and immediately understandable, but does *not* tell a reader whether interactions are actually verified.
- **`StripeEmulator`** — appropriate if it implements a substantial portion of Stripe's semantics and is intended to behave like a local instance of the real service.
- **`StripeTestServer`** — deliberately taxonomy-neutral and often the safest infrastructure name.
- **`StripeSimulator`** — understandable, but I'd reserve it for something deliberately modeling Stripe-like scenarios/behavior rather than attempting API fidelity.

So if you're trying to establish terminology in a new large codebase, I would use **test double** as the umbrella term, preserve **stub/mock/fake** in the Fowler/Google sense for object-level discussion, and name an HTTP replacement according to its actual fidelity:

**canned responses → `FooStubServer`; reusable behavioral implementation → `FakeFooServer`; high-fidelity standalone reproduction → `FooEmulator`.**

I would treat **`MockFooServer` as conventional but semantically ambiguous**, rather than incorrect. That matches what the 2024–2026 ecosystem actually looks like rather than pretending the classical vocabulary won.
