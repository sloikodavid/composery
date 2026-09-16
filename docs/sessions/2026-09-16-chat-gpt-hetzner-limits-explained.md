# Hetzner Limits Explained

Source: https://chatgpt.com/share/6aa9f9df-b380-83ed-b15d-0c0dfb173133

---

## Turn 1: User

_2026-09-16T02:04:42.728Z_

Hetzner Cloud limits in detail: how server, Primary IP, firewall and snapshot limits relate
to each other in one project, whether Primary IP limits are tied to server limits, how limits
are raised, and what the API returns when one is reached.

---

## Turn 2: ChatGPT

_2026-09-16T02:04:41.976Z_

I’ll verify this against Hetzner’s current Cloud docs and API behavior, then tie the separate quota types together so it’s clear what is independent versus coupled.

---

## Turn 3: ChatGPT

_2026-09-16T02:04:56.494Z_

The important distinction is emerging: Hetzner’s API token is project-scoped, but several creation quotas are **customer/account-wide across projects**, not independent per-project buckets. Primary IP capacity is then derived from the server quota rather than being a separately negotiated number.

---

## Turn 4: ChatGPT

_2026-09-16T02:05:22.438Z_

As of September 2026, Hetzner Cloud’s quota model is easiest to understand as **account/customer limits shared by projects**, while API access itself is project-scoped. So creating a second project does not normally give you a fresh server/firewall/snapshot quota. Hetzner explicitly says it limits how many resources a single account can create, and its API describes `resource_limit_exceeded` as exceeding a resource maximum “for an account.” API tokens, meanwhile, belong to one project. ([Hetzner Docs](https://docs.hetzner.com/cloud/general/faq/?utm_source=chatgpt.com))

### How the four limits relate

| Resource | Current documented limit | Relationship |
|---|---:|---|
| **Servers** | Default up to **5** | Base account resource limit; actual account limit can be higher after approval. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/overview/?utm_source=chatgpt.com)) |
| **Primary IPs** | **2 × your server limit** total | Directly tied to the server limit. Additionally, any one server may have at most one Primary IPv4 and one Primary IPv6. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/overview/?utm_source=chatgpt.com)) |
| **Firewalls** | **50 across all projects** | Independent account-wide object limit; additionally, at most **5 Firewalls can apply to one server**. ([Hetzner Docs](https://docs.hetzner.com/cloud/firewalls/overview/?utm_source=chatgpt.com)) |
| **Snapshots** | Default **30 across all projects** | Independent account-wide snapshot limit. Backups are separate: seven backup slots per server. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/?utm_source=chatgpt.com)) |

So, for example, suppose Hetzner has raised your server limit to **20**. Your corresponding Primary IP ceiling is **40**, not 20. Those 40 are the combined Primary-IP resource allowance implied by the `20 × 2` formula; they do not have to be attached to 20 running servers. Hetzner explicitly allows Primary IPs to exist independently/unassigned. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/overview/?utm_source=chatgpt.com))

That leads to an important practical consequence. Suppose you have 10 servers but have accumulated 40 Primary IP resources, some of them currently unattached. You may still have server quota available, but an attempt to create another server **and automatically allocate a new Primary IP** can fail on the Primary-IP quota. Deleting or reusing an unused Primary IP would free that resource count. Conversely, a private-network-only server need not consume a Primary IP at all. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/overview/?utm_source=chatgpt.com))

The dependency therefore looks roughly like:

**server limit = S → Primary IP limit = 2S**

but not:

**number of existing servers × 2 = number of Primary IPs you may currently have.**

Primary IPs are separate resources; it is the **allowed maximum** that is mathematically derived from the server limit. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/overview/?utm_source=chatgpt.com))

### In one project versus several projects

Imagine your account limits are:

```text
Servers:       20
Primary IPs:   40
Firewalls:     50
Snapshots:     30
```

If everything is in one project, that project can potentially consume the whole allowance.

If you divide things between projects A and B, the resource objects remain project-local—you need the appropriate project's API token to see/manipulate them—but the account-level ceilings are shared. This follows from Hetzner describing these controls as limits on a single account/customer and explicitly describing Firewalls and Snapshots as limits “across all projects.” ([Hetzner Docs](https://docs.hetzner.com/cloud/general/faq/?utm_source=chatgpt.com))

That distinction matters to automation. A call to:

```http
GET /v1/servers
```

