import { run } from "./run.mjs";

// The full repo gate, cheapest-first so failures surface fast. `pnpm check` runs
// this with node_modules/.bin on PATH, so bare tool names resolve.
const steps = [
	"tsc --noEmit",
	"node scripts/check-ide-overlay.mjs",
	"vitest run --coverage",
	"eslint .",
	"pnpm --filter web typecheck",
	"pnpm --filter web lint",
	"pnpm --filter web test",
	"node scripts/check-rust.mjs",
	"prettier --check .",
	"node scripts/tree.mjs",
	"pnpm dlx --package renovate renovate-config-validator renovate.json",
	// Mobile: expo export catches bundling errors tsc can't; customize checks
	// the tsconfig is still expo-shaped.
	"pnpm --filter mobile exec expo export --platform android",
	"pnpm --filter mobile exec expo customize tsconfig.json",
	"pnpm --filter mobile exec tsc --noEmit",
	"pnpm --filter mobile test",
	"pnpm --filter mobile lint"
];

for (const step of steps) run(step, [], { shell: true });
