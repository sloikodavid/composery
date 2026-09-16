# Design Server Allocation Model

Source: https://chatgpt.com/share/6aa6f4ed-4600-83eb-ad29-2ab62d887be6

---

## Turn 1: User

_2026-09-13T19:04:03.103Z_

Design the smallest domain model for a multi-user server product. Initial allocations are Hetzner Cloud VMs. Later allocations may be VMs on dedicated hosts, or bare metal. New purchases should select the then-current backend while existing servers keep operating. We do not require automatic migration. Stack: Convex and TypeScript. Existing server identity is a stable database ID plus a globally unique, mutable slug whose historical values are never reused. Membership is owner/write/read.

Analyze server identity versus allocation versus durable operation, configuration resolved at purchase time, placement policy, capability differences, provider-project identity, and where future billing entitlements attach. Show which data is necessary now and which should not exist until a second backend is implemented. Include create failure, replacement, ownership transfer, deletion, and recovery records. Keep live provider availability out of repository enums. Explain schema evolution without a v1/v2 server discriminator and without storing a generic unvalidated provider blob.

Return one recommended model, an alternative with fewer tables, a worked example of switching new purchases to a VM pool, and a short list of contracts this does not make portable (such as disks and addresses). Ground external technical claims in primary sources. Challenge the proposed allocation abstraction if it is not justified. Do not design the hypervisor fleet itself.

---

## Turn 2: ChatGPT

_2026-09-13T19:04:04.538Z_

I’ll separate the stable customer-facing server from the disposable compute incarnation, then test whether a generic “allocation” layer buys anything before a second backend exists. I’ll also pin the TypeScript/Convex shape to primary Convex and Hetzner documentation, especially around IDs, indexes, provider identifiers, and API semantics.

---

## Turn 3: ChatGPT

_2026-09-13T19:05:26.290Z_

A key distinction is emerging: “allocation” is too overloaded to be the core abstraction. Replacement already gives you a backend-independent concept—an **incarnation** of a stable server—but provider placement, capability discovery, and the customer’s commercial entitlement should remain separate because they change on different clocks.

---

## Turn 4: ChatGPT

_2026-09-13T19:05:26.290Z_

The smallest model I would ship is **stable Server identity + durable Operation journal + replaceable Incarnations**. I would **not** introduce a generic `Allocation` aggregate yet. With one backend, it mostly creates a name under which you will be tempted to put unrelated provider data. The abstraction that is already justified today is an **incarnation**: even on Hetzner Cloud alone, a server can be replaced while retaining its customer-facing identity.

