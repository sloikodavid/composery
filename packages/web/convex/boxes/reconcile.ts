import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
	internalAction,
	internalMutation,
	internalQuery
} from "../_generated/server";
import { sendStaffAlert } from "../staffAlerts";

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

// A parking volume is owned recovery data only while a live box still points at
// it: a succeeded repair clears the pointer, and a deleted box drops it, so an
// unreferenced volume is a genuine orphan. A `repair_failed` box keeps its
// pointer, which is exactly what protects its files from being reclaimed before
// a retry.
export const volumeReferencedByLiveBox = internalQuery({
	args: { volumeId: v.number() },
	handler: async (ctx, args) => {
		const box = await ctx.db
			.query("boxes")
			.withIndex("parking_volume_id", (q) =>
				q.eq("parking_volume_id", args.volumeId)
			)
			.first();
		return box !== null && box.status !== "deleted";
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
		// Tombstones clear their server id (deletedBoxDataPatch), but this file
		// exists to catch tracking bugs, so don't trust that invariant here:
		// only a non-deleted row proves the Hetzner server is owned by a live box.
		return box !== null && box.status !== "deleted";
	}
});

// Orphaned servers are never deleted automatically - a tracking bug in the
// DB-diff would destroy live boxes - so staff get an email and remove them by
// hand in the Hetzner console. No-op without both Resend vars or admins.
export const alertOrphanedServers = internalMutation({
	args: {
		servers: v.array(
			v.object({
				serverId: v.number(),
				name: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const lines = args.servers.map(
			(server) =>
				`- ${server.serverId}${server.name ? ` (${server.name})` : ""}`
		);
		const serverIds = args.servers
			.map((server) => server.serverId)
			.sort((a, b) => a - b)
			.join(",");
		await sendStaffAlert(ctx, {
			key: `orphaned-hetzner-servers:${serverIds}`,
			severity: "critical",
			subject: `${args.servers.length} orphaned Hetzner server(s) need review`,
			text: `Daily reconciliation found Hetzner servers older than the grace window with no live box pointing at them. They are never removed automatically; review them in the Hetzner console and remove them by hand:\n\n${lines.join("\n")}\n\nhttps://console.hetzner.cloud/`
		});
	}
});

// Daily backstop for orphaned Hetzner resources. Snapshot images are deleted
// outright (an unreferenced image is invisible in the UI and pure cost).
// Orphaned servers are only reported via alertOrphanedServers, never deleted.
export const reconcileHetznerResources = internalAction({
	args: {},
	handler: async (ctx) => {
		try {
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

			// Parking volumes bill hourly, so an orphan is a slow money leak. Unlike
			// servers, an unreferenced parking volume is safe to delete outright: no
			// live box points at it, so it is either from a finished repair (pointer
			// cleared) or a gone box. A `repair_failed` box still references its
			// volume, so its recovery data is never reclaimed here.
			const volumes = await ctx.runAction(
				internal.boxes.infra.hetznerVps.listProductVolumes,
				{}
			);
			let deletedVolumes = 0;
			for (const volume of volumes) {
				const referenced = await ctx.runQuery(
					internal.boxes.reconcile.volumeReferencedByLiveBox,
					{ volumeId: volume.volumeId }
				);
				if (!isReclaimable(volume.createdAtMs, now, referenced)) continue;
				await ctx.runAction(
					internal.boxes.infra.hetznerVps.deleteParkingVolume,
					{ volumeId: volume.volumeId }
				);
				deletedVolumes += 1;
			}

			const servers = await ctx.runAction(
				internal.boxes.infra.hetznerVps.listProductServers,
				{}
			);
			const orphanedServers: { serverId: number; name?: string }[] = [];
			for (const server of servers) {
				const live = await ctx.runQuery(
					internal.boxes.reconcile.serverHasLiveBox,
					{ serverId: server.serverId }
				);
				if (!isReclaimable(server.createdAtMs, now, live)) continue;
				orphanedServers.push({ serverId: server.serverId, name: server.name });
			}

			if (deletedImages > 0) {
				console.info(
					`[reconcile] deleted ${deletedImages} orphaned snapshot image(s)`
				);
			}
			if (deletedVolumes > 0) {
				console.info(
					`[reconcile] deleted ${deletedVolumes} orphaned parking volume(s)`
				);
			}
			if (orphanedServers.length > 0) {
				console.warn(
					`[reconcile] orphaned Hetzner server(s), not auto-deleted: ${orphanedServers
						.map((server) => server.serverId)
						.join(", ")}`
				);
				await ctx.runMutation(internal.boxes.reconcile.alertOrphanedServers, {
					servers: orphanedServers
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
			await ctx.runMutation(internal.staffAlerts.raise, {
				key: `hetzner-reconciliation-failed:${day}`,
				severity: "critical",
				subject: "Hetzner resource reconciliation failed",
				text: `The daily Hetzner orphan-resource reconciliation failed before it could finish.\n\n${message}\n\nReview the Convex action logs and Hetzner resources.`
			});
			throw error;
		}
	}
});
