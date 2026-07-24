import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { vBoxFailureStatus, vServerLocation, vServerType } from "../schema";
import { sendStaffAlert, staffConsoleUrl } from "../staffAlerts";
import { consoleBoxPath } from "../../lib/box-route";
import { appendBoxEvent } from "./boxEvents";
import { reconcileCapacityAlert } from "./capacityAlerts";
import { deletedBoxDataPatch } from "./boxRetention";
import { assertSlugAvailable } from "./slugAvailability";

export const markOperationRunning = internalMutation({
	args: {
		operationId: v.id("box_operations")
	},
	handler: async (ctx, args) => {
		const timestamp = Date.now();
		await ctx.db.patch(args.operationId, {
			status: "running",
			started_at: timestamp,
			updated_at: timestamp
		});
	}
});

export const recordServerCreated = internalMutation({
	args: {
		boxId: v.id("boxes"),
		ipv4: v.string(),
		ipv4Id: v.optional(v.number()),
		ipv6: v.string(),
		ipv6Id: v.optional(v.number()),
		location: vServerLocation,
		serverId: v.number(),
		serverType: vServerType
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		await ctx.db.patch(args.boxId, {
			hetzner_server_id: args.serverId,
			hetzner_server_type: args.serverType,
			hetzner_location: args.location,
			hetzner_ipv4: args.ipv4,
			hetzner_ipv4_id: args.ipv4Id,
			hetzner_ipv6: args.ipv6,
			hetzner_ipv6_id: args.ipv6Id,
			updated_at: Date.now()
		});

		await appendBoxEvent(ctx, box, "server.created", {
			metadata: {
				serverId: args.serverId,
				serverType: args.serverType,
				location: args.location,
				ipv4: args.ipv4,
				ipv4Id: args.ipv4Id,
				ipv6: args.ipv6,
				ipv6Id: args.ipv6Id
			}
		});
	}
});

export const recordServerRebuilt = internalMutation({
	args: {
		boxId: v.id("boxes"),
		ipv4: v.string(),
		ipv4Id: v.optional(v.number()),
		ipv6: v.string(),
		ipv6Id: v.optional(v.number()),
		location: vServerLocation,
		serverId: v.number(),
		serverType: vServerType
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		await ctx.db.patch(args.boxId, {
			hetzner_server_id: args.serverId,
			hetzner_server_type: args.serverType,
			hetzner_location: args.location,
			hetzner_ipv4: args.ipv4,
			hetzner_ipv4_id: args.ipv4Id,
			hetzner_ipv6: args.ipv6,
			hetzner_ipv6_id: args.ipv6Id,
			updated_at: Date.now()
		});

		await appendBoxEvent(ctx, box, "server.rebuilt", {
			metadata: {
				serverId: args.serverId,
				serverType: args.serverType,
				location: args.location,
				ipv4: args.ipv4,
				ipv4Id: args.ipv4Id,
				ipv6: args.ipv6,
				ipv6Id: args.ipv6Id
			}
		});
	}
});

export const setRuntimeImage = internalMutation({
	args: {
		boxId: v.id("boxes"),
		runtimeImage: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.boxId, {
			runtime_image: args.runtimeImage,
			updated_at: Date.now()
		});
	}
});

export const recordDnsCreated = internalMutation({
	args: {
		aRecordId: v.string(),
		aaaaRecordId: v.string(),
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		await ctx.db.patch(args.boxId, {
			dns_record_id: args.aRecordId,
			dns_record_aaaa_id: args.aaaaRecordId,
			updated_at: Date.now()
		});

		await appendBoxEvent(ctx, box, "dns.record_created", {
			metadata: {
				aRecordId: args.aRecordId,
				aaaaRecordId: args.aaaaRecordId
			}
		});
	}
});

export const markProvisionSucceeded = internalMutation({
	args: {
		boxId: v.id("boxes"),
		operationId: v.id("box_operations")
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		const timestamp = Date.now();
		await ctx.db.patch(args.boxId, {
			status: "running",
			provisioned_at: timestamp,
			updated_at: timestamp
		});
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: timestamp,
			updated_at: timestamp
		});
		await appendBoxEvent(ctx, box, "box.running");
	}
});

// Safety net for the operation lock: every workflow body is expected to close
// its own operation (and set the terminal box status) in a final mutation. If
// one returns without doing so, this closes the still-active operation so a
// forgotten terminal mutation can never brick the box. A no-op when the body
// already settled the operation.
export const settleOperation = internalMutation({
	args: { operationId: v.id("box_operations") },
	handler: async (ctx, args) => {
		const operation = await ctx.db.get(args.operationId);
		if (!operation) return;
		if (operation.status !== "pending" && operation.status !== "running") {
			return;
		}
		const timestamp = Date.now();
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: timestamp,
			updated_at: timestamp
		});
	}
});

export const markOperationFailed = internalMutation({
	args: {
		boxId: v.id("boxes"),
		error: v.string(),
		eventType: v.string(),
		operationId: v.id("box_operations"),
		targetBoxStatus: v.optional(vBoxFailureStatus)
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");
		const operation = await ctx.db.get(args.operationId);
		const timestamp = Date.now();

		if (args.targetBoxStatus) {
			await ctx.db.patch(args.boxId, {
				status: args.targetBoxStatus,
				updated_at: timestamp
			});
		}

		await ctx.db.patch(args.operationId, {
			status: "failed",
			finished_at: timestamp,
			last_error: args.error,
			updated_at: timestamp
		});
		await appendBoxEvent(ctx, box, args.eventType, {
			message: args.error
		});

		const operationType = operation?.type ?? "unknown";
		const critical = new Set([
			"provision",
			"delete",
			"reset",
			"restore",
			"recover"
		]).has(operationType);
		await sendStaffAlert(ctx, {
			key: `box-operation-failed:${args.operationId}`,
			severity: critical ? "critical" : "warning",
			subject: `Box ${box.slug}: ${operationType} failed`,
			text: `${operationType} failed for box ${box.slug} (${box._id}).\n\n${args.error}\n\nReview the operation: ${staffConsoleUrl(consoleBoxPath(box._id))}`
		});
	}
});

