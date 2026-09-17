# Hetzner API Survey

Source: https://chatgpt.com/share/6aac0b29-d6c8-83eb-bb00-2b7853176a5f

---

## Turn 1: User

_2026-09-17T13:56:45.426Z_

As of September 2026, Hetzner Cloud limits API requests to a default of 3600 per hour per project and pages lists at a maximum of 50 items. Survey how software that manages many Hetzner Cloud servers keeps its view of them current inside that limit. Use the source code and issue trackers of the Syself Cluster API provider for Hetzner (CAPH), hcloud-cloud-controller-manager, the Hetzner Terraform provider, hcloud-go, and any other open-source controller or panel that manages hundreds or thousands of Hetzner servers. For each: whether it reads servers one at a time or lists them by label selector, how often it polls, how it spends requests between reads and writes, what it does when it receives 429 or the RateLimit headers run low, whether it caches or shares one view across many objects, and whether it spreads servers across several projects or tokens. Report documented incidents where a controller exhausted the rate limit, what the symptom was, and how it was fixed. Say where Hetzner has raised a project's request limit on request and what it asked for. Distinguish what the code does from what its README claims.

---

## Turn 2: ChatGPT

_2026-09-17T13:56:52.014Z_

I’ll treat this as a code-and-incident audit, not a docs summary. I’ll trace the actual list/get paths, retry/rate-limit handling, caches/informers, and issue reports for the named projects, then add a few comparable controllers/panels where there’s evidence of large fleets.

---

## Turn 3: ChatGPT

_2026-09-17T14:00:58.831Z_

Two patterns are already clear. CAPH still does per-machine server reads during reconciliation and has no production-wide HCloud server cache; HCCM has moved in the opposite direction and now defaults to one shared, 10-second whole-project snapshot, specifically to collapse duplicate node/route lookups. The latter mitigation was added after real customer reports of >1 server GET/s exhausting projects, but maintainers still had the incident open in June 2026 pending production verification.

---

## Turn 4: ChatGPT

_2026-09-17T14:02:37.557Z_

The Terraform history shows a different failure mode from controllers: not steady-state refresh, but bursts during create/destroy. One documented 30-instance run exhausted even a **7,200/hour** project because each concurrent asynchronous action was being polled; the maintainer’s immediate workaround was to lengthen `poll_interval`. Current provider code has since changed the default polling *function* to exponential backoff from a 500 ms base, even though the generated docs still summarize it as “Default 500ms.”

---

## Turn 5: ChatGPT

_2026-09-17T14:17:47.965Z_

## Findings

As of **17 September 2026**, Hetzner documents a default Cloud API budget of **3,600 requests/hour per Project**. `RateLimit-Remaining` replenishes gradually—at the default rate, roughly one request per second—and responses expose `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`. A token belongs to one Project; making another token in the same Project does **not** create another project quota. Lists default to 25 entries and normally allow at most 50, and the API supports server-side label selectors. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

The implementations fall into three distinct camps. **CAPH and Terraform mainly refresh individual servers by ID**; this is cheap for a few machines but scales linearly with object count. **HCCM and Kubernetes Cluster Autoscaler build a shared whole-project snapshot**, amortizing one inventory across many lookups but paying `ceil(servers/50)` requests every refresh. **hetzner-k3s increasingly avoids querying Hetzner at all for known machines and uses label-selected lists for discovery.** None of the Go-based projects I inspected implements a project-wide admission controller that starts slowing ordinary requests as `RateLimit-Remaining` gets low. `hcloud-go` exposes those headers but essentially reacts after a 429; hetzner-k3s is the notable exception in actually sleeping until `RateLimit-Reset`.

The pagination arithmetic explains why the distinction matters:

| Servers in project | Requests/full inventory | If refreshed every 10s | Every 60s | Every 3m |
|---:|---:|---:|---:|---:|
| 100 | 2 | 720/h | 120/h | 40/h |
| 500 | 10 | **3,600/h** | 600/h | 200/h |
| 1,000 | 20 | **7,200/h** | 1,200/h | 400/h |
| 3,000 | 60 | **21,600/h** | **3,600/h** | 1,200/h |

Those figures are server reads only: no load balancers, networks, actions, creates, deletes, or retries.

