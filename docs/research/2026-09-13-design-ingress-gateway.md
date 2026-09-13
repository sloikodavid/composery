# Design ingress gateway


Source: https://chatgpt.com/share/6aa6f4e1-c624-83ed-987d-0c3de6c8b9e2

---

**User**

Research a future app-exposure layer for user-controlled VPSs. The marketing/control application uses one registrable domain; customer workloads use another. A server has a mutable globally unique slug. Each exposed HTTP app should have a stable URL and may be public or restricted to named users. Server membership gives access to all its apps. Authentication uses Clerk; permissions live in Convex. Guests may have root access. No proxy, tunnel, DNS, or certificate topology has been selected.

Use current official documentation for relevant technologies. Compare practical ingress/gateway designs without assuming Cloudflare is mandatory. Analyze direct-IP/origin bypass, IPv6, websocket and streaming support, non-HTTP ports, authorization caching and revocation, fail-closed behavior, cookie scope, sibling-tenant origins, service workers, custom domains, wildcard certificate depth, slug renames, and existing sessions. Explain which enforcement can be outside a root-controlled guest and what outbound tunnels can bypass. Distinguish granting access to an app from making its own content safe.

Return the smallest viable design and the product decisions it requires. State what server networking choices would make this later feature harder. Avoid implementing it or adding schema now. Cite primary sources and do not assume a DNS proxy supplies identity authorization.

---

**ChatGPT**

I’ll separate **URL/identity design**, **ingress enforcement placement**, and **guest escape hatches**, then reduce that to the smallest design that preserves future options. I’ll use primary documentation for Clerk, Convex, TLS/DNS, HTTP/WebSocket/streaming, and representative gateway/tunnel technologies.

---

**ChatGPT**

The key architectural constraint is already emerging: **restricted access is only trustworthy if the mandatory enforcement point is not controlled by VPS root and the workload cannot be reached around it**. A proxy/CDN hostname by itself does not establish that property; the origin path and both IPv4 and IPv6 exposure have to be closed separately.

---

**ChatGPT**

A second important choice is to keep Clerk **off the untrusted workload origin**. Clerk supports multi-domain/satellite setups, but its own docs warn that broad subdomain authentication increases risk when a subdomain is compromised. For this use case, a platform-controlled top-level redirect/broker is cleaner than making every customer app a Clerk participant.

---

**ChatGPT**

## Recommendation

The smallest viable design is a **platform-owned HTTP gateway outside the root-controlled VPS**, using the workload registrable domain only for workload origins and the control registrable domain for Clerk sign-in and policy administration.

Use a canonical URL shaped like:

`https://<immutable-exposure-id>.apps.<workload-domain>/`

Do **not** put the mutable server slug in the canonical hostname. The gateway maps that immutable exposure ID to the current server and local port. Server renames, migrations, and eventually custom domains then change routing metadata rather than the application's security origin.

For restricted apps, do not try to share the control application's Clerk cookie into customer workload origins. Instead, use a platform-controlled redirect handshake: the workload gateway redirects an unauthenticated browser to the control domain; the control application authenticates with Clerk, obtains the user identity, checks the authoritative permission in Convex, and returns a short-lived one-time assertion to a gateway-owned callback on the workload hostname. The gateway establishes its own host-bound access session. Clerk itself documents cross-domain satellite applications, but also warns about the security implications of broad subdomain authentication; exposing Clerk directly to arbitrary untrusted workload subdomains is unnecessary here. ([clerk.com](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains?utm_source=chatgpt.com))

Conceptually:

```text
browser
  │
  ▼
<exposure-id>.apps.workloads.example
  │
  ▼
platform L7 gateway ───── auth/check ───── control backend + Convex
  │                                           │
  │                                           └── Clerk identity
  ▼
private VPS address:port
or platform-controlled tunnel
```

The critical invariant is:

> **There must be no Internet route to the exposed application that avoids the platform gateway.**

That invariant matters more than the choice of Cloudflare, Caddy, Envoy, a cloud load balancer, or an outbound tunnel.

### Why the URL should be an opaque exposure ID

