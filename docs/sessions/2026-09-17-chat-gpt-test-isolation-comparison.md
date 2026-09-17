# Test Isolation Comparison

Source: https://chatgpt.com/share/6aac1456-f3a4-83eb-ae59-5eec59b8dad0

---

## Turn 1: User

_2026-09-17T16:14:36.391Z_

Research how, as of September 2026, software projects distinguish and physically isolate tests that call a real third-party service with a real credential from tests that run entirely on the local machine. Cover: Google's hermetic vs. non-hermetic tests and its test-size categories; Bazel's `external` and `requires-network` tags; HashiCorp's acceptance tests and the `TF_ACC` environment variable; Kubernetes e2e tests; Pulumi's integration tests; the AWS CDK's integ tests; Stripe's and Twilio's client libraries; and Go build tags.

For each one, note:

- the terminology used
- whether these tests sit in a separate directory, are marked by a file suffix or tag, or are gated by an environment variable
- what the default test command actually executes
- how the project guards against running them by accident
- how the credential gets supplied

Also call out any cases where a project renamed its test categories (and why), and any cases where a term caused confusion because it already meant something else within that same project.

---

## Turn 2: ChatGPT

_2026-09-17T16:14:37.818Z_

I’ll trace each project’s own docs/repository conventions and build a side-by-side matrix focused on physical isolation, default behavior, safeguards, and credential injection. I’ll also flag terminology changes and any overloaded terms that caused confusion.

---

## Turn 3: ChatGPT

_2026-09-17T16:15:02.211Z_

A first pattern is already clear: “networked” and “external” are not universally synonyms. In Bazel, for example, `requires-network` controls sandbox network access, while `external` means “has an external dependency” and, operationally, disables test-result caching rather than opting the test out of `bazel test` by itself.

---

## Turn 4: ChatGPT

_2026-09-17T16:17:47.028Z_

The strongest “physical isolation” mechanisms differ substantially: HashiCorp keeps live acceptance tests in ordinary Go test files but makes the test helper refuse to run them unless `TF_ACC` is set; Kubernetes and AWS CDK separate them into dedicated trees/commands; Go build tags go further by excluding tagged files from the test binary unless explicitly enabled. Stripe/Twilio are notable because their ordinary SDK tests generally point at local mock servers instead of treating a real account as the normal integration-test target.

---

## Turn 5: ChatGPT

_2026-09-17T16:21:22.903Z_

As of **September 2026**, there is no single industry convention for “this test talks to a real external service using a real secret.” Projects separate that risk along several independent axes: directory layout, test-runner metadata, build-time tags, explicit environment gates, and—in the SDK projects—changing the endpoint from a real service to a local mock.

The most important distinction is that **“integration,” “large,” “external,” “networked,” “e2e,” and “acceptance” do not mean the same thing**. In several of these projects, they deliberately do not.

### Comparison