### What the current code actually does

| Software | How it keeps server state current | Poll/cache cadence | Read/write request pattern | Rate-limit behaviour | Projects/tokens |
|---|---|---|---|---|---|
| **Syself CAPH** | The important steady-state HCloudMachine path calls `GetServer(serverID)`, which is a direct `Server.GetByID`; CAPH also has bulk `ListServers(opts)` paths, including label-oriented cluster discovery/cleanup, but there is no shared project-wide server snapshot serving every Machine.   | Manager default `--sync-period` is **3m**, but that is only the minimum controller-runtime resync interval: events and explicit requeues can cause much more frequent reconciliation. Default CAPH rate-limit wait is **5m**.  | A healthy Machine reconcile can read the server and validate labels/status/network/LB membership. CAPH's own issue says its then-current behaviour was to make all those checks on every reconcile and that **hundreds of API calls/hour for a stable cluster was normal**. Provisioning adds writes and action/state checks.  | It inherits `hcloud-go` retries. If `rate_limit_exceeded` still reaches the controller, CAPH records a rate-limit condition and delays reconciliation rather than having every object immediately hammer again. It does **not** appear to use low `RateLimit-Remaining` as a proactive throttle. | Token is selected through the HetznerCluster's secret reference, so separate clusters can naturally use separate Projects. It does not automatically partition one cluster's Machines among several Projects.  |
| **hcloud-cloud-controller-manager (HCCM)** | Current default is a **shared whole-project cache**. `mode=all` calls `Server.All()`, then ByID/ByName lookups from nodes/routes share that snapshot. No label selector is used to narrow this inventory. Code still supports `one` and `off`.  | Docs default to `HCLOUD_SERVER_CACHE_MODE=all`, max age **10s**. Crucially, this is a **lazy TTL**, not a background ten-second ticker: the next lookup after expiry refreshes the snapshot. Routes may request a longer age.   | The cache specifically collapses repeated node/route server reads. Cloud-controller writes—routes/LBs/etc.—still use the same Project budget; there is no reserved “write budget.” | Uses `hcloud-go`; I found no HCCM-level low-Remaining scheduler. The cache is the primary request-reduction mechanism. | Normally one workload cluster/project token. No automatic multi-project sharding. |
| **Terraform provider** | An `hcloud_server` resource refresh is **one server at a time**: `resourceServerRead` calls `client.Server.Get(... d.Id())`. Selector/list functionality exists in data sources, but Terraform does not build one shared inventory to refresh all managed server resources.  | Terraform is not a continuously polling controller; these reads happen during refresh/plan/apply. Action completion is polled during writes. | In a large plan, plain refresh costs approximately one GET/server. Creates/deletes are more dangerous because each concurrent resource has an asynchronous action to wait for. | Current provider defaults `poll_function` to **exponential** and `poll_interval` to **500ms**; 500ms is therefore the starting backoff, not necessarily a forever-fixed 2 req/s cadence. It otherwise relies on hcloud-go for HTTP 429 retry.  | Provider aliases can use different tokens/projects. Several aliases using tokens from the **same Project** still consume the same project quota. |
| **hcloud-go** | Library primitive, not an inventory controller: callers choose `GetByID`, `GetByName`, or paginated `AllWithOpts`, which supports `LabelSelector`. Its `All*` helpers use 50/page. It supplies no shared server cache. | No inventory poll interval of its own. It does have action polling. | How requests are spent is entirely caller-controlled. Action waiting can batch action IDs in some APIs, but callers that independently wait on one action/resource lose most of that amortization. | It parses all three RateLimit headers into `Response.Meta.Ratelimit`. A 429 is retryable under its generic retry layer; current defaults are **5 retries**, exponential backoff from **1s**, multiplier 2, cap 1m, with jitter. It does **not** turn `Remaining=20`, say, into global backpressure, nor does generic 429 retry simply sleep until `RateLimit-Reset`.    | One client carries one token. Sharding is an application responsibility. |
| **Kubernetes Cluster Autoscaler, Hetzner backend** | Fetches **all servers in the Project once**, then filters its node-group label **locally** rather than issuing one label-selected Hetzner query per node group.  | Shared server cache TTL is **1 minute**. This is distinct from Cluster Autoscaler's ordinary scan interval. | All node groups reuse that inventory. Scale-up/down then adds server writes/action traffic. | No special Remaining-budget logic found; its Hetzner client behaviour handles errors underneath. | One configured Hetzner Project/token; no automatic fleet sharding. |
| **hetzner-k3s** | Current design first tries to infer existing machines from **Kubernetes itself**, avoiding Hetzner reads. Its fallback discovery calls `/servers?label_selector=cluster=...`; name lookup is similarly server-side rather than scanning everything. In the fallback source I reviewed, I do **not** see code traversing pagination for those raw selector calls, which is worth noting for very large selector result sets.  | Command-driven provision/update tool rather than a perpetual inventory poller. | During create it deliberately accepts substantial write concurrency, but reruns avoid many read calls by trusting the Kubernetes view. Its v2 release says the author created a **200-node cluster in under four minutes** with private networking disabled. ([New Releases](https://newreleases.io/project/github/vitobotta/hetzner-k3s/release/v2.0.0?utm_source=chatgpt.com)) | Unlike the Go stack, its client has explicit 429 handling: it serializes rate-limit recovery, reads `RateLimit-Reset`, waits, and resumes. It still waits for a 429 rather than proactively throttling on low Remaining.  | One configured project token; no automatic splitting of one cluster over Projects. |

There is a particularly useful `hcloud-go` issue documenting the missing layer: a user asked for a **client/node-wide circuit breaker**, saying per-request exponential retries were insufficient because simultaneous operations could keep a node trapped in rate limiting. That request was eventually closed as not planned/stale. 

## Documented rate-limit incidents

| Incident | Symptom / cause | Mitigation or fix |
|---|---|---|
| **CAPH #1336, June 2024** | CAPH maintainers themselves said it sometimes hit the limit because running Machines were rechecking server existence, labels, power state, network and LB target membership every reconciliation; “hundreds of calls per hour” on a stable cluster was normal.  | The issue considered dropping checks or heavily caching them. It remains useful evidence that CAPH's steady-state API cost was understood as a design problem; current code still does individual Machine reads rather than an HCCM-style global inventory. |
| **CAPH #1756, Dec 2025** | A server create repeatedly failed with `resource_unavailable` (“server location disabled”). Reconciliation immediately repeated until the Project quota was consumed; the visible failure eventually became `exceeded hcloud rate limit with calling function "ListLoadBalancers"`.  | Merged PR #1887 stops reconciling terminal `invalid_input`/`resource_unavailable` creation failures rather than retrying forever. That is in current code.  |
| **HCCM #661, opened June 2024, still open in 2026** | Customer telemetry showed HCCM sometimes issuing **>1 `GET /v1/servers/{id}` per second** for a subset of nodes and exhausting the project quota. Restarting HCCM temporarily stopped it.  | The new shared server cache is believed to address it, but the maintainers explicitly kept the issue open in June 2026 until enough upgraded production clusters existed to verify the problem had disappeared. So “fixed by the cache” would overstate the record.  |
| **HCCM #308, 2022** | After several days, route reconciliation was failing while fetching `/servers?page=1&per_page=50`, with `context deadline exceeded`; reporter said the exhausted quota also harmed Terraform commands even though Terraform used **different API keys**.  | Issue was eventually closed stale. More importantly, it is direct field evidence that swapping tokens inside the same Project does not isolate competing controllers. |
| **Terraform #601** | A 30-instance create/destroy run had independent action polling for many resources and terminated with `hcclient/WaitForActions: limit of **7200 requests per hour** reached`.  | Maintainer recommendation was to increase `poll_interval`, e.g. to 10–15s, and optionally put large server sets behind a slower provider alias.  Current provider code has since made exponential polling the default, which is better than interpreting 500ms as a permanently constant interval. |
| **hetzner-k3s large-cluster work** | Release notes describe large cluster creation as sufficiently API-heavy to require explicit rate-limit recovery and fewer lookups of already-existing nodes. | v2 added “wait and resume” rate-limit handling and switched known-node detection toward `kubectl`; author reports a 200-node creation test. ([New Releases](https://newreleases.io/project/github/vitobotta/hetzner-k3s/release/v2.0.0?utm_source=chatgpt.com)) |

The Terraform report is also significant because its error says **7,200/hour**, twice today's documented default. That is hard evidence that at least some Projects have had a non-default higher API rate limit.

## The subtle code-vs-documentation differences

For **HCCM**, the documentation saying “cache max age 10s” is technically accurate but easy to misread. Current code does **not** run `GET /servers` on a ten-second cron. It refreshes only when a lookup arrives after the snapshot has expired. That distinction is huge for an idle cluster, but almost disappears if node/routes activity continually causes lookups. 

For **Terraform**, documentation describing `poll_interval = 500ms` is now incomplete if read as “poll twice a second indefinitely.” The current provider defaults `poll_function=exponential`; the code wraps that 500ms as the base of `ExponentialBackoff(2, pollInterval)`. 

For **Cluster Autoscaler**, its ordinary autoscaler scan cadence should not be equated with an HCloud inventory request. The implementation puts the whole server list behind a separate **one-minute shared cache** and filters node groups from that cached slice. 

For **CAPH**, `--sync-period=3m` likewise is not “one HCloud GET every three minutes.” It is a controller resync floor. Kubernetes events, errors, Machine lifecycle states and explicit short requeues can cause additional reconciliations, and CAPH's own rate-limit incidents came precisely from those loops. 

For **hetzner-k3s**, the release-note statement that API usage was reduced is supported by current architecture: Kubernetes is queried first and Hetzner is fallback discovery. But its raw label-selector fallback deserves separate scrutiny because I do not see pagination being walked in the source path I inspected; a claim that selector discovery therefore handles arbitrary thousands of matching servers would go beyond the code. 

## Did Hetzner raise limits, and what did it ask for?

There are two things I can establish, and one I cannot.

Hetzner's current official documentation deliberately calls **3,600/hour the “default”**, rather than an immutable maximum. A public Terraform-provider incident shows an actual Project whose API replied that its limit was **7,200/hour**. A secondary industry source also says Hetzner API rate limits can be raised through support. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

What I **did not find in the audited public sources** is a primary-source support exchange that both says “Hetzner approved this Project's API request-rate increase” **and records exactly what Hetzner support asked the customer to provide**. The 7,200/h Terraform issue establishes the higher quota but not how it was obtained. Other public postmortems document customers asking Hetzner for increases without publishing an approval/requirements exchange. Hetzner's API documentation itself publishes no checklist for an API-rate increase. I would therefore not transpose Hetzner's documented *resource-quota* increase requirements, or its open-source-credit requirements, onto API-rate-limit requests; they are different things.

## What this implies for fleets of hundreds or thousands

For a **500-server Project**, HCCM's default 10-second whole-project snapshot can theoretically consume the entire default quota if lookups keep it continuously hot. For **1,000 servers**, even that server inventory alone would require twice the default quota. Conversely, a one-minute shared inventory stays at about 1,200 requests/hour at 1,000 servers, which explains why the Cluster Autoscaler design has substantially more breathing room.

Per-object refresh has the opposite curve. A CAPH-like design doing just one server GET per object every three minutes costs `20 × N` requests/hour: **180 servers already equals 3,600 GETs/hour**, before networks, LBs, action reads or writes. In practice CAPH is event-driven rather than an exact three-minute ticker, but that calculation shows why “one GET is cheap” does not remain true at fleet scale.

At thousands of servers, the pattern that survives the 3,600/h default is therefore not simply “use lists instead of GETs.” It is **one shared view per Project, refresh it relatively slowly, fan that view out locally to all objects, use server-side label selectors when only a small subset matters, invalidate/update the local view after writes, and globally pace new work as the project's Remaining budget shrinks**. None of the reviewed Go controllers currently implements that complete pattern. And when one logical system truly needs more request budget than that allows, **multiple Projects**, not multiple tokens for one Project, are the unit that actually partitions the quota. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

---

If you want, I can:

- Analyze CAPH's reconciliation frequency and its impact on rate limits
- Evaluate HCCM's shared cache mechanism for managing many servers
- Summarize rate-limit incidents and fixes across Hetzner controllers
