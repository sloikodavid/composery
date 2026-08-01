import { describe, expect, test } from "vitest";

import { internal } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

import {
	seedBox,
	seedUser,
	unvalidatedTestConvex,
	type Harness
} from "../../../support/convex.ts";

// Run against a harness with the schema's validators off, because that is how
// this migration is run - see `unvalidatedTestConvex`. A validated harness
// cannot hold a `provisioning` box at all, so it could only ever assert that the
// migration leaves current values alone, which is the half that does not matter.
const testConvex = unvalidatedTestConvex;

// The one-shot rewrite of names the `provision` -> `create` rename left behind,
// and of the four event grammars `boxEventType` replaced.
//
// It is transitional and meant to be deleted, which is exactly why it is tested:
// it is run by hand against a live deployment's own rows, its safety rests on
// three claims its header makes - idempotent, paged, and honest about what is
// left - and none of them had ever been executed. A migration that is wrong is
// wrong against production data, once, with no undo.

// Written through `t.run` rather than the seed helpers, because these are values
// the current schema unions no longer contain - which is the whole situation the
// migration exists for.
async function seedLegacyBox(t: Harness, status: string) {
	const owner = await seedUser(t, { clerkUserId: `user_${status}` });
	return await seedBox(t, {
		user_id: owner.clerkUserId,
		slug: `box-${status}`,
		status: status as Doc<"boxes">["status"]
	});
}

async function seedOperation(t: Harness, boxId: Id<"boxes">, type: string) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_operations", {
				box_id: boxId,
				type: type as Doc<"box_operations">["type"],
				status: "succeeded",
				idempotency_key: `${type}:${boxId}`,
				trigger: "owner",
				created_at: 1,
				updated_at: 1
			})
	);
}

async function seedEvent(t: Harness, boxId: Id<"boxes">, type: string) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_events", {
				box_id: boxId,
				user_id: "user_1",
				type,
				created_at: 1
			})
	);
}

const readBoxes = (t: Harness) =>
	t.run((ctx) => ctx.db.query("boxes").collect());
const readOperations = (t: Harness) =>
	t.run((ctx) => ctx.db.query("box_operations").collect());
const readEvents = (t: Harness) =>
	t.run((ctx) => ctx.db.query("box_events").collect());

describe("renaming box statuses", () => {
	test.each([
		["provisioning", "creating"],
		["provisioning_failed", "create_failed"]
	])("rewrites %s to %s", async (legacy, current) => {
		const t = testConvex();
		await seedLegacyBox(t, legacy);

		expect(await t.mutation(internal.boxes.rename.renameBoxes, {})).toBe(1);
		expect(await readBoxes(t)).toMatchObject([{ status: current }]);
	});

	// The claim its header makes, and the one that decides whether it is safe to
	// run twice against production: every rewrite is old -> new with no new
	// information, so a second run changes nothing.
	test("changes nothing on a second run", async () => {
		const t = testConvex();
		await seedLegacyBox(t, "provisioning");
		await t.mutation(internal.boxes.rename.renameBoxes, {});

		expect(await t.mutation(internal.boxes.rename.renameBoxes, {})).toBe(0);
		expect(await readBoxes(t)).toMatchObject([{ status: "creating" }]);
	});

	test("leaves a box already on a current status alone", async () => {
		const t = testConvex();
		await seedLegacyBox(t, "running");

		expect(await t.mutation(internal.boxes.rename.renameBoxes, {})).toBe(0);
		expect(await readBoxes(t)).toMatchObject([{ status: "running" }]);
	});
});

describe("renaming the field that recorded when a box first served", () => {
	async function seedProvisionedAt(
		t: Harness,
		values: { provisionedAt?: number; readyAt?: number }
	) {
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			ready_at: values.readyAt
		});
		if (values.provisionedAt !== undefined) {
			await t.run(async (ctx) => {
				await ctx.db.patch(boxId, {
					provisioned_at: values.provisionedAt
				} as Partial<Doc<"boxes">>);
			});
		}
		return boxId;
	}

	test("moves the old field's value into ready_at and drops it", async () => {
		const t = testConvex();
		await seedProvisionedAt(t, { provisionedAt: 1_700 });

		expect(await t.mutation(internal.boxes.rename.renameBoxFields, {})).toBe(1);

		const [box] = await readBoxes(t);
		expect(box).toMatchObject({ ready_at: 1_700 });
		expect(box).not.toHaveProperty("provisioned_at");
	});

	// A re-run must not overwrite a newer value with the older field: a box that
	// has since served again holds the truth in `ready_at`.
	test("never overwrites a ready_at that is already set", async () => {
		const t = testConvex();
		await seedProvisionedAt(t, { provisionedAt: 1_700, readyAt: 2_900 });

		await t.mutation(internal.boxes.rename.renameBoxFields, {});

		expect(await readBoxes(t)).toMatchObject([{ ready_at: 2_900 }]);
	});

	test("leaves a box that never had the old field alone", async () => {
		const t = testConvex();
		await seedProvisionedAt(t, { readyAt: 2_900 });

		expect(await t.mutation(internal.boxes.rename.renameBoxFields, {})).toBe(0);
	});
});

