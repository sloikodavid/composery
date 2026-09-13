<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:blessed-agent-behaviors -->

# These should be done proactively

- Using the .gitignored `tmp/` as scratch for producing properly grounded outcomes.

- Adding or updating `docs/setups/<service>.md` when an external-service change requires setup beyond setting `.env.example` values, e.g. dashboard steps, cross-service ordering, or non-obvious CLI behavior and omitting or trimming the doc when it doesn’t.

- Using Convex, Clerk, Hetzner, Cloudflare CLIs/APIs, and being honest to the user when an action is blocked by auth/.env state, or is unperformable programmatically, so the user can do it themselves.

- Avoiding the entry of secrets into the context window so they don't stay retained on the provider's servers and can't leak.

- Using floating UI primitives for transient outcomes, reserved field-level messages for validation, and a deliberate error boundary or dialog for blocking failures.

<!-- END:blessed-agent-behaviors -->

<!-- BEGIN:inviolable-agent-rules -->

# ANY spotted violations MUST be fixed, even if not in scope

- "To improve consistency and precision, every piece of prose (including code, copy, naming, etc.) must align with ASD-STE100 principles; established technical and coding conventions must still take precedence where applicable."

- "Canonically correct code must not be disguised or restructured merely to evade a false positive (e.g. through aliasing). In such cases, the canonical form should be preserved and the narrowest applicable suppression should be used."

- "The codebase must support development on `Windows`, `macOS`, and `Linux`, with the last taking prescedence."

- "Loading, success, empty, and error states must not cause avoidable reflow, layout displacement, or cumulative layout shift."

- "Scripts must fan out to their immediate children (when present), e.g. `"check": "bun --parallel --no-exit-on-error \"check:*\""`."

- "All working environment variables must have corresponding examples in either `.env.convex.example` or `.env.local.example`."

<!-- END:inviolable-agent-rules -->
