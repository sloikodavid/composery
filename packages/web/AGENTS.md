# Conventions

- `app/`, `components/`, `lib/` filenames: kebab-case (regular Next.js modules).
- `convex/` filenames: camelCase when the path becomes a generated API identifier (e.g. `api.staff.changeBoxSlug`).
- Database/schema fields and persisted status/type literals: snake_case (stored data, not JS names).
- Environment variables and deployment constants: SCREAMING_SNAKE_CASE.
- Install deps with `pnpm install <package>@latest`, not by hand-editing package.json.
- Box lifecycle workflows: `<verb>Box<target>` - `provisionBox`, `resetBox`, `deleteBox`, `suspendBox`, `unsuspendBox`, `changeBoxSlug`, `changeBoxPassword`.
- No abstraction/extraction for confirmed single-use code. Dedupe shared hardcoded values so they can't drift.
- Collapse flashy or out-of-place words for consistency: Erase->Delete/Remove, Open->Start, Close->Stop, Complete/End->Finish, Spawn/Provision->Create, Mode->Type, Material->Contents, Kind->Type, Verify->Check?, Policy->Config?, Main->Index.

## Icons

- Interactive buttons/links use `@lucide-animated` icons from `components/icons`, wired through `components/animated-icon` so the whole target starts the animation on hover/focus. Status, sorting, loading, and informational glyphs stay static `lucide-react`.
- Add one: `pnpm dlx shadcn add @lucide-animated/<name>` -> move `components/<name>.tsx` into `components/icons/` -> normalize tabs and `initial="normal"` -> register in `components/animated-icon` (import, `AnimatedIconName` union, switch case).
- Consistency within a set: prefer the animated icon in animated-leaning contexts; stay static where motion is meaningless. Matching an external design 1:1 overrides this.

## Living setup docs

`../../docs/developing/web/` and `.env.example.*` are the setup surfaces - keep them in lockstep with the code.

- For each variable, state where it's read (file) and how to obtain the value (dashboard, scopes, object to create).
- Trim info that can drift like dashboard click-paths to the setting's name and where it logically lives; the dashboards move faster than the doc does.
- Ground every claim in the code; no guessed scopes, endpoints, or values.
- OS-neutral: portable POSIX shell only (no PowerShell-only cmdlets, no backslash paths); label fences `bash`.
