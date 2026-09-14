# Design SSH API Boundary

Source: https://chatgpt.com/share/6aa7762c-8f28-83eb-aca6-1dc6ba3f68dd

---

**User**

We are designing Composery, a web control panel for customer-controlled VPSs. The current backend is Convex with TypeScript and Node.js 24, Clerk authentication, and Hetzner Cloud for the first allocation backend. Ubuntu 24.04 is the initial server image. Clients must support Windows, macOS, and Linux. A later allocation backend may run our own VMs.

Product requirements: owners can administer their servers; platform ownership and membership permissions are distinct from Linux privileges. Initially one platform permission can cover SSH administration. Ordinary customer SSH should work independently of Composery after setup. Customer private keys should remain on the client. A client agent is not guaranteed an authenticated browser session. UI and programmatic clients must use the same application operations and authorization rules.

Working direction, open to evidence-based challenge: structured controls over native OpenSSH authorizations; server state is authoritative; live reads and explicit edits; no mandatory per-member key ownership, automatic key deletion on membership removal, persistent key inventory, or continuous enforcement. These are not implemented facts. Do not treat them as protocol requirements.

Your task: Design a concrete application boundary for server operations and SSH authorization management that a Next.js UI, agent-assisted setup, and future external client can all use without duplicated policy or write paths.

The backend currently uses Convex functions, Clerk authentication, and durable server operations. Compare native Convex clients and HTTP endpoints where relevant. Do not assume that publicly callable Convex functions are automatically a suitable authenticated developer API. Distinguish shared application logic from identical network transports.

Specify authentication/authorization boundaries, request and result shapes, pagination or bounded live reads, idempotency, expected revisions, operation status, cancellation semantics, timeouts, rate limits, and errors. Distinguish authorization entry identity from key identity. Address member permission changes before remote dispatch and uncertain remote outcomes.

Determine the minimum external authentication design needed now and what can remain an adapter later without changing domain operations. Do not invent a broad token-scope system unless needed. Provide two concrete journeys, one through the UI and one through a programmatic client, demonstrating the same authorization and edit logic. Explain a simple module layout within one Convex-backed repository.
Research rules: use primary documentation and source code. Identify the exact release, commit, platform, and date for claims that depend on them; distinguish OpenSSH Portable, OpenBSD-current, Ubuntu packages, and SSH RFCs. Separate verified facts, deductions, recommendations, and unknowns. Link to the source supporting each material claim. Never claim to have run an experiment unless you did. If repository access or execution is unavailable, say so and supply a reproducible check instead. Do not request or print secrets.

Evaluate alternatives against the same requirements. State the strongest simpler alternative and the conditions that would make it preferable. Do not optimize for agreement with the working direction or for producing a novel architecture. Return a concise recommendation, decisive evidence, unresolved questions, and explicit pass/fail checks. Ask for a product decision only when evidence cannot resolve it. Stay within this prompt's scope; name dependencies instead of redesigning the whole product.

---

**ChatGPT**

I’m going to anchor this on the actual Convex/Clerk/OpenSSH/Ubuntu interfaces first, then derive the smallest application boundary that survives a future transport change. I’ll keep verified facts separate from recommendations and call out any version-dependent unknowns.

---

**ChatGPT**

One important distinction is already emerging: Convex gives you multiple ways to invoke the same backend code, but that does **not** mean the public function surface should itself be your long-lived developer API. The safer design is to make domain commands transport-neutral, then let Convex-native calls and an HTTP/OAuth adapter converge on them.

---

**ChatGPT**

The SSH side also supports the working direction, with one caveat: an `authorized_keys` **line** is an authorization rule, not merely “a key record.” In OpenSSH 9.6p1 the same key material can be paired with per-entry restrictions such as `from=`, `command=`, `restrict`, forwarding limits, expiry, and CA semantics; the comment is non-authoritative. That makes “authorization entry identity” necessarily different from “key fingerprint.”

---

**ChatGPT**

# Recommendation