describe("renaming operation types", () => {
	test("rewrites provision to create", async () => {
		const t = testConvex();
		const boxId = await seedLegacyBox(t, "running");
		await seedOperation(t, boxId, "provision");

		expect(await t.mutation(internal.boxes.rename.renameOperations, {})).toBe(
			1
		);
		expect(await readOperations(t)).toMatchObject([{ type: "create" }]);
	});

	test("leaves every other operation type alone", async () => {
		const t = testConvex();
		const boxId = await seedLegacyBox(t, "running");
		await seedOperation(t, boxId, "repair");

		expect(await t.mutation(internal.boxes.rename.renameOperations, {})).toBe(
			0
		);
		expect(await readOperations(t)).toMatchObject([{ type: "repair" }]);
	});
});

// Four grammars became one. Each row here is a name a box really wrote, and the
// name `boxEventType` derives for the same fact today.
describe("renaming box events", () => {
	test.each([
		["box.running", "box.create_succeeded"],
		["box.deleted", "box.delete_succeeded"],
		["box.stopped", "box.stop_succeeded"],
		["box.started", "box.start_succeeded"],
		["box.suspended", "box.suspend_succeeded"],
		["box.unsuspended", "box.unsuspend_succeeded"],
		["box.password_changed", "box.change_password_succeeded"],
		["box.slug_changed", "box.change_slug_succeeded"],
		["box.config_applied", "box.change_config_succeeded"],
		["box.snapshot_created", "box.snapshot_succeeded"],
		["box.snapshot_restored", "box.restore_succeeded"],
		["box.provisioning_failed", "box.create_failed"],
		["box.slug_change_failed", "box.change_slug_failed"],
		["box.config_failed", "box.change_config_failed"],
		["box.provisioning_started", "box.create_started"],
		["box.update_not_needed", "box.update_skipped"]
	])("rewrites %s to %s", async (legacy, current) => {
		const t = testConvex();
		const boxId = await seedLegacyBox(t, "running");
		await seedEvent(t, boxId, legacy);

		expect(await t.mutation(internal.boxes.rename.renameEvents, {})).toBe(1);
		expect(await readEvents(t)).toMatchObject([{ type: current }]);
	});

	// The infrastructure facts were already consistent and keep their names, so a
	// rewrite reaching one would be renaming something that was never wrong.
	test.each([
		"box.parking_volume_created",
		"server.created",
		"dns.record_created",
		"box.repair_succeeded"
	])("leaves %s exactly as it is", async (type) => {
		const t = testConvex();
		const boxId = await seedLegacyBox(t, "running");
		await seedEvent(t, boxId, type);

		expect(await t.mutation(internal.boxes.rename.renameEvents, {})).toBe(0);
		expect(await readEvents(t)).toMatchObject([{ type }]);
	});
});

// "0 remaining" has to be an observation, not an assumption - it is the only
// thing that says the migration finished.
describe("counting what is left to do", () => {
	test("reports each kind of legacy row it still finds", async () => {
		const t = testConvex();
		const boxId = await seedLegacyBox(t, "provisioning");
		await seedOperation(t, boxId, "provision");
		await seedEvent(t, boxId, "box.running");
		await t.run(async (ctx) => {
			await ctx.db.patch(boxId, {
				provisioned_at: 1_700
			} as Partial<Doc<"boxes">>);
		});

		expect(await t.mutation(internal.boxes.rename.renameRemaining, {})).toEqual(
			{
				boxes: 1,
				boxFields: 1,
				operations: 1,
				events: 1
			}
		);
	});

	test("reports nothing left once everything has been rewritten", async () => {
		const t = testConvex();
		const boxId = await seedLegacyBox(t, "provisioning");
		await seedOperation(t, boxId, "provision");
		await seedEvent(t, boxId, "box.running");

		await t.mutation(internal.boxes.rename.renameAll, {});

		expect(await t.mutation(internal.boxes.rename.renameRemaining, {})).toEqual(
			{
				boxes: 0,
				boxFields: 0,
				operations: 0,
				events: 0
			}
		);
	});
});

