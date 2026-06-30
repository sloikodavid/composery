import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";

// Grace window before a Hetzner resource is eligible for reclaim. A snapshot
// image exists for a few seconds before its row is patched with the id, and a
// freshly created server exists for minutes before provisioning records it on
// the box - the window keeps reconciliation off anything mid-flight.
export const RECONCILE_MIN_AGE_MS = 2 * 60 * 60 * 1000;

// A resource is reclaimable when nothing in our DB references it and it has
// aged past the grace window. Pure so the decision is testable without Hetzner
// or a database.
export function isReclaimable(
	createdAtMs: number,
	now: number,
	referenced: boolean,
	minAgeMs: number = RECONCILE_MIN_AGE_MS
) {
	return !referenced && now - createdAtMs >= minAgeMs;
}

export const snapshotImageIsKnown = internalQuery({
	args: { imageId: v.number() },
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query("box_snapshots")
			.withIndex("hetzner_image_id", (q) =>
				q.eq("hetzner_image_id", args.imageId)
			)
			.first();
		return row !== null;
	}
});

export const serverHasLiveBox = internalQuery({
	args: { serverId: v.number() },
	handler: async (ctx, args) => {
		const box = await ctx.db
			.query("boxes")
			.withIndex("hetzner_server_id", (q) =>
				q.eq("hetzner_server_id", args.serverId)
			)
			.first();
		// A deleted box keeps its server id, so a server still pointing at a deleted
		// box is a leak (its delete never finished), not a live box.
		return box !== null && box.status !== "deleted";
	}
});

// Daily backstop for orphaned Hetzner resources. Snapshot images are deleted
// outright (an unreferenced image is invisible in the UI and pure cost).
// Orphaned servers are only logged - auto-deleting a server on a DB-diff is too
// dangerous (a tracking bug would destroy a live box), so staff review the log.
export const reconcileHetznerResources = internalAction({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		const images = await ctx.runAction(
			internal.boxes.infra.hetznerVps.listProductSnapshotImages,
			{}
		);
		let deletedImages = 0;
		for (const image of images) {
			const known = await ctx.runQuery(
				internal.boxes.reconcile.snapshotImageIsKnown,
				{ imageId: image.imageId }
			);
			if (!isReclaimable(image.createdAtMs, now, known)) continue;
			await ctx.runAction(internal.boxes.infra.hetznerVps.deleteImage, {
				imageId: image.imageId
			});
			deletedImages += 1;
		}

		const servers = await ctx.runAction(
			internal.boxes.infra.hetznerVps.listProductServers,
			{}
		);
		const orphanedServers: number[] = [];
		for (const server of servers) {
			const live = await ctx.runQuery(
				internal.boxes.reconcile.serverHasLiveBox,
				{ serverId: server.serverId }
			);
			if (!isReclaimable(server.createdAtMs, now, live)) continue;
			orphanedServers.push(server.serverId);
		}

		if (deletedImages > 0) {
			console.info(
				`[reconcile] deleted ${deletedImages} orphaned snapshot image(s)`
			);
		}
		if (orphanedServers.length > 0) {
			console.warn(
				`[reconcile] orphaned Hetzner server(s), not auto-deleted: ${orphanedServers.join(", ")}`
			);
		}
	}
});