| Project / mechanism | Terminology | How it is isolated | What the normal/default test path does | Accidental-run protection | How real credentials arrive |
|---|---|---|---|---|---|
| **Google** | **hermetic / nonhermetic** is one dimension; **small / medium / large** is another | Primarily test metadata/infrastructure policy, not a directory convention. Small tests cannot use network; medium can use localhost only; large can use remote network. | There is no public universal `google test` default. In Google's CI model, fast/reliable tests—usually small ones—are the natural presubmit set; nonhermetic/expensive large tests are often moved to separate post-submit builds. | Infrastructure can enforce size restrictions. In Google's Java example, a small test that attempts network access fails. Presubmit selection also keeps unreliable live-backend tests out. | Not specified by the taxonomy; credentials are service/test-environment specific. |
| **Bazel `external`** | Test has an **external dependency** | `tags = ["external"]` on the Bazel target | **Still runs** in an ordinary `bazel test //...` unless something else filters it. | `external` disables/overrides test-result caching; it is **not an opt-in safety gate**. Add `manual` or a negative `--test_tag_filters` policy if it must not run by default. | Bazel can pass secrets with `--test_env=NAME`, `--test_env=NAME=value`, or rule environment inheritance. |
| **Bazel `requires-network`** | Execution requirement meaning **needs external network** | `tags = ["requires-network"]` | Also **still runs** when selected. | It merely allows external networking from a sandbox. `block-network` does the opposite. It is not a “live test” marker. | Same general environment mechanisms; tag itself carries no credential. |
| **HashiCorp Terraform providers** | **acceptance tests**, normally `TestAcc…` | Usually ordinary `*_test.go` files, colocated with unit tests. The decisive gate is **`TF_ACC`**. | Plain `go test ./...` discovers them, but `resource.Test` / `ParallelTest` does not execute acceptance behavior unless `TF_ACC` is set. Unit and acceptance CI jobs can literally use the same Go command; acceptance adds `TF_ACC=1`. | Very strong double guard: explicit `TF_ACC`, plus provider `PreCheck` commonly checks required service credentials. HashiCorp explicitly says `TF_ACC` prevents unintended charges. | Provider-specific credentials, normally environment variables / normal provider auth. HashiCorp recommends a separate test account or namespace. |
| **Kubernetes** | **e2e**, plus node e2e, kubeadm e2e, integration tests | Strong **directory/package separation**: `test/e2e`, `test/e2e_node`, `test/e2e_kubeadm`, etc. | Kubernetes' normal unit-test package selection explicitly removes those packages, as well as `*/test/integration/*`, before running tests. | Physical separation plus explicit exclusion in the normal test script. Within e2e, Ginkgo also skips special `[Flaky]` / `[Feature:…]` cases unless requested. | Normally a **kubeconfig**; the e2e framework's `--kubeconfig` defaults from `KUBECONFIG` and describes it as containing auth info. In-cluster credentials can also be used. |
| **Pulumi** | **unit**, **property**, **integration**; core repo also uses both “integration” and “acceptance” job terminology | Public integration framework takes a directory containing a full Pulumi program. In Pulumi's own repo, larger suites are concentrated under `tests/` and separated from the fast-test target. Provider repos may add their own directory/tag conventions. | A standalone Pulumi integration test is just a Go test: `go test .` invoking `ProgramTest` really deploys. In the Pulumi repo, developers are directed to `make test_fast` for the ordinary fast path; broader suites have separate targets/CI jobs. | **No universal `TF_ACC` equivalent.** The separation is mostly suite/target structure. Service-specific tests can explicitly `Skip` when required credentials such as `PULUMI_ACCESS_TOKEN` are absent. | Cloud-provider credentials use that provider's normal mechanism. Pulumi-service-dependent cases use `PULUMI_ACCESS_TOKEN` (and sometimes `PULUMI_TEST_OWNER`). |
| **AWS CDK** | **unit tests** versus **integ tests** | Strong separation. Stable library integ tests are `integ.*.ts` under `packages/@aws-cdk-testing/framework-integ/test/...`; alpha-module integ tests are colocated but keep the `integ.*.ts` convention. The separately extracted CDK CLI repo goes further with `*.integtest.ts` in `@aws-cdk-testing/cli-integ`. | Normal module `yarn test` runs unit tests. Real CloudFormation deployment is an explicit `yarn integ ...` operation. CLI integ tests are explicitly documented as not part of the normal build. | Separate package + filename convention + separate runner. Real deploy also requires configured AWS credentials. | Normal AWS authentication: e.g. IAM Identity Center/SSO or `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, region, etc. |
| **Stripe SDKs** | Ordinary SDK tests; **stripe-mock** versus Stripe **testmode** | Usually not a separate “live tests” directory. The key boundary is the **endpoint**. Server-side SDK suites use local `stripe-mock`. `stripe-node` can switch the same tests to real Stripe testmode with an env var. | `just test` / `yarn test` in `stripe-node` expects `stripe-mock`, so ordinary development does not need a Stripe account. | No real key ⇒ local mock path. In `stripe-node`, opting into a real service requires deliberately setting `STRIPE_TEST_API_KEY`. | `STRIPE_TEST_API_KEY=sk_test_…`; importantly, this is a genuine Stripe **test-mode** secret key, not a production/live-mode key. |
| **Twilio SDKs** | Unit tests and, in tooling, **integration tests**—but “integration” can still mean a local mock | Client libraries use mock HTTP machinery; Twilio's OpenAPI generator documents integration tests against a local **Prism** server. | `twilio-node`: `npm test` runs Jest over `spec` (with `spec/cluster` explicitly excluded) plus TypeScript checks. `twilio-go`: `go test ./...`. Twilio's documented Prism integration workflow still runs locally. | Mock/custom HTTP client prevents a connection to Twilio. There is no public, general-purpose `TF_ACC`-style live-suite switch in the representative SDKs. | A genuinely live Twilio client uses `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`, or explicit constructor values. The README's “test your installation” SMS is a live manual smoke test, not the repository's default automated suite. |
| **Go build tags** | **build constraints / build tags**; arbitrary names such as `integration` or `acceptance` are project conventions | File-level `//go:build integration` etc. This is genuine **compile-time exclusion**. | `go test ./...` includes every matching `*_test.go` file whose build constraints are satisfied. A name like `foo_integration_test.go` has **no special meaning** and runs normally unless tagged. | Very strong when used correctly: the file is absent from the test binary until `go test -tags=integration …`. Often combined with a second runtime check for credentials. | Go prescribes nothing; usually `os.Getenv`, config files, workload identity, etc. |

