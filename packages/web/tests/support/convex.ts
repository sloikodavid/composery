import polar from "@convex-dev/polar/test";
import resend from "@convex-dev/resend/test";
import workflow from "@convex-dev/workflow/test";
import { convexTest, type TestConvex } from "convex-test";
import { vi } from "vitest";

import type { Doc, Id } from "@/convex/_generated/dataModel";
import schema from "@/convex/schema";

// `convex-test` resolves a function reference like `boxes/queries:boxBySlug` by looking
// the path up in a module map, and it can only build that map from an
// `import.meta.glob` written where the glob's base is statically known. Tests
// live outside `convex/` (docs/developing/testing.md), so the glob is written
// once here rather than in every test file - a per-file glob would be the same
// pattern typed N times with N chances to miss a directory, and a missing entry
// surfaces as "Could not find module" from whichever test happens to reach it.
//
// The `_generated` files have to be in the glob: convex-test finds the root of
// the function tree by locating them.
const modules = import.meta.glob("../../convex/**/*.*s");

// The components `convex/convex.config.ts` installs, registered the same way and
// in the same place, because a harness missing one fails only in whichever test
// happens to reach that component - `startOperation` starts a real workflow, and
// a staff alert really tries to queue an email. Each package ships its own
// registrar, so this list stays a mirror of `convex.config.ts` and never a copy
// of any component's internals (the workflow one also registers its nested
// workpool, which lives at a pnpm path no glob here could name).
const COMPONENTS = [polar, resend, workflow];

export type Harness = TestConvex<typeof schema>;

// Why `convex/boxes/workflows/*` have no behaviour tests, established by
// measurement rather than assumed.
//
// A workflow really does start here - `startOperation` hands one to the
// component, driving the clock runs it, and its failure is recorded correctly.
// What it cannot do is take a step: every step is an action, and an action
// invoked through the workflow component's workpool runs in a context with no
// `process`, so it settles as failed with "process is not defined".
//
// Established by controlled experiment rather than inferred. In one test the
// *same* action was called both ways: `t.action(...)` succeeded, and the
// workpool's invocation of it failed with that error. It is not our
// `requiredEnv` - replacing the action with one that does nothing at all fails
// identically - and `vi.stubGlobal("process", process)` does not reach it. So it
// is the component's runner, and no arrangement of test code routes around it.
//
// So a workflow body can be observed failing but never succeeding, which is
// worth no test. What is testable is what the bodies decide, and those have been
// lifted out into modules the bodies call - `snapshotPollOutcome`,
// `parkingVerificationFailure`, `runtimeArtifactsForBox`, `dnsRecordAction`.
// Delete this note when the component's runner exposes `process`.
//
// Two more things this harness cannot distinguish, recorded so the next person
// reading a mutation report does not re-derive them.
//
// `.order("desc")` is one of them: convex-test decides direction with
// `order === "asc" ? 1 : -1`, so every value that is not exactly `"asc"` sorts
// descending. A mutant that rewrites `"desc"` to `""` therefore behaves
// identically and no test can kill it. The same goes for the table name inside
// `v.id("box_snapshots")` - nothing here checks which table an id came from, so
// emptying that string changes nothing either. Both are real code doing real
// work; they are simply invisible to this harness.
export function testConvex(): Harness {
	return registerComponents(convexTest(schema, modules));
}

function registerComponents<T extends { run: unknown }>(t: T) {
	for (const component of COMPONENTS) component.register(t as never);
	return t;
}

// The deployment variables a box's own row needs to render. `safeBox` builds a
// runtime URL for every box it returns, so a query as ordinary as "list my
// boxes" throws without `CLOUD_DOMAIN` - which makes this setup, not a fixture.
// Nothing here reaches a real service: these two only ever appear in URLs we
// build ourselves, and a test that needs a credentialled variable stubs that one
// itself, so what a test does not stub it does not use.
export function stubDeploymentEnv() {
	vi.stubEnv("CLOUD_DOMAIN", "dev.composery.cloud");
	vi.stubEnv("WEBSITE_ORIGIN", "https://composery.test");
	// The Polar product grid. Any path that reads a subscription back to a plan
	// needs it configured, and an unconfigured one degrades to "not a box product"
	// - which would silently turn a plan-reconciliation test into a test of the
	// unrecognised-product alert instead.
	vi.stubEnv("POLAR_BOX_AIR_MONTHLY_PRODUCT_ID", "air-monthly");
	vi.stubEnv("POLAR_BOX_AIR_ANNUAL_PRODUCT_ID", "air-annual");
	vi.stubEnv("POLAR_BOX_PRO_MONTHLY_PRODUCT_ID", "pro-monthly");
	vi.stubEnv("POLAR_BOX_PRO_ANNUAL_PRODUCT_ID", "pro-annual");
}