describe("running the whole migration", () => {
	test("reports what each table changed", async () => {
		const t = testConvex();
		const boxId = await seedLegacyBox(t, "provisioning");
		await seedOperation(t, boxId, "provision");
		await seedEvent(t, boxId, "box.stopped");
		await t.run(async (ctx) => {
			await ctx.db.patch(boxId, {
				provisioned_at: 1_700
			} as Partial<Doc<"boxes">>);
		});

		expect(await t.mutation(internal.boxes.rename.renameAll, {})).toEqual({
			boxes: 1,
			boxFields: 1,
			operations: 1,
			events: 1
		});
		expect(await readBoxes(t)).toMatchObject([
			{ status: "creating", ready_at: 1_700 }
		]);
		expect(await readOperations(t)).toMatchObject([{ type: "create" }]);
		expect(await readEvents(t)).toMatchObject([{ type: "box.stop_succeeded" }]);
	});

	// Paged, so a table larger than one transaction is still fully rewritten
	// rather than left half-migrated with nothing saying so.
	test("rewrites past a single page of rows", async () => {
		const t = testConvex();
		const boxId = await seedLegacyBox(t, "running");
		await t.run(async (ctx) => {
			for (let index = 0; index < 205; index += 1) {
				await ctx.db.insert("box_events", {
					box_id: boxId,
					user_id: "user_1",
					type: "box.stopped",
					created_at: index
				});
			}
		});

		expect(await t.mutation(internal.boxes.rename.renameEvents, {})).toBe(205);
		expect(
			(await readEvents(t)).filter((event) => event.type === "box.stopped")
		).toEqual([]);
	});
});

// A table larger than one page.
//
// The migration is run once, by hand, against a deployment whose tables are
// already large - which is the only situation it exists for. Each rewrite pages
// itself and returns what it changed, and the header's claim that "0 remaining"
// means finished rests entirely on the recursion carrying the cursor and the
// count summing across pages. A re-drive that lost either would report a small
// number, leave most rows untouched, and look exactly like success.
describe("rewriting a table larger than one page", () => {
	const OVER_ONE_PAGE = 201;

	async function legacyBoxes(t: Harness, count: number) {
		const owner = await seedUser(t, { clerkUserId: "user_bulk" });
		await t.run(async (ctx) => {
			for (let index = 0; index < count; index += 1) {
				await ctx.db.insert("boxes", {
					user_id: owner.clerkUserId,
					slug: `bulk-${index}`,
					plan: "air",
					manual_snapshot_cap: 0,
					status: "provisioning" as Doc<"boxes">["status"],
					created_at: 1,
					updated_at: 1
				});
			}
		});
	}

	test("renames every status past the first page and counts them all", async () => {
		const t = testConvex();
		await legacyBoxes(t, OVER_ONE_PAGE);

		expect(await t.mutation(internal.boxes.rename.renameBoxes, {})).toBe(
			OVER_ONE_PAGE
		);
		const boxes = await readBoxes(t);
		expect(boxes.filter((box) => box.status === "creating")).toHaveLength(
			OVER_ONE_PAGE
		);
	});

	test("renames every legacy field past the first page and counts them all", async () => {
		const t = testConvex();
		const owner = await seedUser(t, { clerkUserId: "user_bulk" });
		await t.run(async (ctx) => {
			for (let index = 0; index < OVER_ONE_PAGE; index += 1) {
				await ctx.db.insert("boxes", {
					user_id: owner.clerkUserId,
					slug: `bulk-${index}`,
					plan: "air",
					manual_snapshot_cap: 0,
					status: "running",
					provisioned_at: 1000 + index,
					created_at: 1,
					updated_at: 1
				} as never);
			}
		});

		expect(await t.mutation(internal.boxes.rename.renameBoxFields, {})).toBe(
			OVER_ONE_PAGE
		);
		const boxes = await readBoxes(t);
		expect(
			boxes.filter(
				(box) => (box as Record<string, unknown>).provisioned_at !== undefined
			)
		).toEqual([]);
		expect(boxes.filter((box) => box.ready_at !== undefined)).toHaveLength(
			OVER_ONE_PAGE
		);
	});

	test("renames every operation type past the first page and counts them all", async () => {
		const t = testConvex();
		const owner = await seedUser(t, { clerkUserId: "user_bulk" });
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "bulk"
		});
		await t.run(async (ctx) => {
			for (let index = 0; index < OVER_ONE_PAGE; index += 1) {
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: "provision" as Doc<"box_operations">["type"],
					status: "succeeded",
					idempotency_key: `provision:${index}`,
					trigger: "owner",
					created_at: 1,
					updated_at: 1
				});
			}
		});

		expect(await t.mutation(internal.boxes.rename.renameOperations, {})).toBe(
			OVER_ONE_PAGE
		);
		const operations = await readOperations(t);
		expect(
			operations.filter((operation) => operation.type === "create")
		).toHaveLength(OVER_ONE_PAGE);
	});

	// Nothing left over is the only signal the migration is done, so the counter
	// has to agree with the tables after a multi-page run.
	test("reports nothing remaining once a multi-page run has finished", async () => {
		const t = testConvex();
		await legacyBoxes(t, OVER_ONE_PAGE);

		await t.mutation(internal.boxes.rename.renameAll, {});

		expect(await t.mutation(internal.boxes.rename.renameRemaining, {})).toEqual(
			{
				boxes: 0,
				boxFields: 0,
				operations: 0,
				events: 0
			}
		);
	});
});
