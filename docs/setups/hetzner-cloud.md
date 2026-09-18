# Hetzner Cloud

Use one Hetzner Cloud project per environment. Each Convex deployment needs its own project token and controller identity. Do not give preview deployments production infrastructure tokens.

## Setup

1. In the project's **Security > API Tokens**, create a **Read & Write** token. Set it as `HCLOUD_TOKEN` in the matching Convex deployment's environment settings. Enter secrets in the dashboard rather than chat or shell history. This is the [official CLI variable convention](https://github.com/hetznercloud/setup-hcloud).
2. Generate a UUID for `HCLOUD_CONTROLLER_ID`. Keep it stable across token rotations and application renames. It is not a secret. Do not copy it to an independent environment.
3. Create a Cloud Firewall named `servers`, with label `controller-id` equal to that UUID. Add inbound rules from any IPv4 and IPv6 source for TCP 22, 80, and 443, UDP 443, and ICMP, and no outbound rules, so outbound traffic stays open. Other inbound ports are opened only through support. Set its numeric ID as `HCLOUD_FIREWALL_ID`. The controller verifies this binding before requests; a wrong-project token must fail rather than interpret missing resources as successful deletion.
4. Set `HCLOUD_LOCATIONS` to the ordered, comma-separated location preference. For CX23 the initial preference is `nbg1,fsn1,hel1`. This is application configuration, not a CLI convention. Validate catalog support through the API. Advertised capacity is a hint; it does not guarantee creation.
5. Optionally set `HCLOUD_IMAGE`; the default is `ubuntu-24.04`. The resolved image ID is stored with each allocation. Changing the setting affects new allocations only.
6. Push the backend to the intended deployment. Use internal `quotas:setForDeployment` with kind `server` and a limit at or below the project's server limit, which Hetzner sets for each project and does not report through the API. Request an increase from Hetzner support before raising it. Then use internal `quotas:setForUser` with a local user ID, kind `server`, and a limit. Both start at zero, so nothing is created until they are set, and a zero limit stops new servers without deleting existing ones.

All variables are listed in `.env.convex.example`. They are optional at deployment time so an environment can run without provisioning. Creating a server requires the token, controller identifier, firewall ID, locations, both quotas, and the SSH access keys that `docs/setups/convex.md` describes.

The initial Ubuntu image must include Python 3 and cloud-init. Allow outbound HTTPS to the deployment's `CONVEX_SITE_URL`. Cloud-init installs the public management key for root, generates the native host keys, and reports the public Ed25519 host key to `/ssh/host-keys`. A provisioning-delivered token authenticates the report, expires after one hour, and cannot replace an already registered host key. The report retries for a bounded period. Provider running state does not establish that registration or SSH login succeeded. Callback failure must not fall back to trusting a network-observed key. Cloud-init and provider metadata can retain the expired bootstrap token; they never receive the management private key.

Do not delete or change the controller label on the shared firewall while it manages allocations. If it must be replaced, reconcile existing allocations with the replacement deliberately; changing the environment variable alone does not rewrite stored allocation bindings. Rotate tokens within the same project. Moving to another project is not token rotation.

## A project for the tests

Tests reach a fake by default and can reach Hetzner itself for one run. That run needs a project of its own, holding nothing else, so that what it removes can be everything it finds.

1. Create a second Hetzner Cloud project, used by nothing that anybody depends on.
2. In its **Security > API Tokens**, create a **Read & Write** token.
3. Copy `.env.local.tests.example` to `.env.local.tests`, which git ignores, and put the token in `HCLOUD_TOKEN`. Nothing loads that file on its own: a plain `bun test` must not be able to reach a real project, spend money, or leave anything behind. `bun check` fails if a file Bun would load by itself, such as `.env` or `.env.test`, exists here at all.
4. Run `bun run hetzner`.

The run makes its own firewall and labels everything it creates with its own identity, removes all of it at the end, and removes what a run that was killed left behind. Anything still in that project afterwards is a leak, and it is visible as one. Nothing else in the repository needs a Hetzner token, and none is needed to run the tests.

One CX23 exists at a time, for the minutes a test takes. Stopping a server does not end its charges, and only deleting it does. Never print environment values, raw create responses, root passwords, or authorization headers; an authenticated Convex CLI can put a deployment's token into a subprocess for a check, without showing it.

Guest login is a separate check from provider running state. A host key callback proves neither inbound reachability nor login. Do not open inbound ports beyond the firewall rules above to make a check pass.

## Recovery

Inspect the allocation's status and operation in `serverAllocations` and `serverOperations`, and its resources, due time, error, and Hetzner error code in `hetznerCloudAllocations`. `hetznerCloudScans` contains scan progress and errors. Unresolved `hetznerCloudFindings` require admin review; the controller never deletes unknown resources on that basis.

For a corrected configuration or definitive provider rejection, call internal `allocations/hetzner_cloud/worker_state:retry` with the allocation ID. For an uncertain create, first search provider inventory and verify that no outstanding request can still create the resource. Only then may an admin supply `confirmedAbsent` (`ipv4`, `ipv6`, or `server`). An empty lookup alone is not sufficient proof. The normal worker automatically adopts matching resources that appear later.

Customer app domains, billing, and customer SSH keys are not required for this lifecycle.