using Project A's token enumerates Project A's servers, not every server owned by the account. Hetzner says API tokens are bound to a particular project. So merely counting resources returned through one project's API token is not necessarily enough to determine how much **account-wide quota** remains if the account has other projects. ([Hetzner Docs](https://docs.hetzner.com/cloud/api/getting-started/using-api/?utm_source=chatgpt.com))

Firewalls have a second, completely different limit: although you can have up to 50 Firewall objects across the account's projects, one server can have no more than **five applied Firewalls**. One Firewall can, however, cover multiple servers, including through label selectors; attaching it to ten servers does not create ten Firewall objects. ([Hetzner Docs](https://docs.hetzner.com/cloud/firewalls/overview/?utm_source=chatgpt.com))

Snapshots similarly do not scale with server count. One server could theoretically be the source of many of your snapshots; deleting that original server does **not** delete its snapshots. That's different from Backups, which are tied to their server and use seven per-server backup slots. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/?utm_source=chatgpt.com))

### Raising the limits

The authoritative values for your particular account are shown in Hetzner Console's **Limits** overview; don't assume the documented defaults apply after the account has been reviewed or had previous increases. Hetzner instructs customers to use **Request change → Limit increase** from that page. Resource-limit requests are manually reviewed case by case. ([Hetzner Docs](https://docs.hetzner.com/cloud/general/faq/?utm_source=chatgpt.com))

For server limits specifically, Hetzner currently says you can request an increase once you have been a customer for **one month and paid your first invoice**. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/faq/?utm_source=chatgpt.com))

Because the documented Primary IP maximum is `server limit × 2`, increasing the server quota also increases the associated Primary-IP ceiling. For example:

```text
server limit  5  → Primary IP limit 10
server limit 20  → Primary IP limit 40
server limit 50  → Primary IP limit 100
```

You should therefore think of Primary-IP capacity as a **derived server quota**, rather than a completely independent quota such as the Firewall or Snapshot count. ([Hetzner Docs](https://docs.hetzner.com/cloud/servers/primary-ips/overview/?utm_source=chatgpt.com))

Firewall and Snapshot ceilings are separate resource limits. Hetzner's general limits documentation says resource increases can be requested through the same Limits interface; approval is not automatic. ([Hetzner Docs](https://docs.hetzner.com/cloud/general/faq/?utm_source=chatgpt.com))

### What the Cloud API returns when you hit a quota

A resource-count quota is **not the same thing as the API request-rate limit**.

When you exceed an account resource quota, the documented response is HTTP **403** with machine-readable code:

```json
{
  "error": {
    "code": "resource_limit_exceeded",
    "message": "project limit exceeded",
    "details": {
      "limits": [
        {
          "name": "project_limit"
        }
      ]
    }
  }
}
```

Hetzner documents `403 resource_limit_exceeded` as the error for exceeding the maximum quantity of a resource for an account. The example above is their generic schema/example; actual messages can be more resource-specific—for example, real Cloud API clients have observed `"Primary IP limit exceeded"` while retaining the same `resource_limit_exceeded` code. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

For software, therefore, the robust check is essentially:

```text
HTTP status == 403
AND
error.code == "resource_limit_exceeded"
```

Do **not** make your logic depend on the English `message` string.

By comparison, exhausting the **API request rate** gives HTTP **429** and:

```text
error.code = "rate_limit_exceeded"
```

The normal Cloud API request-rate allowance is currently 3,600 requests/hour **per project**, with `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` response headers. That rate limit really is project-based, unlike the account resource quotas discussed above. ([Hetzner Cloud](https://docs.hetzner.cloud/reference/cloud?utm_source=chatgpt.com))

So the useful mental model is:

```text
Hetzner account/customer
│
├── Server quota ─────────────── S
│      └── Primary-IP quota ─── 2 × S
│
├── Firewall-object quota ───── independent, 50 default/current documented max
│      └── per-server attach ── max 5
│
└── Snapshot quota ──────────── independent, 30 default
       └── Backups ──────────── separate, 7 slots per server

Projects
└── separate resource/API namespaces
    but they consume the account-wide resource pools above

API request rate
└── separate again: 3,600/hour/project
```

The biggest traps are therefore **assuming each project gets its own quota**, **assuming one Primary IP allowance equals one server**, and **treating `resource_limit_exceeded` like a retryable HTTP rate-limit error**. The first two can unexpectedly exhaust capacity; the last one will normally keep failing until you delete/free resources or Hetzner raises the applicable quota. ([Hetzner Docs](https://docs.hetzner.com/cloud/general/faq/?utm_source=chatgpt.com))