type UserSeed = {
	clerkUserId?: string;
	deletionPending?: boolean;
	email?: string;
	role?: Doc<"users">["role"];
	suspended?: boolean;
	suspendedReason?: string;
};

// Clerk owns the identity; the `users` row is ours. Every authorization path
// starts by matching one to the other on `clerk_user_id`, so a seeded user and
// the identity a test calls with have to agree - this returns the identity to
// pass to `withIdentity` so they cannot drift apart in a test's own setup.
export async function seedUser(t: Harness, seed: UserSeed = {}) {
	const clerkUserId = seed.clerkUserId ?? "clerk_user";
	const email = seed.email ?? `${clerkUserId}@example.com`;
	const userId = await t.run(
		async (ctx) =>
			await ctx.db.insert("users", {
				clerk_user_id: clerkUserId,
				email,
				role: seed.role ?? "user",
				suspended: seed.suspended ?? false,
				suspended_reason: seed.suspendedReason,
				deletion_pending: seed.deletionPending,
				created_at: 1,
				updated_at: 1
			})
	);

	return {
		as: t.withIdentity({ subject: clerkUserId, email }),
		clerkUserId,
		email,
		identity: { subject: clerkUserId, email },
		userId
	};
}

type BoxSeed = Partial<Doc<"boxes">> & { user_id: string };

export async function seedBox(t: Harness, seed: BoxSeed): Promise<Id<"boxes">> {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("boxes", {
				slug: "box",
				// The cheaper plan by default, so a test that says nothing about plans
				// exercises the one without manual snapshots - the restricted path is
				// the one worth having as the unstated baseline. The split follows the
				// seeded plan unless a test overrides it.
				plan: "air",
				manual_snapshot_cap: 0,
				status: "running",
				polar_subscription_id: undefined,
				created_at: 1,
				updated_at: 1,
				...seed
			})
	);
}

// The deployment's one settings row. Capacity admission treats an unset
// Hetzner limit as "capacity is not configured yet" and blocks every new box, so
// a test about anything downstream of that gate has to say what the limits are.
export async function seedSettings(
	t: Harness,
	settings: Partial<Doc<"settings">> = {}
) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("settings", {
				checkout_enabled: true,
				hetzner_server_limit: 100,
				hetzner_snapshot_limit: 1000,
				updated_at: 1,
				...settings
			})
	);
}

export function readBox(t: Harness, boxId: Id<"boxes">) {
	return t.run(async (ctx) => await ctx.db.get(boxId));
}

export function readOperation(t: Harness, operationId: Id<"box_operations">) {
	return t.run(async (ctx) => await ctx.db.get(operationId));
}

export function boxEvents(t: Harness, boxId: Id<"boxes">) {
	return t.run(
		async (ctx) =>
			await ctx.db
				.query("box_events")
				.withIndex("box_id_created_at", (q) => q.eq("box_id", boxId))
				.collect()
	);
}

export function boxOperations(t: Harness, boxId: Id<"boxes">) {
	return t.run(
		async (ctx) =>
			await ctx.db
				.query("box_operations")
				.withIndex("box_id_created_at", (q) => q.eq("box_id", boxId))
				.collect()
	);
}

export function staffAlerts(t: Harness) {
	return t.run(async (ctx) => await ctx.db.query("staff_alerts").collect());
}

// What a mutation asked the scheduler to do next, read rather than run.
//
// A lot of this code ends in `scheduler.runAfter(0, ...)` towards an action that
// talks to Hetzner or Cloudflare, and the decision under test is which row was
// chosen - not what the provider says about it. Reading the queue asserts the
// decision without letting a behaviour test reach the network, which is the line
// `docs/developing/testing.md` draws around this kind.
export async function scheduledJobs(t: Harness, name?: string) {
	const jobs = await t.run(
		async (ctx) => await ctx.db.system.query("_scheduled_functions").collect()
	);
	return name ? jobs.filter((job) => job.name === name) : jobs;
}

export async function scheduledArgs<T>(t: Harness, name: string) {
	const jobs = await scheduledJobs(t, name);
	return jobs.map((job) => job.args[0] as T);
}
