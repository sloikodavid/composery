# Hetzner Cloud

Use one Hetzner Cloud project per environment. Each Convex deployment needs its own project token and controller identity. Do not give preview deployments production infrastructure tokens.

## Setup

1. In the project's **Security > API Tokens**, create a **Read & Write** token. Set it as `HCLOUD_TOKEN` in the matching Convex deployment's environment settings. Enter secrets in the dashboard rather than chat or shell history. This is the [official CLI variable convention](https://github.com/hetznercloud/setup-hcloud).
2. Generate a UUID for `HCLOUD_CONTROLLER_ID`. Keep it stable across token rotations and application renames. It is not a secret. Do not copy it to an independent environment.
3. Claim the project, once the token and the controller identity are set: `convex run allocations/hetzner_cloud/project:claimFirewall`. It makes the firewall every server is put behind, labelled with that identity, with the rules `convex/allocations/hetzner_cloud/firewall.ts` states. Run it again whenever you like: it finds what it made before, and puts the rules back if they were changed at the provider.

   Nothing else makes that firewall, and the deployment only ever looks for it. That is what a wrong-project token runs into: a project without it is refused, rather than read as one where every server had been deleted. Do not delete it or change its label while it holds allocations.
4. Set `HCLOUD_LOCATIONS` to the ordered, comma-separated location preference. For CX23 the initial preference is `nbg1,fsn1,hel1`. This is application configuration, not a CLI convention. Validate catalog support through the API. Advertised capacity is a hint; it does not guarantee creation.
5. Set `HCLOUD_IMAGE` to the system image every server starts from, such as `ubuntu-24.04`, and `HCLOUD_SERVER_TYPE` to the type they are made of, such as `cx23`. Neither has a default: a deployment says what it sells rather than inheriting what somebody wrote down once. The image name is resolved to an ID and that ID is stored with each allocation, so changing either setting affects new allocations only, and what a server was made from does not move under it. The architecture is not configured at all: it is read from the type Hetzner offers, and the image is matched to it.
6. Push the backend to the intended deployment. Use internal `quotas:setForDeployment` with kind `server` and a limit at or below the project's server limit, which Hetzner sets for each project and does not report through the API. Request an increase from Hetzner support before raising it. Then use internal `quotas:setForUser` with a local user ID, kind `server`, and a limit. Both start at zero, so nothing is created until they are set, and a zero limit stops new servers without deleting existing ones.

All variables are listed in `.env.convex.example`. They are optional at deployment time so an environment can run without provisioning. Creating a server requires the token, controller identifier, firewall ID, locations, both quotas, and the SSH access keys that `docs/setups/convex.md` describes.

The initial Ubuntu image must include Python 3 and cloud-init. Allow outbound HTTPS to the deployment's `CONVEX_SITE_URL`. Cloud-init installs the public management key for root, generates the native host keys, and reports the public Ed25519 host key to `/ssh/host-keys`. A provisioning-delivered token authenticates the report, expires after one hour, and cannot replace an already registered host key. The report retries for a bounded period. Provider running state does not establish that registration or SSH login succeeded. Callback failure must not fall back to trusting a network-observed key. Cloud-init and provider metadata can retain the expired bootstrap token; they never receive the management private key.

An allocation records which firewall it is behind when it is first worked on, so replacing the firewall leaves every existing allocation naming the old one. Replacing it is therefore deliberate work, not a claim run again. Rotate tokens within the same project; moving to another project is not token rotation.

## A project for the tests

Tests reach a fake by default and can reach Hetzner itself for one run. That run needs a project of its own, holding nothing else, so that what it removes can be everything it finds.

1. Create a second Hetzner Cloud project, used by nothing that anybody depends on.
2. In its **Security > API Tokens**, create a **Read & Write** token.
3. Copy `.env.test.example` to `.env.test`, which git ignores, put the token in `HCLOUD_TOKEN`, and leave `HCLOUD_MODE=fake`. The token alone changes nothing: a plain `bun test` keeps the fake, so the credentials can stay there between runs.
4. Run `HCLOUD_MODE=real bun test tests/convex/allocations`. Setting it to `real` in the file makes every run meet Hetzner instead, and `HCLOUD_MODE=fake bun test` still keeps the fake for one run.

The run makes its own firewall and labels everything it creates with its own identity, removes all of it at the end, and removes what a run that was killed left behind. Anything still in that project afterwards is a leak, and it is visible as one. Nothing else in the repository needs a Hetzner token, and none is needed to run the tests.

One CX23 exists at a time, for the minutes a test takes. Stopping a server does not end its charges, and only deleting it does. Never print environment values, raw create responses, root passwords, or authorization headers; an authenticated Convex CLI can put a deployment's token into a subprocess for a check, without showing it.

Guest login is a separate check from provider running state. A host key callback proves neither inbound reachability nor login. Do not open inbound ports beyond the firewall rules above to make a check pass.

## Recovery

Inspect the allocation's status and operation in `serverAllocations` and `serverOperations`, and its resources, due time, error, and Hetzner error code in `hetznerCloudAllocations`. `hetznerCloudScans` contains scan progress and errors. Unresolved `hetznerCloudFindings` require admin review; the controller never deletes unknown resources on that basis.

For a corrected configuration or definitive provider rejection, call internal `allocations/hetzner_cloud/worker_state:retry` with the allocation ID. For an uncertain create, first search provider inventory and verify that no outstanding request can still create the resource. Only then may an admin supply `confirmedAbsent` (`ipv4`, `ipv6`, or `server`). An empty lookup alone is not sufficient proof. The normal worker automatically adopts matching resources that appear later.

Customer app domains, billing, and customer SSH keys are not required for this lifecycle.
