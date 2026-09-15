# Testing External Format Rewriters

Source: https://chatgpt.com/share/6aa92c85-b398-83eb-b2c1-4a9c969d25a1

---

**User**

Context: A project parses and rewrites a configuration format defined by another program, which is authoritative and changes between its own releases. The project must preserve bytes it does not intend to change, and must never widen what an entry permits.

Question: How do projects test a parser or rewriter for a format they do not own?

Cover: round trip and idempotency testing; differential testing against the authoritative implementation; corpus based testing and where corpora come from; fuzzing, including structure aware fuzzing; property based testing of preservation; golden files and their failure modes; and how projects detect that the upstream grammar changed in a new release.

Also cover how projects decide what to do with input they cannot parse, and how that decision is tested.

Use named examples such as configuration file rewriters, code formatters, linters, and protocol libraries.

Evidence rules: cite repositories and papers with dates. Where a project publishes its corpus or fuzzing setup, describe how it is run and how failures are triaged. Include examples of bugs these methods found.

---

**ChatGPT**

I’ll treat this as an engineering survey rather than a single best-practice recipe: I’ll separate invariants you can test without an oracle from oracle-based checks against upstream, then use concrete repositories and fuzzing/paper evidence to show how mature projects combine them.

---

**ChatGPT**

Two useful patterns are already visible in the repositories: `gix-config` explicitly promises lossless Git-config round trips, while Ruff treats idempotency, syntax validity, and compatibility against Black/real-world projects as separate checks. That separation is important: a single “golden output” test cannot prove all three.

---

**ChatGPT**

The strongest design is “layered oracles”: byte-level preservation properties first, semantic comparison to upstream second, and fuzz/corpus tests to explore cases neither suite anticipated. For safety-sensitive rewrites, the write path should have a stricter acceptance gate than the read/diagnostic path.

---

**ChatGPT**

For a parser or rewriter of somebody else’s format, the most effective approach is to treat the upstream program as a **versioned executable specification**, and then test several different contracts independently: syntactic compatibility, semantic compatibility, byte preservation, rewrite safety, and robustness. No single oracle—especially not golden files—is strong enough by itself.

### Round trips and idempotency

For a lossless configuration rewriter, the first test should be stronger than the usual `parse → print → parse` check. A no-op operation should satisfy **byte identity**:

`rewrite_noop(x) == x`

