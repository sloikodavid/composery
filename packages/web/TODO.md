# To-do

- Finish design for pages like /pricing as well as the main page.

- Rate limits/security hardening, and clean rewrite of some things.

- Debloat snapshot logic. `Box already has an active snapshot operation.`

- Proper abuse handling that aligns with Hetzner's interests. Residual risk is
  outbound abuse from untrusted box users, attributed to our Hetzner account, so
  we must detect and act before Hetzner's abuse desk does (their escalation is
  server lock -> repeated strikes -> whole-account suspension that takes every
  box down at once).
  - Detection signals to collect per box (the box has no API token, so detection
    lives in the host/network layer, not the control plane):
    - Outbound traffic baseline + anomaly: sustained high egress bandwidth and
      large packet-per-second counts (DDoS source), from Hetzner's per-server
      metrics API. Parked: destination spread (port scanning / brute force) and
      known-abuse destination ports (spam, mining pools, IRC/C2) need flow-level
      visibility the metrics API does not expose - volume only, no destinations.
      Hetzner blocks outbound SMTP 25 by default; confirm and keep it blocked in
      the firewall (hypervisor-level, so it holds against an escaped user).
    - Resource signature of mining: sustained ~100% CPU with low disk I/O,
      visible in Hetzner's hypervisor-side CPU metrics regardless of what runs
      inside. Decided against compose `cpus`/`mem_limit`/`pids_limit`: the
      VPS's compute is the product, and an escaped user removes them anyway.
    - Inbound scan/brute-force hits on 22/80/443 (a box being used to host an
      open service or relay).
  - Response actions (we already have the levers; wire them to the signals):
    - `suspendBox` powers the VPS off at the hypervisor, which holds even against
      a user who escaped the container - use it as the immediate kill switch on a
      confirmed signal, before teardown.
    - `deleteBox` for repeat/severe offenders.
    - Auto-suspend on a high-confidence signal (e.g. confirmed outbound DDoS),
      flag-for-review on a softer one, to beat Hetzner's response window.
  - Inbox + workflow for Hetzner abuse complaints: a monitored address, a way to
    map a complaint's IP/timestamp back to a `box_slug` (servers are labelled
    `box_slug=<slug>`), and a logged action trail to reply to Hetzner with.
  - Egress policy decision: "full normal internet" for users vs. account safety.
    At minimum keep SMTP blocked; consider rate-limiting rather than unlimited
    egress. Document the chosen tradeoff.

- Some sort of milestone/goal counter/coming soon for the mobile app.

- TOS, Legal. Confirm Hetzner's terms on sub-letting/reselling compute to
  untrusted third parties - we become the responsible party for downstream abuse.
  - Staff box-content access for abuse investigation: keep passwords hashed (no
    plaintext "view password"), and gate any access to a user's workspace behind
    an explicit ToS clause plus an audited, justified, time-boxed flow (e.g. disk
    snapshot / infra-layer access), not a casual console button.

- Box metrics and abuse alerts - implemented June 2026 (cron-polled Hetzner
  metrics into `box_metrics` with hourly rollups in `box_metrics_hourly`,
  threshold flags in `box_flags`, staff alert emails via Resend, console
  charts ranking the top boxes per metric). Remaining:
  - Watch real baselines for a few weeks, tune thresholds in the console
    (Abuse thresholds panel on the staff console home) if needed, then turn
    on the auto-suspend toggle.
  - Verify a sending domain in Resend once a second staff member exists
    (unverified accounts deliver only to the account owner; see
    docs/setup.md).
  - Container logs stay pull-over-SSH with no storage: code-server stdout has
    no abuse value, and shipping it would put the first control-plane
    credential on the box.

- After the sandbox Polar subscription reaches its July 7, 2026 period end,
  switch dev to a fresh sandbox Polar organization with slug `composery-web`.
  The current sandbox org display name is Composery, but its immutable slug
  is still `agentbox-cloud`; do not carry that old slug forward into future dev
  checkouts. This affects dev/sandbox only, not production.

- Future scale path, only if needed much later: evaluate a bare-metal architecture if Hetzner Cloud economics or limits stop working at thousands of users.
