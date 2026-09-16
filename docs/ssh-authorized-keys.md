# Authorized-key file model

`convex/ssh/authorized_keys.ts` owns an immutable observation of one file and plans candidate edits. It is ordinary TypeScript with no registered Convex functions, database tables, transport, or filesystem writes. Application operations can use it regardless of their authentication or transport adapter.

## Contract

Construct `AuthorizedKeysFile` from bytes. The constructor copies the input. `bytes()` returns a copy. `lines` provides frozen descriptions with one-based line numbers and byte offsets. Each line is an entry, comment, blank, or opaque content. A line number identifies an occurrence only within that observation; a key fingerprint is not its identity.

`plan(currentBytes, edits)` first compares the supplied current bytes with the observation. It returns either candidate bytes or an explicit error. All update and removal targets refer to original line numbers, regardless of request order. Two changes to one occurrence are rejected. Appends occur at the end in their request order. Nothing writes the candidate to a server.

The application layer must bind an observation and its edits to the same server, allocation, account, and concrete file. The module does not infer those identities from content. Comparing supplied bytes does not close a remote write race or establish whether an earlier operation ran. In particular, changing bytes from A to B and back to A satisfies this comparison again.

## Preservation and edit behavior

- Unchanged lines retain their bytes, including invalid UTF-8, comments, unknown content, blank lines, mixed line endings, and missing final newlines.
- An entry retains ordered option tokens, repeated options, spelling, and quoted values. Option values are exposed for inspection; the original token is retained for reconstruction.
- Updates change only the requested key, options, or comment field. Other field bytes and the line ending stay intact. Replacing a field uses standard spaces for that field's separator. Omitting every field is a byte-preserving no-op.
- Removal affects one recognized entry and its line ending. Opaque, comment, and blank lines cannot be removal targets through this structured interface.
- Appending uses the first existing line ending, or LF if the file has none. An unterminated remaining last line receives a separator before the appended entry. Existing line endings are not normalized.
- An options replacement is a complete ordered array of individual tokens. A token can contain quoted commas or spaces. A string containing several top-level options is rejected as one token. An empty array removes the option field.
- New fields reject line breaks and NUL bytes. Text fields reject lone UTF-16 surrogates rather than letting UTF-8 encoding replace them silently.

## Recognition is not authorization validation

The initial recognizer covers textual key types from the OpenSSH 9.6 family, including RSA, DSA, Ed25519, ECDSA, security-key types, and their certificate forms. Recognition does not imply that the installed server supports or permits the algorithm.

It recognizes field boundaries and quoted option syntax. It does not decode or validate key blobs, validate native option values or repetitions, evaluate certificates, or calculate effective access. For example, a structurally recognizable entry with repeated `command` options is still exposed even though native validation can reject it. Unknown option names are retained; unknown key types and syntax outside the recognizer remain opaque. Invalid UTF-8 anywhere in a line also makes that line opaque, even if a server could accept its key portion.

The parser is deliberately not a replacement for `sshd`. A successful plan means that the requested structural edit can be represented against those supplied bytes. It does not mean "safe to write" or "this key can connect." Native key and option validation, supported server configuration, path and metadata checks, authority checks, and mutation recovery must be established before a remote write operation is added. Entry recognition must never be used as an authorization decision.

For the native boundary, see OpenSSH's [authorization-file processing](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth2-pubkeyfile.c), [option parser](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/auth-options.c), and [option quoting helpers](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/misc.c). These references establish the baseline; a different server version or vendor patch requires its own behavioral validation.

## Verification and next boundary

Run `bun test convex/ssh/authorized_keys.test.ts` for the pure module's behavior. Tests exercise duplicate occurrences, exact preservation, quoting, unknown content, stale observations, conflicting targets, field injection, immutable snapshots, batch edits, and appends. A deterministic byte corpus checks round-trip preservation. Some fixtures deliberately use incomplete key blobs to prove that structural recognition does not masquerade as native validation.

The module adds no API admission policy. Future operations must bound remote reads, response sizes, and edit batches before calling it; those limits belong to the actual transport and application contract.

`convex/ssh/read_file.ts` and `convex/ssh/write_file.ts` read and replace one file on a server, and `convex/ssh/keys.ts` combines them with this module for the public operations. Native validation of options is not implemented: recognition is structural only. What OpenSSH itself accepts is settled by `tests/convex/ssh/authorized_keys_agreement.test.ts`, which asks a real server.
