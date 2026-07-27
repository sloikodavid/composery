import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

// One-shot rewrite of the stored names that the `provision` -> `create` rename
// left behind, plus the box events that were written in the four grammars
// `boxEventType` replaced.
//
// This is transitional by design and is meant to be deleted. It exists as a real
// internal mutation rather than a script so it runs against the deployment's own
// data with the deployment's own types, and so the same command can be pointed at
// dev and at prod.
//
// How it is safe to run:
//
//   * every rewrite is old -> new with no new information, so running it twice
//     changes nothing the second time;
//   * it is paged, so a large table cannot exceed a transaction;
//   * it reports what it changed, so "0 remaining" is an observation rather than
//     an assumption.
//
// Order of operations for the rename itself: push the code with
// `schemaValidation: false`, run this, then push again with validation back on.
// That final push is the check - if any row still held an old value, the schema
// would refuse it, so the migration cannot be "finished" while it is incomplete.

const RENAME_BATCH = 200;

// Statuses. `provisioning`/`provisioning_failed` were the box's own spelling of
// what is now `creating`/`create_failed`.
const BOX_STATUS_RENAMES: Record<string, string> = {
	provisioning: "creating",
	provisioning_failed: "create_failed"
};

const OPERATION_TYPE_RENAMES: Record<string, string> = {
	provision: "create"
};

// Event names, from the four grammars that used to coexist to the one
// `boxEventType` derives. Only operation-outcome events are listed: the
// infrastructure facts (`box.parking_volume_*`, `server.*`, `dns.*`) were already
// consistent and keep their names.
const EVENT_RENAMES: Record<string, string> = {
	// Outcome events that named the resulting state instead of the operation.
	"box.running": "box.create_succeeded",
	"box.deleted": "box.delete_succeeded",
	"box.stopped": "box.stop_succeeded",
	"box.started": "box.start_succeeded",
	"box.suspended": "box.suspend_succeeded",
	"box.unsuspended": "box.unsuspend_succeeded",
	// Outcome events that used the attribute's past participle.
	"box.password_changed": "box.change_password_succeeded",
	"box.slug_changed": "box.change_slug_succeeded",
	"box.config_applied": "box.change_config_succeeded",
	"box.snapshot_created": "box.snapshot_succeeded",
	"box.snapshot_restored": "box.restore_succeeded",
	// Failure events whose name disagreed with their own operation type.
	"box.provisioning_failed": "box.create_failed",
	"box.slug_change_failed": "box.change_slug_failed",
	"box.config_failed": "box.change_config_failed",
	// Started / skipped.
	"box.provisioning_started": "box.create_started",
	"box.update_not_needed": "box.update_skipped"
};

export const renameBoxes = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("boxes")
			.paginate({ cursor: args.cursor ?? null, numItems: RENAME_BATCH });

		let changed = 0;
		for (const box of page.page) {
			const next = BOX_STATUS_RENAMES[box.status as string];
			if (!next) continue;
			// Cast at the boundary only: the stored value is one the current union no
			// longer contains, which is exactly what this mutation is here to fix.
			await ctx.db.patch(box._id, {
				status: next as typeof box.status
			});
			changed += 1;
		}

		if (!page.isDone) {
			const rest: number = await ctx.runMutation(
				internal.boxes.rename.renameBoxes,
				{ cursor: page.continueCursor }
			);
			return changed + rest;
		}
		return changed;
	}
});

// `provisioned_at` became `ready_at`: the moment the box first served, named for
// the state it reached rather than for the operation that got it there (the
// operation's own timestamps live on its row).
//
// Field renames are the half of this migration that schema validation catches on
// its own - an old row carrying a field the validator no longer lists fails the
// push, which is how this mutation came to exist at all.
export const renameBoxFields = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("boxes")
			.paginate({ cursor: args.cursor ?? null, numItems: RENAME_BATCH });

		let changed = 0;
		for (const box of page.page) {
			const legacy = (box as Record<string, unknown>).provisioned_at;
			if (legacy === undefined) continue;
			await ctx.db.patch(box._id, {
				// Only fill `ready_at` if nothing already set it, so a re-run cannot
				// overwrite a newer value with the old field.
				ready_at: box.ready_at ?? (legacy as number),
				// `undefined` removes the field, which is what the validator wants.
				provisioned_at: undefined
			} as Partial<typeof box>);
			changed += 1;
		}

		if (!page.isDone) {
			const rest: number = await ctx.runMutation(
				internal.boxes.rename.renameBoxFields,
				{ cursor: page.continueCursor }
			);
			return changed + rest;
		}
		return changed;
	}
});

export const renameOperations = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("box_operations")
			.paginate({ cursor: args.cursor ?? null, numItems: RENAME_BATCH });

		let changed = 0;
		for (const operation of page.page) {
			const next = OPERATION_TYPE_RENAMES[operation.type as string];
			if (!next) continue;
			await ctx.db.patch(operation._id, {
				type: next as typeof operation.type
			});
			changed += 1;
		}

		if (!page.isDone) {
			const rest: number = await ctx.runMutation(
				internal.boxes.rename.renameOperations,
				{ cursor: page.continueCursor }
			);
			return changed + rest;
		}
		return changed;
	}
});

export const renameEvents = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("box_events")
			.paginate({ cursor: args.cursor ?? null, numItems: RENAME_BATCH });

		let changed = 0;
		for (const event of page.page) {
			const next = EVENT_RENAMES[event.type];
			if (!next) continue;
			await ctx.db.patch(event._id, { type: next });
			changed += 1;
		}

		if (!page.isDone) {
			const rest: number = await ctx.runMutation(
				internal.boxes.rename.renameEvents,
				{ cursor: page.continueCursor }
			);
			return changed + rest;
		}
		return changed;
	}
});

// What is left to do. Run before and after: it is the only honest way to know the
// migration finished, rather than trusting that it did.
export const renameRemaining = internalMutation({
	args: {},
	handler: async (ctx) => {
		const boxes = await ctx.db.query("boxes").collect();
		const operations = await ctx.db.query("box_operations").collect();
		const events = await ctx.db.query("box_events").collect();
		return {
			boxes: boxes.filter((box) => BOX_STATUS_RENAMES[box.status as string])
				.length,
			boxFields: boxes.filter(
				(box) => (box as Record<string, unknown>).provisioned_at !== undefined
			).length,
			operations: operations.filter(
				(operation) => OPERATION_TYPE_RENAMES[operation.type as string]
			).length,
			events: events.filter((event) => EVENT_RENAMES[event.type]).length
		};
	}
});

export const renameAll = internalMutation({
	args: {},
	handler: async (ctx) => {
		const boxes: number = await ctx.runMutation(
			internal.boxes.rename.renameBoxes,
			{}
		);
		const boxFields: number = await ctx.runMutation(
			internal.boxes.rename.renameBoxFields,
			{}
		);
		const operations: number = await ctx.runMutation(
			internal.boxes.rename.renameOperations,
			{}
		);
		const events: number = await ctx.runMutation(
			internal.boxes.rename.renameEvents,
			{}
		);
		return { boxes, boxFields, operations, events };
	}
});