That includes comments, blank lines, quoting choices, whitespace, line endings, ordering, and unknown-but-preservable material. `gix-config`, for example, explicitly describes its goal as lossless Git-config round trips, retaining comments and whitespace and changing only affected lines. ([GitHub](https://github.com/GitoxideLabs/gitoxide/blob/main/crate-status.md?utm_source=chatgpt.com))

For an actual edit `e`, useful properties are:

`R_e(R_e(x)) == R_e(x)` — applying the same edit twice is idempotent.

`upstream_parse(R_e(x)) succeeds` — you never emit something the owner rejects.

`semantic_upstream(R_e(x)) == intended_edit(semantic_upstream(x))` — the edit means what you intended according to the owner, not merely according to your parser.

For a permission-like entry, add the security property explicitly. If `Allowed(x)` is the behavior permitted by the authoritative implementation, a restriction-only rewrite should establish something like

`Allowed(R_e(x)) ⊆ Allowed(x)`

and, more generally, `Allowed(R_e(x))` must be no larger than the set authorized by the requested edit. This catches the particularly dangerous class of bug where an unknown flag, negation, qualifier, or ordering rule gets lost and the rewritten entry becomes more permissive.

Formatters use the same idea without byte preservation: canonicalization should satisfy `F(F(x)) = F(x)`. Rustfmt's test infrastructure deliberately checks not only source→expected-output goldens but also that files already in the expected `tests/target` tree remain unchanged and that formatting does not require multiple passes to converge. ([GitHub](https://github.com/rust-lang/rustfmt/blob/main/Contributing.md?utm_source=chatgpt.com)) Ruff similarly runs stability checks for a second formatting pass, syntactic validity of the result, and panics. ([GitHub](https://github.com/astral-sh/ruff/blob/main/crates/ruff_python_formatter/CONTRIBUTING.md?utm_source=chatgpt.com))

These checks find real defects. On June 3, 2024, Ruff reported an idempotency failure found by its `ruff_formatter_idempotency` fuzz target: a multiline string changed differently on the first and second formatting passes. ([GitHub](https://github.com/astral-sh/ruff/issues/11724?utm_source=chatgpt.com))

### Differential testing against the owner

When one implementation is authoritative, differential testing is unusually valuable. McKeeman's 1998 paper describes the core method: feed mechanically generated cases to comparable implementations and investigate disagreements, crashes, and hangs. ([DBLP](https://dblp.org/rec/journals/dtj/McKeeman98.html?utm_source=chatgpt.com))

For a configuration format, I would compare more than “accepted/rejected.” For every corpus or generated file, record the authoritative program's observable interpretation: resolved keys, boolean values, effective permissions, include expansion, precedence, normalization, or whatever commands expose the semantics. Then compare those observations with your implementation.

Gitoxide does this directly. Its Git-config `includeIf` work was tested against a Git baseline so the two implementations had to agree on conditional inclusion behavior. ([GitHub](https://github.com/GitoxideLabs/gitoxide/discussions/468?utm_source=chatgpt.com)) This is preferable to comparing two ASTs because Git's internal AST is not the contract; Git's externally visible interpretation is.

Ruff provides another good example. Its parser work has used fuzz results comparing Ruff with CPython's parser/compiler, and a 2025 tracking issue lists semantic syntax errors discovered from those disagreements. ([GitHub](https://github.com/astral-sh/ruff/issues/17412?utm_source=chatgpt.com)) A protocol analogue is BoringSSL's TLS suite: it intentionally uses a second TLS implementation—a patched Go `crypto/tls`—to construct both valid and deliberately malformed handshakes. Rustls runs that BoGo suite against itself. ([BoringSSL](https://boringssl.googlesource.com/boringssl/%2B/master/ssl/test/README.md?utm_source=chatgpt.com))

Differential testing does need an “allowed differences” layer. Versions differ; some errors are implementation-specific; diagnostics may change without semantics changing. Compare the narrowest externally meaningful result you can, and version the exceptions rather than silently updating expected output.

### Corpora: where useful tests actually come from

A mature corpus is usually an amalgam rather than something invented from scratch. The highest-yield sources are upstream's own conformance/regression tests; real files taken from open-source projects, package repositories, operating-system images, and customer installations where licensing permits; every user bug reproducer; minimized fuzzer crashes; files exercising each historical syntax version; and hand-written pathological cases involving quoting, continuation, encodings, duplicate entries, nesting, comments, and boundary sizes.

Real-world code is particularly useful because grammar documents rarely describe all accepted quirks. Ruff copied most of Black's formatter fixtures into its own suite to expose output differences, and separately runs ecosystem checks on selected real projects; its documentation cites projects such as Django and Zulip when quantifying compatibility. ([GitHub](https://github.com/astral-sh/ruff/blob/main/crates/ruff_python_formatter/CONTRIBUTING.md?utm_source=chatgpt.com)) Rustfmt's `tests/source`/`tests/target` pairs are another classic repository corpus. ([GitHub](https://github.com/rust-lang/rustfmt/blob/main/Contributing.md?utm_source=chatgpt.com))

Fuzzing corpora should be cumulative. OSS-Fuzz recommends starting fuzz targets with good sample inputs, continually evolves the corpus through coverage-guided mutation, permits downloading the accumulated corpus, and recommends examining coverage to see which grammar areas remain unreachable. ([GitHub](https://github.com/google/oss-fuzz/blob/master/docs/getting-started/new_project_guide.md?utm_source=chatgpt.com)) Gitoxide publicly maintains fuzz-corpus directories, including for `gix-config`, and runs continuous fuzzing through OSS-Fuzz. ([GitHub](https://github.com/GitoxideLabs/gitoxide/discussions/1308?utm_source=chatgpt.com))

The practical rule is: **a fixed regression suite remembers bugs you have already seen; a living corpus gives mutation-based tools useful places from which to search for bugs you have not seen.**

### Fuzzing: raw, structured, and differential

Raw byte fuzzing remains worthwhile. It is very good at lexer failures, invalid UTF-8 handling, integer/pathological-length cases, crashes, hangs, recursion explosions, and accidental assumptions about terminators or allocation sizes.

But highly structured formats need structure-aware fuzzing as well. Godefroid, Kiezun and Levin's 2008 grammar-based whitebox work showed why: random malformed input tends to die in early parsing stages; adding grammar knowledge increased code-generation-module coverage in their IE7 JavaScript experiment from 53% to 81% while using fewer tests. ([Microsoft](https://www.microsoft.com/en-us/research/?p=153167&utm_source=chatgpt.com)) LangFuzz, published at USENIX Security in 2012, combined grammar-aware generation with fragments from existing programs and bug-triggering inputs; the authors reported 105 new severe Mozilla JavaScript vulnerabilities and 18 PHP crash defects. ([Usenix](https://www.usenix.org/conference/usenixsecurity12/technical-sessions/presentation/holler?utm_source=chatgpt.com))

For a configuration rewriter, structure-aware fuzzing can generate a document AST plus an **edit operation**, not merely a document. Useful mutation dimensions include duplicate sections, quoted/unquoted representations, escaped separators, comments in every legal position, alternative line endings, include chains, version-specific constructs, and an edit targeting an arbitrary occurrence.

Google's libprotobuf-mutator is a concrete implementation of this general technique: describe a structured input using a protobuf representation, mutate the tree rather than arbitrary bytes, then convert it into the real syntax. Its documentation describes this for SQL and other grammars and records bugs found in Chromium and Envoy. ([GitHub](https://github.com/google/fuzzing/blob/master/docs/structure-aware-fuzzing.md?utm_source=chatgpt.com))

The best setup normally combines both approaches. Keep one byte-oriented target for hostile malformed input, one structure-aware target for deep semantic paths, and one **differential target** that feeds the same generated input to the upstream implementation and your own.

Gitoxide's experience illustrates the value of the first category: after expanded `gix-config` fuzzing was put onto Google's infrastructure, a stack-overflow vulnerability was found within about a day; another fuzzer exposed unbounded recursive behavior in `gix-glob`. ([GitHub](https://github.com/GitoxideLabs/gitoxide/discussions/1261?utm_source=chatgpt.com))

### Property-based testing for preservation

Property-based testing is particularly well suited to rewriters because the strongest requirements are invariants rather than specific expected outputs. QuickCheck's original 2000 paper framed exactly this model: define properties and generate large numbers of inputs, with custom generators where ordinary random generation is insufficient. ([DBLP](https://dblp.uni-trier.de/rec/conf/icfp/ClaessenH00.html?utm_source=chatgpt.com))

For a lossless rewriter, I would make these properties executable:

* no requested edit ⇒ exact byte identity; requested edit ⇒ all known untouched token spans remain byte-identical and in the same order; repeated edit ⇒ identical bytes; output is accepted by the targeted upstream version; authoritative semantics after rewriting equal the intended semantic transformation; and, for security restrictions, the authoritative permitted set never exceeds the intended permitted set.

The important detail is that the last two properties must use an independent oracle where possible. Testing `my_parser(my_writer(my_parser(x)))` can establish internal consistency while both parser and writer share the same misunderstanding.

Shrinking is valuable here. The ideal failing artifact is not a 400 KB configuration but the smallest file containing, say, “negated option + escaped quote + trailing comment” that still causes the permission-widening error.

### Golden files: valuable, but not a proof

Goldens are excellent for reviewability. A test author can see exactly which byte changed, and unusual syntax remains permanently represented in the repository. Rustfmt's source/target fixtures and Ruff's snapshot tests are good examples. Ruff even copied Black test fixtures and removes a snapshot once Ruff and Black no longer differ on that input. ([GitHub](https://github.com/rust-lang/rustfmt/blob/main/Contributing.md?utm_source=chatgpt.com))

Their failure mode is oracle circularity. If `expected.conf` was produced by the same implementation under test, a bug can simply become the blessed answer. A broad “update all snapshots” operation can turn a regression into the new specification. Goldens can also bake in platform line endings, upstream-version quirks, nondeterministic ordering, or an accidental normalization that violates byte-preservation requirements.

Therefore I would treat a golden as **one readable example of an invariant**, never as the invariant itself. A preservation golden should also be accompanied by an assertion identifying which byte spans were permitted to change. A semantic golden should ideally also be checked against the owner.

### Detecting an upstream grammar change

Projects that do this reliably do not wait for user reports. They maintain an upstream compatibility job.

Run the differential/conformance suite against at least the oldest supported upstream, the current release, and a preview/nightly or upstream main branch. For each version, retain an acceptance matrix. A particularly valuable alarm is:

`new_upstream accepts input && our_current_parser rejects input`

because that is often a newly introduced grammar feature.

Ruff has concrete examples. On April 23, 2024, a contributor adding PEP 696 syntax to CPython noticed that Ruff began failing in CPython CI; that exposed missing Ruff parser support for the new Python 3.13 syntax. ([GitHub](https://github.com/astral-sh/ruff/issues/11099?utm_source=chatgpt.com)) In June 2025, Python 3.13.4 changed f-string behavior in a way that made Ruff's formatted output syntactically invalid; Ruff subsequently changed its formatter and documented the grammar-related compatibility fix. ([GitHub](https://github.com/astral-sh/ruff/issues/18632?utm_source=chatgpt.com))

Baseline tests can detect subtler changes as well. Gitoxide records a baseline failure caused by a behavior change in Git 2.47's `rev-parse`; such a failure is exactly what should trigger investigation rather than automatic fixture regeneration. ([GitHub](https://github.com/GitoxideLabs/gitoxide/blob/main/etc/plan/bug-fixes.md?utm_source=chatgpt.com))

Protocol suites make this process especially explicit. Rustls documents that updating its vendored BoGo suite is expected to expose new failures. Maintainers triage those into changed upstream error expectations versus newly added test-runner options; genuinely unsupported options are marked `NYI` rather than silently pretending to support them. ([GitHub](https://github.com/rustls/rustls/blob/main/bogo/README.md?utm_source=chatgpt.com)) That is a good model for configuration grammar evolution too: “new upstream construct that we deliberately do not understand” should be a named state, not an accidental parse error.

### What to do with input you cannot parse

For a security-sensitive rewriter, the safest default is **fail closed and do not write**. The original bytes remain untouched, the user gets a diagnostic saying which upstream versions you support, and no partially understood document is normalized.

There are valid alternatives, but they need explicit contracts. A lossless parser may represent an unknown construct as an opaque byte span if it can determine its boundaries without guessing; then unrelated edits can proceed while the opaque span is copied exactly. What it should not do is interpret half an entry, drop the unknown half, and serialize the portion it thinks it understands. That is precisely how a restrictive entry can become permissive.

Error recovery is appropriate for linters and editors, where showing later diagnostics is useful. It is much more questionable as the basis for an on-disk rewrite. A sensible architecture is therefore **permissive read for diagnostics, strict write for mutation**: before committing an edit, require a complete safe parse or safe opaque segmentation, generate the output, and run the targeted authoritative parser/evaluator over the result.

Ruff's fix machinery illustrates the final validation step. In reported cases where a lint fix generated invalid Python, Ruff prints “Fix introduced a syntax error. Reverting all changes” rather than leaving the broken rewrite in place. ([GitHub](https://github.com/astral-sh/ruff/issues/16472?utm_source=chatgpt.com))

Test this policy as aggressively as successful parsing. Feed truncated files, future-version syntax, invalid encodings, embedded NULs, malformed quoting, and random bytes; kill the process during the write; and inject errors between temp-file creation and rename. On every rejected case, assert that the original file's bytes and metadata are unchanged. For opaque preservation, mutate something before and after the unknown construct and assert exact identity of the unknown range. For any successful rewrite, rerun the authoritative implementation before declaring the test passed.

### A practical hierarchy

For the project in your context, I would make the release gate conceptually:

**byte preservation → syntactic validity → upstream semantic equivalence → non-widening safety → idempotency**, with corpus and fuzzing supplying the inputs.

The core CI suite would contain hand-written and regression examples plus property tests. A compatibility job would compare against supported upstream releases. A scheduled job would run against upstream prerelease/main and its latest test suite. Fuzzing would have separate raw-byte, structured-document/edit, and differential targets. Every minimized fuzz failure would become a permanent regression input; every upstream divergence would be classified as “our bug”, “new upstream behavior”, “unsupported but safely preserved”, or an explicitly documented intentional difference.

That combination is much more robust than trying to reconstruct the owner's grammar perfectly. In practice, successful reimplementations such as Gitoxide, Ruff, rustfmt, and rustls assume that their understanding will sometimes be incomplete, and build tests specifically to discover when that happens. ([GitHub](https://github.com/gitoxidelabs/gitoxide?utm_source=chatgpt.com))