Convex is a good fit for this split: its document IDs are globally unique within the database and typed by table, so the `servers._id` can be the permanent identity. Mutations are atomic and serializable, while calls to external systems belong in actions rather than mutations; that external-API boundary is precisely why provisioning needs a durable operation record rather than relying on an in-memory workflow. ([Convex](https://docs.convex.dev/database/document-ids?utm_source=chatgpt.com))

## Recommended model

Think of the layers this way:

| Concept | Lifetime | Meaning |
|---|---|---|
| `server` | Customer lifetime | “The server David owns/shares”; survives replacement |
| purchase configuration | Customer lifetime, possibly later superseded by explicit upgrade | What was promised and which provisioning strategy was selected when bought |
| `serverOperation` | One requested change | Durable workflow/audit record: create, replace, recover, delete, transfer ownership |
| `serverIncarnation` | One concrete compute lifetime | One actual VM/bare-metal realization of the logical server |
| provider resource identity | Incarnation lifetime | How to find/manage that incarnation in its backend |
| live provider state | Short-lived | Power state, current capacity, availability etc.; query/reconcile, do not make it product identity |

I would use five tables now.

### `servers`

This is the durable product object.

Conceptually:

```ts
servers: {
  slug: string,

  purchase: {
    sku: string,
    termsRevision: string,

    // Store only things you actually promise the customer.
    terms: {
      cpu: number,
      memoryMiB: number,
      rootDiskGiB: number,
      // other contractual dimensions only
    },

    placement: {
      regionKey: string,
      // or exactLocation if location itself is contractual
    },

    // Today this is deliberately Hetzner-specific, not "generic".
    hcloud: {
      projectKey: string,
      serverType: string,
      imageRef: string,
    },
  },

  currentIncarnationId?: Id<"serverIncarnations">,
  deletedAt?: number,
}
```

The important part is that **purchase configuration is a snapshot, not a lookup through today's defaults**. If your `small` SKU maps to `cpx32` today and later maps to your own VM pool, an already purchased server is not reinterpreted through the new mapping.

`terms` should contain only customer-visible guarantees. If your commercial contract merely promises `"small-2026-09"` and you retain an immutable catalog revision elsewhere, you can make it smaller. Do not copy twenty provider attributes merely because Hetzner returned them.

I would not put `ownerId` here. Ownership is one membership role, and treating it through the same membership relation avoids two competing authorization models.

### `serverSlugClaims`

```ts
serverSlugClaims: {
  slug: string,
  serverId: Id<"servers">,
}
```

Indexes:

```ts
.by_slug(slug)
.by_server(serverId)
```

`servers.slug` is the current convenient value; `serverSlugClaims` is the permanent namespace ledger.

On rename, a **single Convex mutation** checks `by_slug`, inserts the new claim, patches `servers.slug`, and records the rename if you want it audited. Never delete the old claim, including when the server is deleted. Convex indexes are not unique constraints themselves, but the check-and-insert mutation can safely enforce the invariant because Convex mutations execute transactionally with serializable isolation. ([Convex](https://docs.convex.dev/database/reading-data/indexes/?utm_source=chatgpt.com))

This gives you both requirements cleanly:

`serverId` never changes; `slug` may change; no slug that ever existed can be claimed again.

### `serverMemberships`

```ts
serverMemberships: {
  serverId: Id<"servers">,
  userId: Id<"users">,
  role: "owner" | "write" | "read",
}
```

Useful indexes are `(serverId,userId)`, `userId`, and perhaps `(serverId,role)`.

Enforce exactly one owner inside mutations. An ownership transfer changes the two membership rows atomically and writes the corresponding operation record in the same mutation. That means there is never an intermediate state with two owners or no owner visible to another transaction. ([Convex](https://docs.convex.dev/functions/mutation-functions?utm_source=chatgpt.com))

Do not make “payer” another name for owner. When billing arrives those are separate relationships.

### `serverOperations`

This is both your audit record and your durable external-workflow record.

I would make it a **strict discriminated union**, not `{ details: v.any() }`:

```ts
type Operation =
  | CreateOperation
  | ReplaceOperation
  | RecoverOperation
  | DeleteOperation
  | TransferOwnershipOperation;
```

Common conceptual fields:

```ts
{
  serverId,
  kind,
  state:
    | "pending"
    | "running"
    | "needsReconciliation"
    | "succeeded"
    | "failed",

  actorUserId?,
  startedAt?,
  finishedAt?,

  failure?: {
    code: string,
    message: string,
    retryable: boolean,
  },
}
```

Then each kind has validated fields. For example, transfer ownership has `fromUserId` and `toUserId`; replacement can have `oldIncarnationId` and eventually `newIncarnationId`; a Hetzner-backed provisioning operation can have a small typed subobject such as `{ projectKey, actionId }`.

Convex supports discriminated unions and runtime schema validation, and its object validators reject unspecified properties. That makes a typed provider-specific subobject much preferable to a generic unvalidated JSON blob. ([Convex](https://docs.convex.dev/database/schemas?utm_source=chatgpt.com))

This table matters because a Convex mutation cannot atomically commit both your database changes and an HTTP call to Hetzner. Mutations do database transactions; actions perform external calls and are not transactional database functions. ([Convex](https://docs.convex.dev/functions/mutation-functions?utm_source=chatgpt.com))

So the pattern is:

```text
transaction: establish intent / operation
        ↓
action: call provider
        ↓
transaction: commit observed result
```

If the action dies after the provider succeeded but before the second transaction, the operation remains `running` or becomes `needsReconciliation`; it has not disappeared from history.

Hetzner resources support labels and label selectors, so assigning a compact application server/operation identifier as a provider label gives reconciliation code a way to discover a resource after an uncertain create outcome. Hetzner also represents many changes as asynchronous Actions that move to success/error, reinforcing the usefulness of persisting the relevant external action ID when applicable. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

### `serverIncarnations`

This is the one abstraction I would introduce before multiple backends:

```ts
serverIncarnations: {
  serverId: Id<"servers">,
  createdByOperationId: Id<"serverOperations">,
  supersedesId?: Id<"serverIncarnations">,

  readyAt?: number,
  retiredAt?: number,
  lostAt?: number,

  hcloud: {
    projectKey: string,
    serverId: number,
    serverType: string,
    location: string,
  },
}
```

The incarnation represents **one concrete running identity**, not “some allocation-shaped thing.”

`servers.currentIncarnationId` is the authority for which incarnation currently implements the server. The old incarnation remains a historical row after replacement.

I would deliberately call the current backend field `hcloud`, rather than introducing:

```ts
provider: "hetzner" | "futureMaybe" | ...
providerData: any
```

That fake abstraction buys nothing today.

## Provider-project identity

For Hetzner Cloud, external identity should effectively be:

```text
(projectKey, Hetzner server ID)
```

not merely the provider server ID.

Hetzner API tokens are bound to the project in which they were created; using a different project's resources requires a different token. ([Hetzner Docs](https://docs.hetzner.com/cloud/api/getting-started/using-api/?utm_source=chatgpt.com))

`projectKey` should be **your stable logical name for that credential scope**, for example:

```text
hcloud-prod-eu-a
```

It need not be a Hetzner-returned “project ID.” Its purpose is to tell your backend which credential/context manages the resource.

Do not put the token itself in an incarnation. Convex explicitly positions deployment environment variables as a place for API keys/secrets. Store the non-secret `projectKey` in data and map that to the appropriate credential. ([Convex](https://docs.convex.dev/production/environment-variables?utm_source=chatgpt.com))

I would not add a `providerProjects` table yet if you have one or a handful of statically administered projects. Add it when projects themselves acquire lifecycle/configuration that your application needs to manage dynamically. The durable `projectKey` in incarnation records means you can add that table later without changing resource identity.

## Purchase-time resolution versus placement-time resolution

There are two different things that are often accidentally called “placement.”

At **purchase time**, resolve and persist:

| Resolve now | Why |
|---|---|
| SKU/revision and promised resources | Old purchases must retain their contract |
| customer placement constraint | e.g. product region or exact location if promised |
| provisioning backend/config | So tomorrow's default does not reinterpret yesterday's purchase |
| HCloud project scope | Needed to operate the resource later |
| HCloud server type or other product-to-provider mapping | This is your commercial/backend choice, not live capacity |
| desired image/build reference | Needed to recreate/recover consistently |

At **provisioning time**, resolve:

| Resolve live | Why |
|---|---|
| whether a provider offering is currently orderable | Changes independently of your software |
| concrete location when purchase allows several | Capacity changes |
| actual resource ID | Doesn't exist until creation |
| observed host/backend placement | Result, not customer identity |

Do not put Hetzner's current server types, locations, or availability into TypeScript literal unions just to make them “typed.” Hetzner changed its API so server types are location-dependent, and its documented availability indication is explicitly not a guarantee that resources can actually be created. Those are live provider data, not repository vocabulary. ([Hetzner Cloud](https://docs.hetzner.cloud/changelog?utm_source=chatgpt.com))

Your own concepts can absolutely be enums:

```ts
"eu"
"us"
"shared"
"dedicated"
```

if those are product semantics you control.

But this is the wrong kind of enum:

```ts
type HetznerLocation = "fsn1" | "nbg1" | "hel1" | ...;
```

Use validated strings at the provider boundary and persist the chosen value as historical fact.

## Capability differences

Do not attempt to normalize every future backend into one persisted `capabilities` object.

There are really two sorts of capability:

**Entitled capability** means something the customer bought or you promise contractually. That belongs to the durable server/purchase entitlement.

**Operational backend capability** means what this current incarnation can presently do: snapshotting, console access, rescue mode, hot disk attachment, resize, live migration, floating addressing, etc. Compute that from the backend adapter plus incarnation state.

For example, a Hetzner Cloud VM exposes rebuild, rescue, console, server-type changes and other server actions through that backend's API. Those facts do not imply a VM on your dedicated-host pool or a bare-metal machine should implement the same contract. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

So don't persist:

```ts
supportsSnapshots: true
supportsRescue: true
supportsConsole: true
```

on the logical server merely because the first backend happens to support those things.

Once there are multiple implementations, your TypeScript backend layer can answer “what actions are available for this incarnation?” without turning those answers into long-lived domain state.

## Failure, replacement, transfer, deletion and recovery

The recommended semantics are:

| Scenario | Durable result |
|---|---|
| Purchase accepted | `server`, slug claim, owner membership and `create` operation exist |
| Provider rejects create before a resource exists | `create` operation becomes `failed`; no incarnation is required |
| Provider outcome is uncertain | operation becomes `needsReconciliation`; don't blindly create a second VM |
| Provider resource is observed | incarnation records its external identity |
| First incarnation becomes ready | atomically set `servers.currentIncarnationId`; create operation succeeds |
| Replacement starts | keep old incarnation current while creating the next |
| Replacement fails | operation fails; old incarnation remains current |
| Replacement succeeds | atomically switch current pointer, then retire/delete old incarnation |
| Ownership transfer | atomically update membership roles plus a successful transfer operation |
| Recovery creates replacement compute | `recover` operation plus new incarnation, normally superseding the lost one |
| Delete requested | durable delete operation first; external deletion second |
| Delete confirmed | set `deletedAt`, clear/retire current incarnation; retain server tombstone/history/slug claims |

That replacement rule is especially valuable. Never tear down the old incarnation merely because creation of its successor has begun.

For recovery after an ambiguous external result, reconcile before retrying. A provider label derived from your operation/server identity can help locate an already-created HCloud resource because Hetzner supports labels and server/resource filtering by labels. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

Deletion should normally be a **product deletion, not a database hard-delete**. Keeping the server tombstone makes audit/billing references stable, while keeping `serverSlugClaims` is necessary to satisfy your explicit “historical slugs are never reused” rule.

## What is necessary now, and what is premature

| Build now | Wait until a second backend / feature exists |
|---|---|
| stable `servers._id` | generic `allocations` table |
| current mutable slug | `backendKind` on every server merely for anticipation |
| permanent slug claims | generic provider-resource blob |
| current membership table | hypervisor host/fleet tables |
| purchase/contract snapshot | VM-pool capacity model |
| resolved HCloud provisioning recipe | bare-metal-specific fields |
| server operation journal | migration workflow between backends |
| replaceable incarnation identity | persisted cross-backend capability matrix |
| HCloud project key + provider resource ID | lowest-common-denominator disk/network models |
| deletion tombstone | billing entitlement table, until billing actually exists |

The thing I would resist most strongly is an `allocations` table whose initial row looks like:

```ts
{
  serverId,
  kind: "hetzner",
  provider: "hetzner",
  data: { ...whateverHetznerReturned }
}
```

It is simultaneously too generic to be useful and too provider-shaped to be portable.

## Schema evolution when the VM-pool backend arrives

You don't need `ServerV1` / `ServerV2`, and you don't need:

```ts
server.version = 2;
```

The logical server did not change type. You added another way to realize it.

Suppose today's field is:

```ts
purchase: {
  ...
  hcloud: {
    projectKey: string,
    serverType: string,
    imageRef: string,
  }
}
```

When you actually implement backend two, introduce a **provisioning strategy union**:

```ts
provisioning:
  | {
      kind: "hcloud";
      projectKey: string;
      serverType: string;
      imageRef: string;
    }
  | {
      kind: "vmPool";
      poolKey: string;
      vmClass: string;
      imageRef: string;
    }
```

Likewise, incarnation backend identity can become:

```ts
binding:
  | {
      kind: "hcloud";
      projectKey: string;
      serverId: number;
      serverType: string;
      location: string;
    }
  | {
      kind: "vmPool";
      poolKey: string;
      vmId: string;
    }
```

That is a **sum of actual domain alternatives**, not a version discriminator.

Do the Convex migration in the usual expand/backfill/contract sequence: add the new field as optional or temporarily accept both shapes, backfill existing HCloud documents, switch readers/writers, then make the new shape required and remove the old one. Convex explicitly documents optional-field and union-based migrations of this form because pushed schemas must match existing documents. ([Convex](https://docs.convex.dev/database/schemas?utm_source=chatgpt.com))

If the second backend's detail becomes substantially larger, that is the point where I'd consider backend-specific tables such as `hcloudIncarnations` and `vmPoolIncarnations` rather than letting the union grow indefinitely. You do **not** need to decide that today.

## Worked example: switch new purchases to the VM pool

Assume `alpha` already exists before the switch.

Before backend two:

```text
servers/A
  slug = "alpha"
  purchase.hcloud =
    projectKey: "hcloud-prod"
    serverType: "cpx32"
  currentIncarnationId = IA1

incarnation IA1
  hcloud.projectKey = "hcloud-prod"
  hcloud.serverId   = 48151623
  hcloud.location   = "fsn1"
```

When the pool backend ships, migrate A's purchase configuration and incarnation into the new strict unions:

```text
servers/A.provisioning
  kind = "hcloud"
  projectKey = "hcloud-prod"
  serverType = "cpx32"

IA1.binding
  kind = "hcloud"
  projectKey = "hcloud-prod"
  serverId = 48151623
  location = "fsn1"
```

Now change **only the purchase resolver's current default**:

```text
current backend for new purchases:
    vmPool / pool-eu-1
```

Customer B purchases `beta` afterwards:

```text
servers/B
  slug = "beta"
  provisioning =
    kind: "vmPool"
    poolKey: "pool-eu-1"
    vmClass: "standard-4"
```

Its create operation asks the VM-pool adapter for a VM and eventually produces:

```text
incarnation IB1
  binding =
    kind: "vmPool"
    poolKey: "pool-eu-1"
    vmId: "vm-9182"
```

Nothing happens to A. A's power operations, delete, recovery and ordinary replacement continue dispatching through its stored HCloud strategy/binding.

Most importantly, if A needs a replacement next week, its replacement stays HCloud by default. Changing the global purchase default to `vmPool` is **not migration policy**. If you later decide to move A, that should be an explicit backend-migration feature with explicit disk/network semantics; it should not fall out accidentally from the current default.

That gives you exactly the property you asked for:

```text
purchase time chooses implementation
server lifetime remembers implementation
global default only affects later purchases
```

## Where future billing belongs

Future billing entitlements should reference the **stable server ID**, never an incarnation or Hetzner resource ID.

Later, something like:

```ts
serverEntitlements: {
  serverId: Id<"servers">,
  billingAccountId: Id<"billingAccounts">,
  sku: string,
  revision: string,
  effectiveFrom: number,
  effectiveUntil?: number,
  state: ...,
}
```

is reasonable.

That allows incarnation `IA1 → IA2 → IA3` without changing what the customer owns or is entitled to.

It also deliberately separates ownership from payment. A server ownership transfer need not silently transfer an external Stripe/customer agreement; whether billing follows the server is then an explicit business transaction instead of an accidental consequence of changing `owner`.

I would not create this table until billing or entitlement history actually exists.

## What this model deliberately does **not** make portable

- **Disks, snapshots and backups.** Root-disk image semantics, persistent volumes, snapshots and restore guarantees differ. Hetzner itself distinguishes Volumes, snapshot Images and backup Images; its backups are bound to one server and are deleted with that server unless converted appropriately. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))
- **IP addresses and networking.** Provider addresses should not be part of logical server identity. HCloud Primary IPs are location-bound; Floating IPs have different reassignment semantics. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))
- **Console/rescue/rebuild semantics.** Those are backend operations, not promises implicit in “server.”
- **Private networks, firewall attachments, load balancers and routing.** Treat these as separate domains if you eventually expose them.
- **CPU topology/performance, NUMA, local NVMe and host affinity.** “4 vCPU” does not make VM and bare-metal execution equivalent.
- **Provider availability, capacity and failure domains.** They are placement inputs, not stored product enums.
- **Automatic backend migration.** The model makes an explicit migration possible later; it does not pretend disks, IPs and runtime state can be moved generically.

The core recommendation is therefore: **make `Server` the commercial/security identity, make `Incarnation` the replaceable compute identity, and make `Operation` the durable bridge across nontransactional provider calls. Do not introduce “Allocation” until backend two demonstrates a real common invariant that is not already captured by Incarnation.**
