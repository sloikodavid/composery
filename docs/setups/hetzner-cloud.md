# Hetzner Cloud

Use one Hetzner Cloud project per environment. Each Convex deployment needs its own project token and controller identity. Do not give preview deployments production infrastructure tokens.

## Setup

1. In the project's **Security > API Tokens**, create a **Read & Write** token. Set it as `HCLOUD_TOKEN` in the matching Convex deployment's environment settings. Enter secrets in the dashboard rather than chat or shell history. This is the [official CLI variable convention](https://github.com/hetznercloud/setup-hcloud).
2. Generate a UUID for `HCLOUD_CONTROLLER_ID`. Keep it stable across token rotations and application renames. It is not a secret. Do not copy it to an independent environment.
3. Create a Cloud Firewall named `servers`, with label `controller-id` equal to that UUID. Add inbound rules from any IPv4 and IPv6 source for TCP 22, 80, and 443, UDP 443, and ICMP, and no outbound rules, so outbound traffic stays open. Other inbound ports are opened only through support. Set its numeric ID as `HCLOUD_FIREWALL_ID`. The controller verifies this binding before requests; a wrong-project token must fail rather than interpret missing resources as successful deletion.
4. Set `HCLOUD_LOCATIONS` to the ordered, comma-separated location preference. For CX23 the initial preference is `nbg1,fsn1,hel1`. This is application configuration, not a CLI convention. Validate catalog support through the API. Advertised capacity is a hint; it does not guarantee creation.
5. Optionally set `HCLOUD_IMAGE`; the default is `ubuntu-24.04`. The resolved image ID is stored with each allocation. Changing the setting affects new allocations only.
6. Push the backend to the intended deployment. Use internal `quotas:setForDeployment` with kind `server` and a limit at or below the project's server limit, which Hetzner sets for each project and does not report through the API. Request an increase from Hetzner support before raising it. Then use internal `quotas:setForUser` with a local user ID, kind `server`, and a limit. Both start at zero, so nothing is created until they are set, and a zero limit stops new servers without deleting existing ones.

All variables are listed in `.env.convex.example`. They are optional at deployment time so an environment can run without provisioning. Creating a server requires the token, controller identifier, firewall ID, locations, `SSH_ACCESS_ENCRYPTION_KEYS`, and both quotas.

Set `SSH_ACCESS_ENCRYPTION_KEYS` to 32 cryptographically random bytes encoded as base64. Pipe the value into `convex env set SSH_ACCESS_ENCRYPTION_KEYS` without displaying it. Keep a secure backup; losing every key in the list makes the stored SSH access secrets unreadable, and no customer can be given that access back. Each allocation has a separate Ed25519 management key, encrypted with AES-256-GCM and bound to its allocation ID.

The setting is an ordered, comma-separated list. The first key encrypts every new value, and every key in the list can read one. Each envelope records which key encrypted it, so rotation is three steps and its progress is a fact rather than a hope:

1. Append the new key: `K_old,K_new`. Every reader now knows it; nothing uses it yet.
2. Move it to the front: `K_new,K_old`. New values are encrypted with it; old ones still read.
3. Run `convex run ssh/secrets:reEncrypt '{}'`. It reports how many values it encrypted again and which keys are still named. When only the new key is named, remove the old one from the list.

Doing this in one step would leave values that a deployment still holding only the old key cannot read. Never overwrite the list with a single new key while allocations hold secrets encrypted by the old one.

The initial Ubuntu image must include Python 3 and cloud-init. Allow outbound HTTPS to the deployment's `CONVEX_SITE_URL`. Cloud-init installs the public management key for root, generates the native host keys, and reports the public Ed25519 host key to `/ssh/host-keys`. A provisioning-delivered token authenticates the report, expires after one hour, and cannot replace an already registered host key. The report retries for a bounded period. Provider running state does not establish that registration or SSH login succeeded. Callback failure must not fall back to trusting a network-observed key. Cloud-init and provider metadata can retain the expired bootstrap token; they never receive the management private key.

Do not delete or change the controller label on the shared firewall while it manages allocations. If it must be replaced, reconcile existing allocations with the replacement deliberately; changing the environment variable alone does not rewrite stored allocation bindings. Rotate tokens within the same project. Moving to another project is not token rotation.

## Local verification

An authenticated Convex CLI can retrieve `HCLOUD_TOKEN` into a private subprocess or shell variable for local API checks. Capture stdout without displaying it, use it only in authorization headers, and discard it. Never print environment values, raw create responses, root passwords, or authorization headers. A second persistent token copy in `.env.local` is unnecessary.

Use one disposable CX23 at a time and the agreed approximately EUR 1 total ceiling. Verify the provider VM and both Primary IP IDs are absent after deletion, including after interrupted tests. Stopping a VM does not end its allocation charges. Leave the shared `servers` firewall in place.

Guest login is a separate check from provider running state. A host key callback proves neither inbound reachability nor login. Do not open inbound ports beyond the firewall rules above to make a check pass.

## Recovery

Inspect the allocation's status and operation in `serverAllocations` and `serverOperations`, and its resources, due time, error, and Hetzner error code in `hetznerCloudAllocations`. `hetznerCloudScans` contains scan progress and errors. Unresolved `hetznerCloudFindings` require admin review; the controller never deletes unknown resources on that basis.

For a corrected configuration or definitive provider rejection, call internal `allocations/hetzner_cloud/worker_state:retry` with the allocation ID. For an uncertain create, first search provider inventory and verify that no outstanding request can still create the resource. Only then may an admin supply `confirmedAbsent` (`ipv4`, `ipv6`, or `server`). An empty lookup alone is not sufficient proof. The normal worker automatically adopts matching resources that appear later.

Customer app domains, billing, and customer SSH keys are not required for this lifecycle.