Build **one transport-neutral application command layer inside the Convex repository**, and treat Convex-native functions and a future HTTP API as adapters around it.

For SSH, model a resource as **OpenSSH authorization entries for a Linux account**, not as “member keys.” An authorization entry is distinct from the cryptographic key it contains. Make the server the authority: inspect live server state, return an opaque revision, and require that revision for explicit edits.

For the initial Ubuntu implementation, I would go one step simpler than editing arbitrary customer files: during setup, add a **dedicated native `AuthorizedKeysFile` source that Composery writes**, while inspection may show other supported file-backed sources as read-only. OpenSSH supports multiple `AuthorizedKeysFile` files. This preserves ordinary SSH if Composery is offline, does not create a central key inventory, and substantially reduces the risk of destroying customer-managed formatting or entries. 

The boundary should look like this:

```text
Next.js + Clerk session ──> public Convex wrappers ───┐
                                                      │
future HTTP/API key ──> HTTP adapter ─> internal fn ─┼─> application commands
                                                      │       │
agent operation grant ─> small HTTP adapter ─────────┘       ├─ authz
                                                              ├─ idempotency
                                                              ├─ operation state
                                                              └─ scheduler
                                                                    │
                                                               remote executor
                                                                    │
                                                                  VPS
```

The transports share **operations and policy**, not necessarily protocols.

## Verified evidence

The relevant implementation baselines are:

| Subject | Verified baseline |
|---|---|
| Convex | `convex` **1.45.0**, release commit `9ff6a477a42d75c30bf4e0efc1657d749a225cc7`, 21 Aug 2026. The commit changes the package from 1.44.0 to 1.45.0.  |
| Ubuntu 24.04 | Canonical's 3 Sep 2026 security notice gives Noble's fixed `openssh-server` as **`1:9.6p1-3ubuntu13.19`**. This is an Ubuntu downstream package; it should not be equated to pristine upstream 9.6p1. ([Ubuntu](https://ubuntu.com/security/notices/USN-8721-1?utm_source=chatgpt.com)) |
| OpenSSH Portable | Tag **`V_9_6_P1`** was made 18 Dec 2023 and points to commit `8241b9c0529228b4b86d88b1a6076fb9f97e4a99`.  |
| OpenBSD-current | Current `sshd_config(5)` is explicitly **OpenBSD-current, September 2, 2026**. Do not use it as the Noble specification. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config)) |
| SSH protocol | RFC 4252, January 2006, defines the SSH `publickey` authentication method and identifies the public-key algorithm/blob sent by the client. It does **not** define OpenSSH's `authorized_keys` file. ([RFC Editor](https://www.rfc-editor.org/info/rfc4252/?utm_source=chatgpt.com)) |

OpenSSH Portable 9.6p1 documents an `authorized_keys` record as optional options plus key type, base64 key and comment; its comment is not used for authorization. Its source first parses the entry options, compares the actual key, and then performs authorization checks such as `from=` and expiry. So two lines containing the same key can be meaningfully different authorizations.  

That establishes the important distinction:

```text
key identity
    = cryptographic public key, normally represented by its SSH fingerprint

authorization entry identity
    = one occurrence of that key/CA plus its OpenSSH options
      in a particular authorization source
```

RFC 4252's public-key blob is the protocol authentication key. `command=`, `from=`, `restrict`, expiry and similar entry-level policy are OpenSSH authorization semantics layered around that key. ([RFC Editor](https://www.rfc-editor.org/info/rfc4252/?utm_source=chatgpt.com))

