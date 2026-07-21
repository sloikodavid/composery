# Conventions

- `app/`, `components/`, `lib/` filenames: kebab-case (regular Next.js modules).
- `convex/` filenames: camelCase when the path becomes a generated API identifier (e.g. `api.staff.changeBoxSlug`).
- Database/schema fields and persisted status/type literals: snake_case (stored data, not JS names).
- Environment variables and deployment constants: SCREAMING_SNAKE_CASE.
- Install deps with `pnpm install <package>@latest`, not by hand-editing package.json.
- Box lifecycle workflows are named `<verb>Box` or `<verb>Box<target>`; see `convex/boxes/workflows/` for the current set.
- Retention and purge windows live in `convex/boxes/boxRetention.ts`; read the window from there rather than restating a duration.
- `purge_at` is optional, and Convex orders a missing field below every number in an index, so a bare `lte("purge_at", now)` also selects every row that never got one. Bound every such range from below (`gte("purge_at", 0)`); a test enforces it.
- No abstraction/extraction for confirmed single-use code. Dedupe shared hardcoded values so they can't drift.
- Collapse flashy or out-of-place words for consistency: Erase->Delete/Remove, Open->Start, Close->Stop, Complete/End->Finish, Spawn/Provision->Create, Mode->Type, Material->Contents, Kind->Type, Verify->Check?, Policy->Config?, Main->Index.

## Icons

- Interactive buttons/links use `@lucide-animated` icons from `components/icons`, wired through `components/animated-icon` so the whole target starts the animation on hover/focus. Status, sorting, loading, and informational glyphs stay static `lucide-react`.
- Add one: `pnpm dlx shadcn add @lucide-animated/<name>` -> move `components/<name>.tsx` into `components/icons/` -> normalize tabs and `initial="normal"` -> register in `components/animated-icon` (import, `AnimatedIconName` union, switch case).
- Consistency within a set: prefer the animated icon in animated-leaning contexts; stay static where motion is meaningless. Matching an external design 1:1 overrides this.

## Living setup docs

`../../docs/developing/web/` and `.env.example.*` are the setup surfaces - keep them in lockstep with the code.

- The `.env.example.*` files are the single documented list of environment variables per plane, and the code is what those files answer to. Every variable a plane reads - directly through `requiredEnv`/`optionalEnv`/`process.env`, or implicitly through an SDK/CLI (Clerk, Convex) - has an entry in that plane's example file, with a comment saying where the value comes from; nothing else re-enumerates the list. Prose docs (the service pages, `index.md`) point at the example file instead of restating names, so a variable belongs to a plane iff it appears in that plane's example file. A service page names only the one value it teaches you to obtain, not the whole plane. Plane membership follows the readers, not a fixed label: a variable read on more than one plane (e.g. by both the Next app and a Convex action) lives in every corresponding example and is called out as cross-plane in one place, never forbidden on a plane whose code reads it. When you add, move, or remove a read, grep the whole package for the name, fix the example file(s), and confirm no doc has restated the list.
- For each variable, state where it's read (file) and how to obtain the value (dashboard, scopes, object to create).
- Trim info that can drift like dashboard click-paths to the setting's name and where it logically lives; the dashboards move faster than the doc does.
- Ground every claim in the code; no guessed scopes, endpoints, or values.
- OS-neutral: portable POSIX shell only (no PowerShell-only cmdlets, no backslash paths); label fences `bash`.
