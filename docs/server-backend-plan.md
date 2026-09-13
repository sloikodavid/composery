# Server backend

The first backend uses Hetzner Cloud CX23 servers. It implements creation, observation, graceful stop, forced stop, start, deletion, and recovery. Customer SSH, app exposure, snapshots, billing, and the admin UI are separate features.

## Data and ownership

`servers` holds the stable identity and current name. `serverNames` permanently associates each claimed name with that identity. A server can rename back to its own old name; another server cannot claim it, even after deletion.

`serverMembers` remains the authorization source. Read/write describe control-panel permissions, not operating-system permissions. Read members can inspect status. Write members can rename and operate power. Owners manage members and request deletion. Customer root access will be implemented separately.

`serverAllocations` binds one server to a concrete backend and records its resolved machine configuration, IP identities, provider identity, observations, and recovery state. `serverOperations` records user commands and request IDs. A future backend can be added without changing existing allocations. No migration or cross-backend disk portability is implied.

`serverGrants` provides operator-controlled capacity before billing. Admission reserves a slot in the same transaction as server creation and enqueueing. Slots remain used until every owned resource is confirmed absent. Changing a grant's limit affects new allocations; it does not delete existing servers.

## Provider boundary

The shared firewall is named `servers`. An opaque `controller-id` label binds it to the controller configured by `HCLOUD_CONTROLLER_ID`. It contains no product, project, or deployment name. The controller checks this binding before operating resources. Rotating a token within the same Hetzner project does not change this identity.

Owned VMs and IPs also carry `allocation-id` and `resource-kind` labels. Their provider names derive from the allocation ID, independently of the user's mutable name. A mismatched identity is an error, never authority to adopt or delete a foreign resource.

Both Primary IPs are allocated explicitly before the VM. They use automatic deletion with the VM as an additional safeguard, and the controller still verifies their removal. Shared firewalls are not deleted with individual servers.

The configured location order is a preference. The controller prefers a supported location with advertised capacity, then a supported location if none advertises capacity. The create response is authoritative. The resolved location, image ID, and server type are stored before submission and stay fixed through retries. Existing IPs are location-bound; changing location is not a retry operation.

The default image is Ubuntu 24.04. Inbound traffic is closed by the configured provider firewall until access features are configured. Cloud-init disables SSH password login and locks the root password. No provider token or customer login credential is stored in the guest or returned by the public API. Provider running state does not assert guest or app health.

## Durable work

Creation saves intent and queues work in one Convex mutation. Workpool limits general work to two workers and reserves one worker for cleanup. Separate rate-limit buckets reserve API allowance for cleanup. The due-work sweep is indexed and bounded; it admits cleanup independently of new provisioning.

Each worker claims an epoch and lease. A create dispatch is recorded as uncertain before the HTTP call. A lost response, invalid success response, or worker crash can therefore be recovered by lookup. No lower layer retries a create automatically. A definite rejection can return the resource to pending with bounded backoff; an unknown outcome stays uncertain until a matching resource is found or an operator confirms absence.

A lease fences database writes, not external requests. A stale worker cannot overwrite newer state. Resource identities survive a delete request so a late create can still be discovered and removed. Operator absence confirmation requires checking that old work and requests have finished; it is not an ordinary retry button.

Power commands use explicit request IDs and serialize against existing commands. Start, graceful stop, and forced stop are distinct. Graceful stop never silently escalates to forced power-off. Commands have a deadline; blocked operations need operator recovery. Successful operations do not continuously enforce power, so a later guest shutdown is observed rather than reversed.

Deletion records intent first. The controller removes the VM, verifies absence, and then verifies/removes owned IPs. Only then does it release capacity, remove the server and memberships, and retain operation/allocation history plus permanent name claims. Missing or incomplete Clerk profile fields disable app access without initiating deletion. Confirmed account deletion enters the same durable cleanup path.

Provider action IDs accelerate progress but are not permanent resource identities. Missing actions can be reconciled from the resources. Stalled actions and identity drift produce explicit failures. Provider error codes are stored; raw responses, root passwords, and authorization headers are not logged.

Inventory scans inspect one bounded provider page at a time. They wake allocations with uncertain resources and record unrecognized resources in `serverFindings` for operator review. They do not delete unknown resources. Findings are evidence requiring review, not automatic destructive instructions. Missing or changed ownership labels cannot reliably be attributed to this controller.

## API

- `servers.create({ name, requestId })`: requires a provisioning grant; retries reuse the exact request ID and name.
- `servers.rename({ serverId, name })`: permits names previously claimed by the same server.
- `server_lifecycle.status({ serverId })`: member-authorized status, addresses, observation time, and current operation.
- `server_lifecycle.power({ serverId, requestId, command })`: `start`, `stop`, or `forceStop`.
- `servers.remove({ serverId })`: owner-authorized durable deletion.
- Internal `server_lifecycle.setGrant({ userId, limit })`: operator admission control.
- Internal `server_lifecycle.retry({ allocationId, confirmedAbsent? })`: operator recovery. Only confirm absence for an uncertain resource after provider verification.

No frontend changes or committed test framework are included. Disposable checks belong in `tmp/`. Setup is in [Hetzner](setups/hetzner.md).

## Research disposition

The eight imported conversations in `docs/research` are supporting input, not instructions. Their useful conclusions are explicit resource ownership, durable uncertainty, independent server identity, and external app authorization. Their proposals for a private-network gateway fleet, read-only SSH implied by the read role, billing tables, mandatory snapshot metadata, and opaque canonical app URLs were not adopted as prerequisites. Those topics either conflict with the agreed product contract or belong to later features.