An application deserves its own browser origin. A path-based design such as `apps.example/e/foo/` puts mutually untrusted applications on one origin, sharing cookies and service-worker authority. Service workers are registered against an origin and scope, and registrations persist beyond the page that created them. ([W3C](https://www.w3.org/TR/service-workers/))

Likewise, `<app>.<server-slug>.apps.example` makes a mutable server name part of a supposedly stable URL and creates awkward TLS depth. Current TLS identity rules allow a wildcard only as the complete left-most label and it matches only one label: `*.apps.example` covers `x.apps.example`, not `x.y.apps.example`. ([RFC Editor](https://www.rfc-editor.org/info/rfc9525/?utm_source=chatgpt.com))

So use one opaque, immutable, never-reassigned label immediately under a fixed workload zone. One wildcard DNS record and one `*.apps.<workload-domain>` certificate can cover the platform hostnames; wildcard issuance normally requires DNS-01 with Let's Encrypt. ([Let's Encrypt](https://letsencrypt.org/docs/challenge-types/?utm_source=chatgpt.com))

The mutable globally unique server slug can remain a UI identifier. If you later offer vanity aliases involving it, make them redirects to the immutable hostname. Do not casually recycle old workload hostnames between tenants: cookies and, more importantly, persistent service-worker registrations can survive the former tenant's use of that origin. ([W3C](https://www.w3.org/TR/service-workers/))

## Practical ingress choices

| Design | Root-independent enforcement | Direct-origin bypass | Operational character | Assessment |
|---|---|---|---|---|
| **External platform gateway → private VPS network** | Strongest. TLS, auth and routing all happen outside guest | Eliminated if app port has no public route | Requires provider/private network reachability | **Best end state** |
| **External platform gateway → outbound tunnel from VPS** | Gateway authorization remains external | Official URL cannot bypass gateway; origin needs no inbound port | Works across NAT/providers; agent lives in root-controlled guest | **Good portable MVP** |
| **CDN/reverse proxy → public VPS origin** | Can be strong if auth is at edge/gateway | Serious unless origin is independently restricted to proxy | Simple networking but firewall/mTLS discipline required | **Viable, easier to misconfigure** |
| **Reverse proxy/auth agent inside each VPS** | No: root can disable or modify it | Root can expose the local app another way | Operationally simple | **Not a security boundary** |

The first two are therefore the serious candidates.

An outbound tunnel does not have to mean Cloudflare. Cloudflare Tunnel is one representative design: its daemon establishes outbound-only connections and does not require inbound ports. Its documentation separately describes Cloudflare Access as the component that applies identity policy—Tunnel or proxied DNS alone is not identity authorization. ([Cloudflare Docs](https://developers.cloudflare.com/tunnel/?utm_source=chatgpt.com)) Tailscale Funnel demonstrates a similar architectural property in another product: a local service can be exposed through relay infrastructure rather than by making the device's address the public endpoint. ([Tailscale](https://tailscale.com/docs/features/tailscale-funnel?utm_source=chatgpt.com))

A public-origin CDN arrangement is also possible, but DNS proxying is not sufficient. Cloudflare's own Authenticated Origin Pull documentation explicitly notes that, without origin restriction, someone who discovers the origin IP can connect directly and bypass Cloudflare protections. ([Cloudflare Docs](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/?utm_source=chatgpt.com)) The same architectural observation applies to other CDN/proxy vendors.

Thus Cloudflare can be used, but nothing in this design requires it.

## Authentication and authorization

Keep the concepts separate:

**Clerk answers "who is this?"** Convex answers **"may this user access this exposure?"**

The authorization rule implied by your requirements is effectively:

`app is public OR user is a server member OR user has an explicit app grant`

where membership grants every app on the server.

Do not encode the authoritative server/app permission set into Clerk custom claims. Clerk documents that normal session tokens are short-lived and refresh every 60 seconds, while custom claim changes can consequently remain stale until refresh. ([Clerk](https://clerk.com/docs/guides/sessions/customize-session-tokens?utm_source=chatgpt.com)) Since permissions are authoritative in Convex, leave them there.

Convex queries are themselves cached, reactive and consistent; a Convex query reruns when its underlying data changes. Any deliberately stale access window would therefore come from **your gateway decision cache**, not from a requirement that Convex itself return stale policy. ([Convex](https://docs.convex.dev/functions/overview?utm_source=chatgpt.com))

For the initial product, the gateway's browser session should prove only an authenticated platform identity—not freeze an authorization decision for hours. On each restricted request, the gateway checks `(user, exposure)` through the platform authorization service, with a deliberately short decision cache. A practical choice might be 15–30 seconds, but the precise number is a product SLA, not a technology requirement.

A cached allow should stop being usable when its explicit TTL expires. If Convex/the authorization service is unavailable after that, restricted traffic should fail closed rather than falling back to an old allow decision. Envoy is one example of a gateway with first-class external authorization and explicitly defaults `failure_mode_allow` to false. ([Envoy Proxy](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_authz/v3/ext_authz.proto.html?highlight=extauthz&utm_source=chatgpt.com)) Caddy and Traefik also have external/forward-auth patterns if you prefer a simpler HTTP gateway. ([Caddy Web Server](https://caddyserver.com/docs/caddyfile/directives/forward_auth?utm_source=chatgpt.com))

Public/restricted status must obey the same rule. A long-lived cached `"public": true` value would otherwise become an authorization bypass when somebody makes the app private.

### Clerk session lifetime versus gateway sessions

Be careful not to undo Clerk's revocation properties by exchanging a 60-second Clerk JWT for a month-long gateway cookie that is never checked again. Clerk specifically uses short-lived tokens to reduce the consequences of revocation and token theft. ([Clerk](https://clerk.com/docs/guides/how-clerk-works/overview?utm_source=chatgpt.com))

The product needs an explicit authentication-session revocation SLA. A platform gateway session can live longer for usability, but your platform must then have a way to invalidate or periodically revalidate it. App permission revocation and Clerk-session revocation are two separate events and need separate propagation guarantees.

For example, you might promise that Convex permission changes affect new HTTP requests within 30 seconds while Clerk logout/revocation invalidates gateway sessions within some separately documented interval. The exact SLA is a product decision.

## Cookies and sibling tenants

The workload registrable domain should be treated as hostile.

Although `foo.apps.workloads.example` and `bar.apps.workloads.example` are different origins, they are sibling hosts under the same registrable domain. Cookies with a parent `Domain` attribute can span those hosts, and the cookie specification explicitly warns that sibling domains do not provide cookie integrity: one sibling can set a parent-domain cookie that another sibling receives. ([RFC Editor](https://www.rfc-editor.org/info/rfc6265/?utm_source=chatgpt.com)) They are also "same-site" for SameSite-cookie purposes because that concept is based on scheme plus registrable domain, not full origin. ([RFC Editor](https://auth48-transition.rfc-editor.org/authors/rfc10025.html?utm_source=chatgpt.com))

Therefore the gateway access cookie should be host-only, `Secure`, `HttpOnly`, and ideally use the `__Host-` convention. `__Host-` cookies prohibit a `Domain` attribute and require `Path=/`, binding the cookie to the current hostname. ([RFC Editor](https://auth48-transition.rfc-editor.org/authors/rfc10025.html?utm_source=chatgpt.com))

There is one additional wrinkle: the root-controlled application itself can return arbitrary `Set-Cookie` response headers on **its own** hostname. Consequently the external gateway should reserve its authentication-cookie name and strip attempts by the upstream application to set or delete that cookie. Likewise, reserve a small gateway path such as `/_platform/...` for auth callbacks rather than passing it to the workload.

The gateway should also remove its own access cookie before forwarding the workload request. There is no reason for arbitrary tenant code to receive the credential protecting the proxy itself.

Keeping the control application on a different registrable domain is beneficial: workload content cannot set cookies for the control domain.

## WebSockets, SSE and streaming

An HTTP exposure product should treat WebSockets and streaming as baseline requirements, not edge cases.

Normal reverse proxies can support them, but configuration matters. NGINX documents the special handling required for a WebSocket HTTP Upgrade; Caddy documents immediate flushing for `text/event-stream` and configurations for disabling response buffering. ([Nginx](https://nginx.org/en/docs/http/websocket.html?utm_source=chatgpt.com)) Envoy also distinguishes stream/request lifetime and idle timeouts, which matter for long-lived responses. ([Envoy Proxy](https://www.envoyproxy.io/docs/envoy/latest/faq/configuration/timeouts?utm_source=chatgpt.com))

That leads to an important authorization consequence: the gateway normally makes its decision when establishing a WebSocket or beginning a streaming HTTP response. Removing someone's permission ten seconds later does not magically retract bytes already travelling over a live connection.

You therefore need to choose between:

**eventual revocation for live connections**, where the existing WebSocket/SSE stream may continue until it naturally closes or hits a maximum connection lifetime; or **active revocation**, where gateway instances track open connections and a policy change causes them to be terminated.

For an MVP, the former is much smaller. Document it precisely. For example, "revocation affects new requests within N seconds; already established WebSockets/streams may continue until reconnect/max lifetime." If stronger guarantees are required, connection tracking becomes part of the design.

Uploads/request streaming must also remain streaming; an authorization middleware that buffers arbitrary request bodies before deciding is undesirable.

## IPv4, IPv6 and direct-IP bypass

Treat IPv4 and IPv6 as two independent origin paths for exposure purposes. IPv6 global-unicast addressing gives an interface a directly addressable Internet identity just as IPv4 can. ([RFC Editor](https://www.rfc-editor.org/rfc/rfc4291.html?utm_source=chatgpt.com))

A very common failure pattern would be:

```text
IPv4: origin firewalled to gateway
IPv6: globally reachable
```

An attacker then connects directly over IPv6, supplies the application's `Host` header, and never encounters gateway authorization.

Therefore "origin is private" must mean all of the following: no direct IPv4 route to the app port, no direct IPv6 route to it, no alternative public load balancer, and no hostname that resolves around the gateway. A guest `iptables`/`nftables` rule does not satisfy this security boundary when the customer has root, because root can change it.

Controls that can actually sit outside the guest include provider security groups/firewalls, host/hypervisor networking, a private VPC interface, an external gateway, and an external tunnel termination point. These are appropriate enforcement locations.

If you retain a public VPS origin behind a CDN, use a provider-level firewall and/or mutually authenticated origin TLS rather than merely keeping the origin IP secret. Cloudflare's AOP is one concrete example of that principle. ([Cloudflare Docs](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/?utm_source=chatgpt.com))

## What root can still bypass

Even with perfect inbound isolation, unrestricted root plus unrestricted **egress** means you cannot promise that a restricted application is only available through your platform.

Root can run another outbound publication mechanism: Cloudflare Tunnel, Tailscale Funnel, an SSH reverse tunnel, another commercial tunnel client, or simply upload the content elsewhere. Cloudflare Tunnel explicitly works by making outbound-only connections, and Tailscale Funnel similarly makes local services reachable through relay infrastructure. ([Cloudflare Docs](https://developers.cloudflare.com/tunnel/?utm_source=chatgpt.com))

So the meaningful guarantee is:

> **Requests through the platform's official exposure URL cannot bypass platform authorization.**

It is **not**:

> **The VPS owner is technically incapable of exposing the same content elsewhere.**

Achieving the second guarantee requires controlling guest egress or taking root away from the customer. That is a substantially different VPS product.

An in-guest tunnel agent is still useful. Root can kill or replace it, but if authentication is enforced at the remote gateway, root cannot make that gateway admit an unauthorized user merely by modifying the local proxy. The remote gateway remains the authorization boundary.

## Non-HTTP ports

Do not include arbitrary TCP/UDP in the first version.

A browser Clerk session maps naturally onto HTTP navigation and HTTP cookies. An arbitrary PostgreSQL, Minecraft, SSH, SMTP, or UDP connection has no equivalent browser authentication ceremony.

Envoy demonstrates that authorization can technically be applied to TCP connections and even UDP sessions, with fail-closed behavior. ([Envoy Proxy](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/network/ext_authz/v3/ext_authz.proto.html?utm_source=chatgpt.com)) But the gateway still needs a credential identifying the human or machine: mTLS certificates, protocol-specific credentials, a VPN/overlay identity, short-lived connect tokens, SSH certificates, etc.

Cloudflare Tunnel supporting TCP/SSH/RDP or Tailscale Funnel supporting TCP is therefore a **connectivity** capability, not evidence that your Clerk/Convex named-user authorization policy has automatically been applied. ([Cloudflare Docs](https://developers.cloudflare.com/tunnel/?utm_source=chatgpt.com))

Call v1 explicitly **HTTP exposure**, including HTTPS, WebSockets, SSE and HTTP streaming. Design L4 exposure separately later.

## Custom domains

The proposed hostname scheme does not block custom domains.

Later, the gateway can map:

`customer.example.com → exposure_abc123`

after proving control of the hostname and provisioning a certificate. The platform wildcard certificate cannot cover arbitrary customer domains, so custom domains require per-domain managed certificates/ACME or customer-supplied TLS. Wildcards are limited to one left-most DNS label. ([RFC Editor](https://www.rfc-editor.org/info/rfc9525/?utm_source=chatgpt.com))

The auth-broker design works especially well here because it does not depend on sharing a control-domain cookie. A browser arriving at the custom domain can go through exactly the same control-domain redirect and receive a host-only gateway session for that custom hostname.

You should nevertheless choose a **canonical origin**. Serving the application simultaneously at the platform hostname and a custom domain creates two browser origins, with separate cookies, local storage, service workers and gateway sessions. Usually one should redirect to the other once a custom domain is active.

Do not make custom domains part of the MVP unless there is immediate demand; just avoid architectural choices that make them impossible.

## App access is not app safety

The access layer only answers who is allowed to obtain the workload's responses.

It does not make those responses trustworthy.

A root-controlled application can still serve arbitrary HTML and JavaScript, collect information an authorized user types into it, send data to external services, display phishing UI, create its own cookies/storage/service workers on its origin, or contain ordinary application vulnerabilities. Unique origins and keeping Clerk credentials away from those origins reduce blast radius, but they do not turn tenant code into trusted platform code.

Consequently, avoid language such as "secure app" merely because it is restricted. A better product concept is **"private/restricted access."**

Also avoid injecting privileged control-panel JavaScript or tokens into the workload page. The application origin should remain an untrusted content origin.

## Policy changes and existing sessions

The expected behavior should be defined before implementation:

| Change | Recommended behavior |
|---|---|
| Server slug renamed | Canonical app URL and sessions unaffected |
| App target port/server changed | Same URL; gateway route changes |
| User removed from app grant | New requests denied after authorization-cache SLA |
| User removed from server membership | Same as above, unless an explicit app grant remains |
| App changes public → restricted | New unauthenticated requests denied after policy-cache SLA |
| App changes restricted → public | Auth no longer required after policy-cache SLA |
| Clerk session revoked | Platform gateway session invalidated within your chosen auth-session SLA |
| Existing WebSocket/SSE during revoke | Continues unless product implements active connection revocation |
| Custom domain activated | Requires new host session; browser cookie does not transfer from platform hostname |
| Slug vanity alias removed | Redirect/tombstone it; do not hand its old origin to another tenant |

The last point matters particularly because browser-origin state can outlive the application that created it.

## Product decisions required

The remaining decisions are product policy rather than proxy implementation details:

- **Security promise:** guarantee authorization on official platform URLs, or also attempt to prevent customers exposing the same service elsewhere. The latter requires egress control.
- **Origin connectivity:** private routed networking versus a platform tunnel. Both are sound; a public origin is acceptable only with an external origin restriction that covers IPv4 and IPv6.
- **Canonical URL:** adopt an immutable, non-recycled exposure ID as the single DNS label; treat the mutable server slug as metadata/vanity only.
- **Revocation SLA:** choose explicit maxima for Convex permission changes, public/private transitions, Clerk-session revocation and live WebSocket/stream revocation.
- **HTTP scope:** support normal HTTP(S), WebSockets and streaming in v1; explicitly exclude arbitrary TCP/UDP.
- **Gateway session ownership:** keep its cookie host-only and gateway-owned, reserve its cookie/header/path namespace, and never forward that credential to the workload.
- **Custom domains:** decide whether they are deferred but architecturally supported, and whether a custom domain becomes canonical when activated.
- **Identity propagation:** decide whether workloads merely get allow/deny or are also told the authenticated user's identity. The latter needs signed/rewritten headers and is a separate product contract.

## Networking choices to avoid now

The choices that would make this feature materially harder later are giving apps unrestricted public reachability on both address families with no provider-level firewall; relying on guest firewall rules as a security control; requiring application traffic to terminate TLS only inside the guest; designing workload URLs around mutable server slugs; using `<app>.<server>.<domain>` if you expect a single wildcard certificate; multiplexing mutually untrusted apps under paths on one hostname; depending on shared parent-domain cookies; or promising that a root user cannot publish services externally while also allowing unrestricted outbound Internet connections.

Conversely, the future feature becomes much easier if servers have a stable private network identity, provider-level inbound policy independent of guest root, IPv4/IPv6 policy parity, and either private gateway reachability or permission to establish a narrowly scoped platform tunnel.

**Bottom line:** build the future contract around an **immutable per-exposure origin + external fail-closed HTTP authorization gateway + non-public origin path**. Clerk should authenticate users on the trusted control side; Convex remains the authorization authority; the workload domain gets only a gateway-owned host session. Whether the gateway reaches the VPS through a provider private network, your own tunnel, Cloudflare Tunnel, or another mechanism can remain undecided without changing that security model.