### Google: hermeticity is not the same axis as test size

Google's terminology is especially useful because it separates two questions that projects often conflate.

A **hermetic test** is self-contained: it has no external dependency such as a production/live backend. Google recommends that *all* tests strive for hermeticity, including large ones. A **nonhermetic** test is therefore the natural description for a test that talks to a live third party. ([Abseil](https://abseil.io/resources/swe-book/html/ch11.html?utm_source=chatgpt.com))

Separately, Google classifies resource permissions as **small, medium, large**. The classic definition is: small gets no network; medium gets localhost only; large may use the network and external systems. The modern Software Engineering at Google treatment simplifies that to small = one process, medium = one machine, large = potentially multiple machines, while retaining the crucial remote-network boundary. ([Google Testing Blog](https://testing.googleblog.com/2010/12/test-sizes.html?utm_source=chatgpt.com))

So a test using a real SaaS API key is necessarily **nonhermetic** and effectively needs large-test capabilities, but **“large” does not itself mean live SaaS**. A large test can still spin up an entirely hermetic multi-process or multi-machine environment. Google Assistant is an explicit example where nonhermetic presubmit tests were moved to post-submit and the presubmit environment was made hermetic, cutting runtime dramatically and almost eliminating flakiness. ([Abseil](https://abseil.io/resources/swe-book/html/ch23.html?utm_source=chatgpt.com))

This taxonomy was deliberately introduced because terms such as “unit,” “integration,” “functional,” and “system” meant different things to different teams. Google's 2010 explanation opens by complaining about exactly that ambiguity; a 2011 description says Google used small/medium/large *instead of* code/integration/system terminology. The later SWE book refined this: **size** and **scope** are separate axes, so “unit/integration/e2e” can still describe scope while small/medium/large describes resources and execution constraints. ([Google Testing Blog](https://testing.googleblog.com/2010/12/test-sizes.html?utm_source=chatgpt.com))

### Bazel: two tags that look more safety-oriented than they are

Bazel's `external` tag is easy to misread. The Test Encyclopedia defines it as “test has an external dependency; disable test caching.” The build-reference behavior is to force such a test to execute regardless of `--cache_test_results`. It does **not** say “exclude this from normal tests.” ([Bazel Documentation](https://docs.bazel.build/versions/main/test-encyclopedia.html?utm_source=chatgpt.com))

Likewise, `requires-network` is an **execution requirement**: when sandboxing is active, it allows access to the external network. It does not assert that the target actually uses a SaaS service, does not pass a secret, and does not require explicit user confirmation. ([Bazel Documentation](https://bazel.build/reference/be/common-definitions?authuser=7&utm_source=chatgpt.com))

That matters because Bazel's `--test_tag_filters` and `--test_size_filters` defaults are empty. In other words, tagging something `external` or `requires-network` does not make `bazel test //...` inherently safe. If the project wants opt-in behavior, a more defensible pattern is `manual`, or a repository-wide default such as `--test_tag_filters=-external` with an explicit override for a live-test job. `manual` is the built-in tag that actually removes a target from wildcard patterns. ([Bazel Documentation](https://docs.bazel.build/versions/main/command-line-reference.html?utm_source=chatgpt.com))

There is also a genuine terminology collision: **“external” is already foundational Bazel vocabulary for external repositories/dependencies**, while the `external` *test tag* specifically has cache semantics. It is therefore a poor name to interpret as “real third-party credential required.”

### HashiCorp: the clearest explicit “dangerous test” switch

HashiCorp's Terraform provider convention is probably the closest fit to the exact problem in the question.

Acceptance tests are ordinary Go tests in ordinary `_test.go` files, usually named `TestAcc…`. They execute real Terraform plan/apply/refresh/destroy operations and can incur cloud costs. The special safety mechanism is not filesystem placement but the **`TF_ACC` environment variable**. HashiCorp explicitly says it is required and that its purpose is to stop developers incurring unintended charges while running other Go tests. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests?utm_source=chatgpt.com))

The contrast is particularly clean in HashiCorp's CI example:

```text
unit job:       go test -v -cover ./...
acceptance job: go test -v -cover ./...   + TF_ACC=1
```

So selection by filename is almost irrelevant: the same executable discovery path sees both, and the framework supplies the runtime interlock. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/sdkv2/testing/acceptance-tests?utm_source=chatgpt.com))

Credentials remain provider-specific, normally through the provider's standard environment variables. `PreCheck` is commonly where a provider asserts they exist before creating anything. HashiCorp also recommends a distinct provider account or namespace for testing. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/testing/acceptance-tests?utm_source=chatgpt.com))

There was a migration from SDKv2's testing machinery to the standalone **`terraform-plugin-testing`** module; HashiCorp says new testing features go into the latter. That was a framework/package migration, **not a rename from “acceptance tests” to something else**. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/plugin/sdkv2/testing/acceptance-tests?utm_source=chatgpt.com))

### Kubernetes: isolate by tree, then explicitly omit the tree

Kubernetes is the clearest directory-level example. Its normal Go package-discovery script says it filters out packages that “we don't want to run by default (i.e. are not unit-tests)” and expressly excludes `test/e2e`, `test/e2e_dra`, `test/e2e_node`, `test/e2e_kubeadm`, plus `k8s.io/*/test/integration/...`. ([GitHub](https://github.com/kubernetes/kubernetes/blob/master/hack/make-rules/test.sh?utm_source=chatgpt.com))

That gives it two protections: **physical placement** and **an explicit deny-list in the default runner**.

Cluster e2e tests take their cluster identity through kubeconfig. The current framework registers `--kubeconfig` with the value of `KUBECONFIG` and calls it a path containing embedded authentication information; client construction then loads that file. In-cluster credentials are another supported route. ([GitHub](https://github.com/kubernetes/kubernetes/blob/master/test/e2e/framework/test_context.go?utm_source=chatgpt.com))

One small directory-history wrinkle is useful when copying the convention: current Kubernetes documentation distinguishes shared cluster/node e2e material from node-exclusive suites, and identifies some content under the older `test/e2e/node` location as legacy/misplaced. In other words, even a mature project has had to refine what “e2e directory” means rather than treating one directory name as eternal architecture.

### Pulumi: “integration” genuinely means real cloud, but the framework is not itself an opt-in gate

Pulumi's public taxonomy is unusually explicit: **unit tests** are in-memory and mock all external calls; **property tests** provision real infrastructure; and **integration tests** provision real infrastructure and test it externally. Thus even Pulumi demonstrates that “not integration” does **not** imply local-only—property tests also touch real cloud resources. ([pulumi](https://www.pulumi.com/docs/iac/concepts/testing/?utm_source=chatgpt.com))

Its Go integration framework receives a directory containing a full Pulumi program and drives create/update/destroy. The official minimal example is executed simply with:

```text
go test .
```

So `ProgramTest` itself is **not** an environmental dead-man switch like `TF_ACC`; once you have put such a test into the package selected by `go test`, it deploys. ([pulumi](https://www.pulumi.com/docs/iac/guides/testing/integration/framework/?utm_source=chatgpt.com))

Pulumi's own monorepo compensates structurally. The current developer instructions identify `tests/` as containing integration and acceptance tests and distinguish `make test_fast` from `make test_all`; current CI has separate unit, integration and acceptance matrices. ([GitHub](https://github.com/pulumi/pulumi/blob/master/AGENTS.md?utm_source=chatgpt.com))

For Pulumi-service-dependent cases there *is* a secondary credential guard. `ProgramTest`'s setup notices `PULUMI_TEST_USE_SERVICE=true`; when service use is required but `PULUMI_ACCESS_TOKEN` is missing, its source explicitly describes skipping as an “escape hatch” so a local developer can run `make` without many token-related failures. Individual core integration tests likewise skip service cases when `PULUMI_ACCESS_TOKEN` or `PULUMI_TEST_OWNER` is missing. ([GitHub](https://github.com/pulumi/pulumi/blob/master/pkg/testing/integration/program.go?utm_source=chatgpt.com))

Cloud credentials themselves remain cloud-specific: the official AWS integration example lists configured AWS credentials as a prerequisite. ([pulumi](https://www.pulumi.com/dev/examples/testing-integration/?utm_source=chatgpt.com))

A terminology trap exists inside Pulumi itself: current repository material uses both **“integration” and “acceptance”** as CI/repository categories, while Pulumi's public testing guide gives “integration test” the specific meaning of a real deployment tested from the outside. You cannot safely infer credential behavior from one of those words alone. ([GitHub](https://github.com/pulumi/pulumi/blob/master/AGENTS.md?utm_source=chatgpt.com))

### AWS CDK: perhaps the strongest combination of directory + filename + command

For stable `aws-cdk-lib` modules, integration tests are under the dedicated `@aws-cdk-testing/framework-integ` package and use names such as `integ.destinations.ts`; current maintainer documentation specifies `integ.*.ts`. Unit testing is the separate `yarn test …` path. ([GitHub](https://github.com/aws/aws-cdk/blob/main/AGENTS.md?utm_source=chatgpt.com))

The “integ” artifact itself serves **two related purposes**: synthesis/snapshot regression checking and actual CloudFormation deployment. A real validation run uses `yarn integ`, which performs `cdk deploy`; AWS's instructions explicitly remind contributors to set up credentials first. ([GitHub](https://github.com/aws/aws-cdk/blob/main/CONTRIBUTING.md?utm_source=chatgpt.com))

The now-separate CDK CLI repository makes the boundary even more obvious: live integration tests are under `packages/@aws-cdk-testing/cli-integ`, one per `*.integtest.ts` file, deploy real resources, and are explicitly “not run as part of the normal build.” PR runs use AWS's internal isolated-account infrastructure. ([GitHub](https://github.com/aws/aws-cdk-cli/blob/main/AGENTS.md?utm_source=chatgpt.com))

For local authentication, the contributing guide documents IAM Identity Center/SSO and, alternatively, environment variables including `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION`. ([GitHub](https://github.com/aws/aws-cdk/blob/main/CONTRIBUTING.md))

There is a mild terminology gotcha here too: **“integ test” can refer to the test artifact used for snapshot regression as well as the real-deployment execution of that artifact**. The command/mode—not merely the word “integ”—determines whether AWS gets touched.

### Stripe: “test mode” is remote; `stripe-mock` is local

Stripe is a good demonstration of why “test” is too ambiguous to encode safety.

`stripe-mock` is a local HTTP server specifically used by Stripe's server-side SDK test suites. Stripe says it is used **instead of Stripe testmode** to make suites faster and less brittle, and warns that the mock does not reproduce the real API's behavior. ([GitHub](https://github.com/stripe/stripe-mock?utm_source=chatgpt.com))

In `stripe-node`, the default development instructions say to start `stripe-mock` and then run `just test` or `yarn test`. If a developer wants the tests to talk to the actual Stripe test API, the same README provides the explicit opt-in:

```text
STRIPE_TEST_API_KEY=[redacted]
```

followed by the same test command. ([GitHub](https://github.com/stripe/stripe-node?utm_source=chatgpt.com))

Thus the physical distinction is **not** “unit directory versus integration directory.” It is primarily **endpoint and credential selection**. Absence of `STRIPE_TEST_API_KEY` keeps the normal workflow local.

The overloaded terminology is worth calling out explicitly: Stripe's **testmode** means a real, remote Stripe service using a real test secret; **stripe-mock** means a local fake. “Test mode” therefore does not mean hermetic.

### Twilio: even “integration test” may be 100% local

Twilio takes the mock-oriented approach further. Its OpenAPI generator's documented “unit tests or integration tests” for `twilio-go` tell the developer to start a local **Prism** OpenAPI mock, point the client at `localhost:4010`, then run `go test ./...`. Those are called integration tests while still requiring no connection to Twilio itself. ([GitHub](https://github.com/twilio/twilio-oai-generator?utm_source=chatgpt.com))

Twilio's Node documentation likewise explicitly recommends injecting a custom HTTP client to run **unit and integration tests without connecting to Twilio**, and points to Prism as an example. ([GitHub](https://github.com/twilio/twilio-node/blob/main/advanced-examples/custom-http-client.md?utm_source=chatgpt.com))

The current `twilio-node` default is `npm test`; its package script runs Jest on `spec`, explicitly ignoring `spec/cluster`, followed by TypeScript compilation. The repository has `nock` and other mocking packages as test dependencies. There isn't a documented general `TWILIO_LIVE_TESTS=1`-style switch corresponding to HashiCorp's `TF_ACC`. ([GitHub](https://github.com/twilio/twilio-node/blob/main/package.json?utm_source=chatgpt.com))

A genuine Twilio client does use real credentials—normally `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`—and the README even has a live “test your installation” example which sends an SMS. But that is distinct from the repository's ordinary automated test command. ([GitHub](https://github.com/twilio/twilio-go?utm_source=chatgpt.com))

So here **“integration” is particularly unsafe as a semantic proxy for “uses a real third party.”**

### Go build tags: the simplest hard physical barrier

A Go filename only has one testing-related suffix with language semantics: **`*_test.go`**. `go test` recompiles the package with all matching `_test.go` files that satisfy the current build constraints. ([Go Packages](https://pkg.go.dev/cmd/go?utm_source=chatgpt.com))

Therefore:

```go
foo_integration_test.go
foo_acceptance_test.go
foo_e2e_test.go
```

are all ordinary Go test files. Those extra words carry **zero selection semantics**.

In contrast:

```go
//go:build integration

package foo
```

means that file is not part of an ordinary test build; the developer must request it with something such as:

```text
go test -tags=integration ./...
```

Custom tags have no predefined meaning—`integration`, `acceptance`, `live`, etc. are merely project conventions—but build constraints provide a much harder barrier than a function-name prefix. ([Go Packages](https://pkg.go.dev/cmd/go?utm_source=chatgpt.com))

Go did change the relevant syntax: Go 1.17 introduced **`//go:build`** in preference to the older **`// +build`** form. The release notes explain that the new form uses ordinary boolean expressions and was intended to be less error-prone. That is a tagging-syntax migration, not a rename of “integration tests.” ([Go.dev](https://go.dev/doc/go1.17?utm_source=chatgpt.com))

## The overall pattern

If the design goal is specifically **“a developer must not accidentally spend money or mutate a third-party account by typing the ordinary test command”**, these projects suggest three different strengths of isolation.

**HashiCorp's pattern is the clearest runtime interlock:** ordinary Go discovery may see the test, but a deliberately named enablement variable (`TF_ACC`) must be present. **Go build tags and Kubernetes/CDK directory selection are stronger physical-selection barriers:** the dangerous code isn't selected by the ordinary command at all. **Stripe/Twilio take a different route:** make the ordinary integration-capable suite point at a local fake, and require explicit endpoint/credential changes before it can become live.

By contrast, **Bazel's `external` and `requires-network` tags should not be treated as safety interlocks**. They describe caching/execution requirements. If adopting Bazel for credentialed tests, the closest equivalent to the patterns above would be a project policy combining a dedicated tag with `manual` or default-negative `--test_tag_filters`, network sandboxing for everything else, and explicit secret injection only in the live-test job. ([Bazel Documentation](https://bazel.build/reference/be/common-definitions?authuser=7&utm_source=chatgpt.com))

The recurring lesson across all of them is that **the safest convention encodes “live” independently of “integration/e2e/large.”** “Integration” describes what is being composed; “live” or “nonhermetic” describes where dependencies come from. Conflating those two is exactly the ambiguity Google's size/scope taxonomy was designed to avoid.

---

If you want, I can:

- Continue with Pulumi and AWS CDK integration tests
- Elaborate on Stripe and Twilio test isolation and credential handling
- Expand on Go build tags and finalize summary with any terminology caveats