export const updateRuntimeAuthHash = internalMutation({
	args: {
		boxId: v.id("boxes"),
		operationId: v.id("box_operations"),
		runtimeAuthHash: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");
		const operation = await ctx.db.get(args.operationId);
		if (!operation || operation.box_id !== box._id) {
			throw new ConvexError("Box operation not found.");
		}

		const timestamp = Date.now();
		await ctx.db.patch(args.boxId, {
			runtime_auth_hash: args.runtimeAuthHash,
			password_setup_pending_at: undefined,
			updated_at: timestamp
		});
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: timestamp,
			updated_at: timestamp
		});
		await appendBoxEvent(ctx, box, "box.password_changed");
	}
});

export const swapSlug = internalMutation({
	args: {
		boxId: v.id("boxes"),
		newARecordId: v.string(),
		newAaaaRecordId: v.string(),
		newSlug: v.string(),
		operationId: v.id("box_operations")
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");
		await assertSlugAvailable(ctx, args.newSlug, args.boxId);

		const oldSlug = box.slug;
		const timestamp = Date.now();
		await ctx.db.patch(args.boxId, {
			slug: args.newSlug,
			dns_record_id: args.newARecordId,
			dns_record_aaaa_id: args.newAaaaRecordId,
			status: "running",
			updated_at: timestamp
		});
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: timestamp,
			updated_at: timestamp
		});
		await appendBoxEvent(ctx, box, "box.slug_changed", {
			metadata: {
				oldSlug,
				newSlug: args.newSlug,
				newARecordId: args.newARecordId,
				newAaaaRecordId: args.newAaaaRecordId
			}
		});
	}
});

// Repair leaves the box exactly where it started - "running" - so this only
// clears the transient `repairing` status and settles the operation the dialog
// reads for the outcome.
export const markRepairSucceeded = internalMutation({
	args: {
		boxId: v.id("boxes"),
		operationId: v.id("box_operations")
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		const timestamp = Date.now();
		await ctx.db.patch(args.boxId, {
			status: "running",
			updated_at: timestamp
		});
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: timestamp,
			updated_at: timestamp
		});
		await appendBoxEvent(ctx, box, "box.recovery_succeeded");
	}
});

export const markResetSucceeded = internalMutation({
	args: {
		boxId: v.id("boxes"),
		operationId: v.id("box_operations")
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		const timestamp = Date.now();
		await ctx.db.patch(args.boxId, {
			status: "running",
			updated_at: timestamp
		});
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: timestamp,
			updated_at: timestamp
		});
		await appendBoxEvent(ctx, box, "box.reset_succeeded");
	}
});

export const markDeleted = internalMutation({
	args: {
		boxId: v.id("boxes"),
		operationId: v.id("box_operations")
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		const timestamp = Date.now();
		await ctx.db.patch(args.boxId, {
			...deletedBoxDataPatch(timestamp),
			updated_at: timestamp
		});
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: timestamp,
			updated_at: timestamp
		});
		await appendBoxEvent(ctx, box, "box.deleted");
		await ctx.scheduler.runAfter(
			0,
			internal.boxes.boxCleanup.deleteRuntimeData,
			{
				boxId: box._id
			}
		);
		await ctx.scheduler.runAfter(
			0,
			internal.boxes.boxCleanup.sanitizeOperations,
			{
				boxId: box._id
			}
		);
		await ctx.scheduler.runAfter(0, internal.boxes.boxCleanup.sanitizeEvents, {
			boxId: box._id
		});
		await ctx.scheduler.runAfter(
			0,
			internal.boxes.boxCleanup.startCheckoutRetention,
			{
				boxId: box._id,
				deletedAt: timestamp
			}
		);

		// Snapshot images survive server deletion, so drop them now rather than
		// letting them linger and bill.
		await ctx.runMutation(
			internal.boxes.boxSnapshots.cascadeDeleteBoxSnapshots,
			{ boxId: box._id }
		);
		await reconcileCapacityAlert(ctx);
	}
});

export const setBoxStatusWithOperationSucceeded = internalMutation({
	args: {
		boxId: v.id("boxes"),
		eventType: v.string(),
		operationId: v.id("box_operations"),
		status: v.union(
			v.literal("running"),
			v.literal("stopped"),
			v.literal("suspended"),
			v.literal("suspending"),
			v.literal("unsuspending")
		)
	},
	handler: async (ctx, args) => {
		const box = await ctx.db.get(args.boxId);
		if (!box) throw new ConvexError("Box not found.");

		const timestamp = Date.now();
		await ctx.db.patch(args.boxId, {
			status: args.status,
			updated_at: timestamp
		});
		await ctx.db.patch(args.operationId, {
			status: "succeeded",
			finished_at: timestamp,
			updated_at: timestamp
		});
		await appendBoxEvent(ctx, box, args.eventType);
	}
});
