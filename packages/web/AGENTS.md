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

## Living Setup Doc

`docs/setup.md` and `.env.example.*` are the setup surfaces - keep them in lockstep with the code.

- Update them in the same change that adds/renames/removes an env var, provider, component, or read site. A new `process.env`/`requiredEnv`/`optionalEnv` read isn't done until it appears in the right example file(s) and the doc.
- Four files split by plane x env: `.env.example.convex.{dev,prod}` (vars read in `convex/`), `.env.example.next.{dev,prod}` (vars read by Next.js). A var goes in every file of its plane; dev/prod are key-identical, differing only in non-secret defaults. Secrets stay empty.
- Order sections by dependency, not service: backends -> providers -> enter values -> deploy.
- For each variable, state where it's read (file) and how to obtain the value (dashboard, scopes, object to create).
- Never commit secrets or account-specific values - give keys, scopes, and sources only.
- Ground every claim in the code; no guessed scopes, endpoints, or values.
- OS-neutral: portable POSIX shell only (no PowerShell-only cmdlets, no backslash paths); label fences `bash`.
