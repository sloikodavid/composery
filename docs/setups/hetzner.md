# Hetzner

Use one Hetzner Cloud project per environment. Each Convex deployment needs its own project token and controller identity. Do not give preview deployments production infrastructure credentials.

## Setup

1. In the project's **Security > API Tokens**, create a **Read & Write** token. Set it as `HCLOUD_TOKEN` in the matching Convex deployment's environment settings. Enter secrets in the dashboard rather than chat or shell history. This is the [official CLI variable convention](https://github.com/hetznercloud/setup-hcloud).
2. Generate a UUID for `HCLOUD_CONTROLLER_ID`. Keep it stable across token rotations and application renames. It is not a secret. Do not copy it to an independent environment.
3. Create a Cloud Firewall named `servers`, with label `controller-id` equal to that UUID. Initially leave inbound rules empty. Set its numeric ID as `HCLOUD_FIREWALL_ID`. The controller verifies this binding before requests; a wrong-project token must fail rather than interpret missing resources as successful deletion.
4. Set `HCLOUD_LOCATIONS` to the ordered, comma-separated location preference. For CX23 the initial preference is `nbg1,fsn1,hel1`. This is application configuration, not a CLI convention. Validate catalog support through the API. Advertised capacity is a hint; it does not guarantee creation.
5. Optionally set `HCLOUD_IMAGE`; the default is `ubuntu-24.04`. The resolved image ID is stored with each allocation. Changing the setting affects new allocations only.
6. Push the backend to the intended deployment. Use internal `server_lifecycle:setGrant` with a local user ID and a nonnegative server limit to permit provisioning. A zero limit prevents new allocations but does not delete existing servers. Public signup alone does not grant provisioning.

All variables are listed in `.env.convex.example`. They are optional at deployment time so an environment can run without provisioning. Creating a server requires the token, controller identifier, firewall ID, locations, and an available grant.

Do not delete or change the controller label on the shared firewall while it manages allocations. If it must be replaced, reconcile existing allocations with the replacement deliberately; changing the environment variable alone does not rewrite stored allocation bindings. Rotate tokens within the same project. Moving to another project is not token rotation.

## Local verification

An authenticated Convex CLI can retrieve `HCLOUD_TOKEN` into a private subprocess or shell variable for local API checks. Capture stdout without displaying it, use it only in authorization headers, and discard it. Never print environment values, raw create responses, root passwords, or authorization headers. A second persistent token copy in `.env.local` is unnecessary.

Use one disposable CX23 at a time and the agreed approximately EUR 1 total ceiling. Verify the provider VM and both Primary IP IDs are absent after deletion, including after interrupted tests. Stopping a VM does not end its allocation charges. Leave the shared `servers` firewall in place.

Guest login is a separate check from provider running state. It needs a temporary local SSH key, a narrow source-address firewall rule, and a trusted host-key verification path. Customer SSH is not implemented by the lifecycle feature. Do not broadly open inbound access just to make a check pass.

## Recovery

Inspect the allocation's error, operation, resources, and due time. `serverInventory` contains scan progress/errors. Unresolved `serverFindings` require operator review; the controller never destroys unknown resources on that basis.

For a corrected configuration or definitive provider rejection, call internal `server_lifecycle:retry` with the allocation ID. For an uncertain create, first search provider inventory and verify that no outstanding request can still create the resource. Only then may an operator supply `confirmedAbsent` (`ipv4`, `ipv6`, or `server`). An empty lookup alone is not sufficient proof. The normal worker automatically adopts matching resources that appear later.

Customer app domains, billing credentials, and customer SSH credentials are not required for this lifecycle.