Convex also supports the separation proposed above. Public Convex functions are exposed through `/api/query`, `/api/mutation` and `/api/action`, while internal functions cannot be invoked directly by clients. HTTP actions are suitable for custom APIs and can invoke internal queries/mutations/actions, but HTTP actions deliberately leave request parsing/validation to the application. ([Convex Developer Hub](https://docs.convex.dev/http-api/?utm_source=chatgpt.com))

Therefore **“public Convex function” is a reachability property, not a promise that it is a stable developer API**. That is a deduction, not a Convex requirement.

## Application operations

I would expose these logical operations independent of transport:

| Operation | Semantics |
|---|---|
| `inspectSshAuthorizations` | Start an explicit live inspection of one server/Linux account |
| `editSshAuthorizations` | Explicit optimistic-concurrency edit against an inspected revision |
| `getOperation` | Read operation state/result |
| `cancelOperation` | Best-effort cancellation according to state |
| `listOperations` | Cursor-paginated operation history |
| `getSshSnapshotPage` | Read a bounded page from a completed inspection |

A representative request contract is:

```ts
type InspectSshAuthorizations = {
  serverId: ServerId;
  account: { username: string };
};

type EditSshAuthorizations = {
  serverId: ServerId;
  account: { username: string };

  snapshotId: string;
  expectedRevision: string;

  idempotencyKey: string;

  changes: Array<
    | {
        op: "add";
        sourceId?: string; // required if no unambiguous default
        entry: NewAuthorizationEntry;
      }
    | { op: "remove"; entryId: string }
    | {
        op: "replace";
        entryId: string;
        entry: NewAuthorizationEntry;
      }
  >;
};

type NewAuthorizationEntry = {
  key: {
    algorithm: string;
    blobBase64: string;
  };
  options?: SshAuthorizedKeyOption[];
  comment?: string;
};
```

There should be **no private-key field anywhere** in these contracts. Parsing a `.pub` file in the UI or desktop client is a convenience transform into `NewAuthorizationEntry`; private keys remain outside Composery.

An inspection result should resemble:

```ts
type SshAuthorizationSnapshot = {
  snapshotId: string;
  serverId: ServerId;
  account: { username: string };
  observedAt: number;

  revision: string;
  coverage: "complete-file-backed" | "partial";

  sources: Array<{
    sourceId: string;
    kind: "authorizedKeysFile";
    path: string;
    writableByComposery: boolean;
  }>;

  defaultWriteSourceId?: string;
  warnings: SshStateWarning[];
};

type AuthorizationEntry = {
  entryId: string;                 // snapshot-local entry identity
  sourceId: string;

  key: {
    algorithm: string;
    blobBase64: string;
    fingerprint: string;           // cryptographic key identity
  };

  options: SshAuthorizedKeyOption[];
  comment?: string;
  editable: boolean;
};
```

`entryId` should deliberately **not** be the fingerprint. For example, the same Ed25519 key occurring once with `from="203.0.113.0/24"` and once with `command="backup"` has one key identity but two authorization-entry identities.

## Revision and editing semantics

`revision` should be opaque to clients, for example `akrev1:<digest>`. Compute it from the live inputs relevant to the authorization decision: resolved account/home, effective SSH authorization-source configuration, source paths and their exact bytes/existence plus relevant ownership/mode metadata.

OpenSSH 9.6p1 provides `sshd -T` with `-C` connection parameters specifically so effective configuration including applicable `Match` rules can be evaluated. 

Before every edit, the remote executor must independently recompute the revision. If it differs:

```json
{
  "status": "failed",
  "error": {
    "code": "REVISION_MISMATCH",
    "retryable": true
  }
}
```

and **perform no write**. A client then explicitly re-inspects.

For a dedicated Composery authorization file, use same-directory temporary-file replacement, preserving required ownership/mode, followed by read-back verification. If you instead edit arbitrary customer files, use a round-trip parser that preserves blank lines, comments, unsupported-but-existing syntax and untouched raw lines. Do not parse the whole file into your current model and serialize it back canonically.

There is an unavoidable limitation: without an installed helper controlling all writers, Composery cannot provide strict compare-and-swap against an arbitrary local process that modifies the file between your final read and rename. Advisory locks only coordinate cooperating writers. The accurate guarantee is therefore **optimistic concurrency + atomic replacement + read-back verification**, not linearizable OS-level CAS.

## Authentication and authorization

Normalize authenticated callers into a small trusted principal:

```ts
type Principal = {
  userId: string; // derived from verified credential, never request JSON
  credentialKind:
    | "clerkSession"
    | "apiKey"
    | "oauth";
  credentialId?: string;
};
```

Then perform domain authorization solely against Composery state:

```ts
requireServerPermission(
  principal.userId,
  serverId,
  "server.ssh_admin"
);
```

An owner satisfies that permission through platform ownership. A member may satisfy it through membership. Neither fact implies anything about Unix UID, `root`, `sudo`, or an SSH key.

With Clerk + the normal Convex integration, authenticated native calls expose the verified identity through `ctx.auth.getUserIdentity()`. ([Convex Developer Hub](https://docs.convex.dev/auth/clerk?utm_source=chatgpt.com))

Do not put the authorization decision in React, Next.js route handlers, the future HTTP adapter, or the agent. All of those must converge on the same application authorization function.

### Member permission changes during an operation

A durable operation must not carry an authorization decision forever.

Creation should authenticate and authorize, insert the operation, and schedule its dispatcher in one mutation. Convex transactions are appropriate for the durable intent; scheduled actions are intentionally not retried, and scheduled functions do not inherit the original caller's authentication context. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))

Then use **two fresh gates**:

```text
create operation
    │
    ├─ authz check #1
    │
    └─ queued
          │
dispatcher claims operation
          │
          ├─ authz check #2 against current membership/ownership
          │
          └─ remote preflight
                   │
                   ├─ revision check
                   ├─ cancellation check
                   ├─ final current authz check
                   └─ side effect begins
```

If membership was removed before the final write gate, the write must not happen.

After the side effect has actually begun there is an unavoidable distributed-system race: revocation cannot retroactively make an already-issued remote write disappear. Do not promise “membership revocation instantly cancels all in-flight writes.” Meeting that stronger requirement would require the server-side executor/helper itself to revalidate a short-lived capability at the moment of effect.

`requestedByUserId` remains audit metadata; it is never authorization proof.

## Durable operation model

Use states along these lines:

```ts
type OperationStatus =
  | "queued"
  | "dispatching"
  | "executing"
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "outcome_unknown";
```

Track at least `requestedAt`, `requestedBy`, `startedAt`, `sideEffectStartedAt`, `finishedAt`, `deadlineAt`, and `cancelRequestedAt`.

The distinction between `failed` and `outcome_unknown` is important. Convex does not automatically retry actions precisely because external side effects may already have occurred when an error is observed. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))

If the network dies after issuing a write, go to `verifying`. Read-only verification may retry. If the intended postcondition can be proven, mark `succeeded`; if the executor can prove the write did not occur, mark `failed`; otherwise mark **`outcome_unknown` and never blindly repeat the mutation**. The next action is a fresh inspect and, if appropriate, a new explicit edit.

### Cancellation

Convex itself documents that cancelling a scheduled function before it begins prevents execution, while cancelling one that has already begun does not stop it. ([Convex Developer Hub](https://docs.convex.dev/scheduling/scheduled-functions?utm_source=chatgpt.com))

Map that into stronger application semantics:

| State | `cancelOperation` |
|---|---|
| `queued` | Strong cancellation: mark cancelled; dispatcher must refuse claim |
| `dispatching` / pre-effect | Best effort; executor checks cancellation before write |
| after `sideEffectStartedAt` | Return `CANCEL_TOO_LATE`; continue verification |
| terminal | Idempotently return existing terminal state |

Never implement cancellation as an automatic inverse SSH edit. A rollback is another write against potentially changed server state and deserves a new revision and explicit operation.

## Idempotency, bounded reads and limits

Require `idempotencyKey` on state-changing operations. Scope it to approximately:

```text
(userId, operationKind, serverId, idempotencyKey)
```

Store a canonical request hash and operation ID for 24 hours. Same key + same request returns the same operation; same key + different request returns `IDEMPOTENCY_CONFLICT`. The HTTP adapter's `Idempotency-Key` header simply populates this same application field.

That gives you **control-plane duplicate suppression**, not a claim of exactly-once operating-system effects.

For inspection, do not silently return a partial editable state. A reasonable initial safety envelope is 1 MiB total authorization-source bytes, 2,000 entries, and the OpenSSH 9.6p1 per-line syntax limit checked before accepting new entries. Exceeding a hard inspection bound returns `RESOURCE_TOO_LARGE`.

For completed inspections I recommend an immutable **short-lived snapshot**, e.g. 15 minutes, with cursor pages of 50 and a maximum of 100. Convex supports cursor-based reactive pagination and explicit `maximumRowsRead`/`maximumBytesRead` bounds. ([Convex Developer Hub](https://docs.convex.dev/api/interfaces/server.PaginationOptions?utm_source=chatgpt.com))

That short-lived snapshot is operational state, not a member-key inventory. Whether even 15 minutes of durable public-key material violates your product interpretation of “no persistent inventory” is a **product decision evidence cannot settle**. If the rule is literally zero durable key material, the same domain operations still work, but inspection data must be returned directly/client-held and server-side paginated reactive snapshots disappear.

Suggested starting rate limits are application policy, not Convex limits: roughly 30 inspections/minute per actor, 60/minute per server, 10 edits/minute per actor, and at most one mutating operation in flight per `(serverId, username)`. Add a separate HTTP ingress limit when an external API exists. Keep the important remote-load/write limits in the shared application layer so changing transport cannot evade them.

For initial remote timeouts, 10 seconds for SSH connect, 30 seconds for an individual remote step, approximately 60 seconds for one executor attempt and 5 minutes for a queued-operation deadline are reasonable starting values. They should remain configuration, not API contract.

## Errors

Use one stable application error shape on both transports:

```ts
type AppError = {
  code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "VALIDATION_FAILED"
    | "SNAPSHOT_EXPIRED"
    | "REVISION_MISMATCH"
    | "IDEMPOTENCY_CONFLICT"
    | "OPERATION_CONFLICT"
    | "RESOURCE_TOO_LARGE"
    | "UNSUPPORTED_SSH_AUTH_SOURCE"
    | "UNSUPPORTED_SERVER_STATE"
    | "RATE_LIMITED"
    | "REMOTE_UNREACHABLE"
    | "REMOTE_REJECTED"
    | "REMOTE_TIMEOUT"
    | "OUTCOME_UNKNOWN"
    | "CANCEL_TOO_LATE";

  message: string;
  retryable: boolean;
  requestId: string;
  details?: unknown;
};
```

Native Convex wrappers can carry expected application failures via `ConvexError.data`; Convex preserves application error data while redacting unexpected production server details. ([Convex Developer Hub](https://docs.convex.dev/functions/error-handling/?utm_source=chatgpt.com)) HTTP maps the same codes to ordinary `401/403/404/409/422/429` responses where the failure happens synchronously.

A stale remote revision is normally discovered **after** an edit operation has been accepted, so the HTTP edit request should generally return `202 {operationId}` and the operation later becomes `failed/REVISION_MISMATCH`; do not pretend it was a synchronous 409.

Do not return raw command stderr, complete `authorized_keys` files, backend stack traces, or remote command strings in public errors.

## Native Convex versus HTTP

For the Next.js UI, native Convex is the better transport. Queries are reactive, mutations are transactional, and Clerk integrates directly with Convex authentication. ([Convex Developer Hub](https://docs.convex.dev/functions/overview?utm_source=chatgpt.com))

For a third-party developer API, I would eventually use explicit versioned HTTP actions such as `/v1/...`. Convex HTTP actions are expressly intended for custom/public HTTP APIs and can call internal mutations, but they do not automatically validate HTTP arguments, so validate the adapter input before invoking the application function. ([Convex Developer Hub](https://docs.convex.dev/functions/http-actions?utm_source=chatgpt.com))

I would **not** declare the raw `/api/mutation` path plus function name to be Composery's permanent public API merely because Convex exposes it. Function names, Convex value encoding, authentication expectations and backend refactors would then unnecessarily become external compatibility commitments.

The strongest simpler alternative is to use `ConvexHttpClient` for every Composery-controlled client for now. Convex explicitly says that when you control the caller, you need not define custom HTTP actions; `ConvexHttpClient` can authenticate and call functions directly. ([Convex Developer Hub](https://docs.convex.dev/functions/http-actions?utm_source=chatgpt.com)) This is preferable if the “programmatic client” remains your own software and you do not yet promise a language-neutral, independently versioned developer API. Keep the internal application boundary anyway; adding `/v1` later then changes no domain operation.

## Minimum external authentication

You do **not** need a general token-scope subsystem now.

For the setup agent that lacks a browser session, create a **single-use operation-bound grant** when an authenticated user starts setup. It should be random, returned once, stored server-side only as a verifier/hash, short-lived (for example 10 minutes), and bound to exactly one setup operation/server. It permits “claim/report this operation,” not arbitrary server administration. This is a Composery capability, not a second membership system.

When you actually need a general headless developer client, Clerk now supports user-associated long-lived opaque API keys that are sent as Bearer credentials and can be revoked. Although Clerk supports optional API-key scopes, you do not need to mirror your domain permission system into them initially: authenticate the key to a user, then run the **same current Composery ownership/membership check**. ([Clerk](https://clerk.com/docs/guides/development/machine-auth/api-keys?utm_source=chatgpt.com))

For a future interactive CLI or third-party delegated client, OAuth can be another authentication adapter. Clerk's Device Authorization Grant only shipped in beta on **8 September 2026**, so I would not make Composery's core operation design depend on it today. ([Clerk](https://clerk.com/docs/guides/configure/auth-strategies/oauth/device-authorization-grant?utm_source=chatgpt.com))

## Two journeys through the same policy

**UI journey.** The signed-in Next.js UI calls the native `inspectSshAuthorizations` mutation. The public wrapper derives the Clerk subject, calls the shared `createInspect` application handler, which checks current `server.ssh_admin`, records the operation and schedules dispatch. The UI reactively watches `getOperation`, then pages the immutable snapshot. The user selects `entryId=E7` and submits an edit with `snapshotId`, `expectedRevision` and an idempotency key. The same application handler performs idempotency and authorization. Immediately before the remote write the dispatcher rechecks current permission and live revision. Success is verified against server state.

**Programmatic journey.** Later, `POST /v1/servers/S/ssh-authorizations/edits` carries a verified user API key and `Idempotency-Key`. The HTTP adapter authenticates the credential, parses the request and invokes an internal Convex mutation with the normalized trusted principal. That internal mutation calls the exact same `createEdit` application handler used above. It returns `202 {operationId}`. `GET /v1/operations/{id}` maps the same operation states and error codes. There is no HTTP-specific membership rule, SSH patcher, idempotency implementation or write path.

## Repository layout

A single repository does not need a framework-sized abstraction:

```text
convex/
  schema.ts

  serverOps.ts              # public native Convex adapters
  http.ts                   # agent routes; /v1 later

  app/
    principals.ts
    authorization.ts        # requireServerPermission()
    errors.ts
    operations.ts           # creation, idempotency, cancel, state machine
    sshAuthorizations.ts    # contracts + edit planning

  internal/
    appCommands.ts          # internal adapter used by HTTP
    dispatch.ts             # claim + fresh authz gates
    remoteSsh.ts            # Node action / existing executor integration
    verification.ts

  agentGrants.ts
```

Keep pure SSH parsing/revision code in a normal TypeScript module if it needs reuse by tests or another runtime. `serverOps.ts` and `http.ts` should be thin enough that a reviewer can see they contain transport concerns, not domain policy.

## SSH source coverage

Do not label the initial feature “all SSH access” unless it actually covers all configured mechanisms. OpenSSH can obtain authorized keys from both `AuthorizedKeysFile` and `AuthorizedKeysCommand`, and certificate authorization can involve `TrustedUserCAKeys` and principal configuration. OpenBSD-current still documents these as distinct sources. ([OpenBSD Manual Pages](https://man.openbsd.org/sshd_config?utm_source=chatgpt.com))

For v1 I would define the support contract as **file-backed public-key authorization for explicitly supported Linux accounts**. If live inspection finds an active command/CA/principal configuration you do not model, return `coverage:"partial"` and either make those aspects visibly unmanaged or refuse the management operation with `UNSUPPORTED_SSH_AUTH_SOURCE`. Never imply that removing a displayed line guarantees the user can no longer SSH.

The dedicated Composery `AuthorizedKeysFile` is the strongest simpler SSH alternative because it keeps your writer away from customer-managed lines. If changing `sshd_config` during setup is unacceptable, fall back to round-trip editing the existing native file with revision checks. If the product later requires membership revocation to immediately remove SSH access, the architecture should instead move toward certificates/central authorization or continuous enforcement; that would be a different requirement from the one given here.

## Unknowns and reproducible checks

I did **not** run Composery, access its repository, or execute anything on one of your Ubuntu images. The exact installed Noble package and effective `sshd` configuration therefore remain unknown.

On a disposable VM produced from the actual Composery image, the relevant reproducible check is:

```sh
dpkg-query -W -f='${Version}\n' openssh-server
/usr/sbin/sshd -V 2>&1

sudo /usr/sbin/sshd -T \
  -C user=YOUR_TARGET_USER,host=example.invalid,addr=203.0.113.1,laddr=127.0.0.1,lport=22 \
  | grep -E '^(pubkeyauthentication|authorizedkeysfile|authorizedkeyscommand|trustedusercakeys) '
```

Use a representative target account and, where `Match` rules depend on connection properties, repeat with the actual supported login contexts. That result—not OpenBSD-current and not pristine Portable 9.6p1—is the compatibility target for the shipped Ubuntu image.

The other dependency I cannot verify from the prompt is the capability of your existing durable remote executor: the design assumes it can perform privileged read, atomic file replacement and read-back verification without sending customer private keys to the backend. If the client agent itself supplies SSH connectivity, that key stays local and the durable operation boundary remains unchanged.

## Explicit pass/fail checks

| Check | Pass condition |
|---|---|
| One policy path | Native Convex and HTTP tests reach the same application authz/idempotency handler |
| Permission revoked while queued | No remote dispatch occurs |
| Permission revoked before final write gate | No SSH file write occurs |
| Permission revoked after write starts | Operation never falsely reports “cancelled/rolled back”; it verifies outcome |
| Stale revision | Zero writes; terminal `REVISION_MISMATCH` |
| Entry vs key identity | Same key with two different option sets has one fingerprint and two distinct `entryId`s |
| Idempotency | Same key/request returns same operation; changed request returns `IDEMPOTENCY_CONFLICT` |
| Uncertain remote response | No blind mutating retry; result becomes verified success/failure or `outcome_unknown` |
| Cancellation | Queued cancel prevents effect; post-effect-start cancel returns `CANCEL_TOO_LATE` |
| Bounded live read | Oversized server state fails explicitly rather than becoming an editable truncated snapshot |
| Unsupported SSH sources | API/UI reports partial/unsupported coverage instead of claiming complete access control |
| Native independence | After setup, disabling Composery's control plane does not prevent ordinary SSH using server-resident authorization |
| Membership semantics | Removing a platform member does **not** silently delete a server authorization entry |
| Key custody | No operation accepts, stores, transmits or logs a customer private key |

The only product decision I would surface now is whether a short-lived Convex inspection snapshot containing public keys is acceptable under “no persistent key inventory.” Everything else above can be implemented without committing Composery to a new authentication scope model, membership-to-key ownership model, or permanent external API transport.
