# Conventions

- `app/`, `components/`, `lib/` filenames: kebab-case (regular Next.js modules).
- `convex/` filenames: camelCase, because the path becomes a generated API identifier (`convex/staff/boxes.ts` -> `api.staff.boxes.reset`).
- Database/schema fields and persisted status/type literals: snake_case (stored data, not JS names).
- Environment variables and deployment constants: SCREAMING_SNAKE_CASE.
- Install deps with `pnpm install <package>@latest`, not by hand-editing package.json.
- Box lifecycle workflows are named `<verb>Box` or `<verb>Box<target>`; see `convex/boxes/workflows/` for the current set.
- Every box operation starts through `startBoxOperation` and carries a required `trigger` (`owner`, `staff`, or a `system:` sweep). Automatic repair decides whether a person is working on a box from that field alone, so a new automatic caller adds its own `system:` literal rather than borrowing one.
- A workflow declares its operation `type`, not its own failure handling. Where a failure leaves the box and what event it records live once in `OPERATION_FAILURE_STATUS` and `boxEventType` (`convex/boxes/boxOperationRules.ts`), because the sweep that rescues a stuck operation has to reach the same answer the workflow would have.
- Retention and purge windows live in `convex/boxes/boxRetention.ts`; read the window from there rather than restating a duration.
- `purge_at` is optional, and Convex orders a missing field below every number in an index, so a bare `lte("purge_at", now)` also selects every row that never got one. Bound every such range from below (`gte("purge_at", 0)`); a test enforces it.
- A directory is part of a name: inside `convex/boxes/` and `components/boxes/` the `box` prefix is redundant (`boxes/status-action.tsx`, not `boxes/box-status-action.tsx`), and so is `Box` in a function reached as `api.staff.boxes.*`.
- The same operation is named the same on both sides. `api.user.boxes.reset` and `api.staff.boxes.reset` are one action with two audiences, not two actions.
- Cloud box runtime settings are defined once in `convex/boxes/runtimeConfig.ts`; the Configuration page derives its controls from those field records. Every IDE environment setting added or changed must be checked against that allowlist and `../../docs/configuration.md`. Offer owner-settable capabilities there with explicit labels for stored enum values; omit managed/infrastructure values only with the reason documented beside the allowlist.

## Components

Four buckets, by what a file is rather than what it does:

- `components/base/` - the shadcn primitives, and the `shadcn add` target (`aliases.ui` in `components.json`). Regenerable vendor code: hand-edit sparingly and expect re-add diffs.
- `components/boxes/` - box-domain UI, mirroring `convex/boxes/` and `app/(site)/boxes/`. Inside it the `box-` prefix is redundant (`boxes/status-action.tsx`, not `boxes/box-status-action.tsx`).
- `components/icons/` - see below.
- `components/` itself - shared app UI only. A component with one consumer belongs in that page's `_components/`, not here.

## Icons

**Which kind.** An icon is animated iff it sits inside something hoverable and focusable as a unit - a button, a link, a clickable breadcrumb - because that element is what starts the animation. Everything else is a static `lucide-react` glyph: menu items, the current-page breadcrumb, status and empty-state glyphs, spinners, sort indicators. The rule is about the container, not the picture, so the same glyph can legitimately appear both ways.

**How they're reached.** Static glyphs are imported from `lucide-react`. Animated ones are never imported by name outside `components/animated-icon` - call sites name them (`icon="download"`, or `<AnimatedIcon icon="check" iconRef={ref} />` when the trigger lays its own icon out). A test enforces this; without it, `CheckIcon` means two different components depending on the import line.

- Every icon shares one shell (`components/icons/create.tsx`): the hover/handle wiring and the stock lucide `<svg>` props live there once, so an icon file is its variants plus its `<svg>` body and nothing else.
- Add one: `pnpm dlx shadcn add @lucide-animated/<name>` -> the file lands in `components/base/<name>.tsx` -> rewrite it as a `createAnimatedIcon` call at `components/icons/<name>.tsx` -> add a line to the `ICONS` map in `components/animated-icon`. `AnimatedIconName` reads off that map, and `components/icons/registry.test.ts` fails if you skip the last step.
- It lands in `base/` because `@lucide-animated` items are `registry:ui`, which the CLI writes to `aliases.ui`; `--path` does not override that. Nothing to fix - the file has to be rewritten by hand anyway, so move it while you rewrite it.
- Anything that renders an animated icon inside its own trigger uses `useAnimatedIconHandlers` rather than repeating the four handlers - it carries the `:focus-visible` guard that keeps programmatic focus (a dialog autofocusing its first button) from freezing the icon mid-pose.
- `icons/<name>.tsx` is a glyph registered in the map; `icons/<name>-logo.tsx` is a static brand logo that is not. Keeping those apart is what stops a second `XIcon` (the dismiss glyph vs the X/Twitter logo) from existing.
- Consistency within a set: prefer the animated icon in animated-leaning contexts; stay static where motion is meaningless. Matching an external design 1:1 overrides this.

## Living setup docs

`../../docs/developing/web/` and `.env.example.*` are the setup surfaces - keep them in lockstep with the code.

- The `.env.example.*` files are the single documented list of environment variables per plane, and the code is what those files answer to. Every variable a plane reads - directly through `requiredEnv`/`optionalEnv`/`process.env`, or implicitly through an SDK/CLI (Clerk, Convex) - has an entry in that plane's example file, with a comment saying where the value comes from; nothing else re-enumerates the list. Prose docs (the service pages, `index.md`) point at the example file instead of restating names, so a variable belongs to a plane iff it appears in that plane's example file. A service page names only the one value it teaches you to obtain, not the whole plane. Plane membership follows the readers, not a fixed label: a variable read on more than one plane (e.g. by both the Next app and a Convex action) lives in every corresponding example and is called out as cross-plane in one place, never forbidden on a plane whose code reads it. When you add, move, or remove a read, grep the whole package for the name, fix the example file(s), and confirm no doc has restated the list.
- For each variable, state where it's read (file) and how to obtain the value (dashboard, scopes, object to create).
- Trim info that can drift like dashboard click-paths to the setting's name and where it logically lives; the dashboards move faster than the doc does.
- Ground every claim in the code; no guessed scopes, endpoints, or values.
- OS-neutral: portable POSIX shell only (no PowerShell-only cmdlets, no backslash paths); label fences `bash`.
