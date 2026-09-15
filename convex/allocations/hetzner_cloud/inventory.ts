import { type Infer, v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import {
	internalAction,
	internalMutation,
	type MutationCtx,
} from "../../_generated/server";
import schema from "../../schema";
import {
	getHetznerCloudConfig,
	HetznerCloudError,
	hetznerCloudRateLimiter,
	listHetznerCloudResources,
	requireHetznerCloudController,
} from "./api";
import type { hetznerCloudFindingReason } from "./schema";
import {
	getHetznerCloudAllocation,
	hetznerCloudWorkPool,
} from "./worker_state";

const scanLeaseMs = 120_000;
const pageDelayMs = 10_000;
const cycleDelayMs = 300_000;
const errorDelayMs = 300_000;
const requestsPerScan = 2;

const scannedResource = v.object({
	id: v.number(),
	allocationId: v.string(),
	kind: v.string(),
});

type ScannedResource = Infer<typeof scannedResource>;
type Scan = Doc<"hetznerCloudScans">;

const nextCollections = {
	servers: "primary_ips",
	// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this collection
	primary_ips: "servers",
} as const satisfies Record<Scan["collection"], Scan["collection"]>;

export const sweep = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const config = getHetznerCloudConfig();
		if (config === null) {
			return null;
		}
		let scan = await ctx.db
			.query("hetznerCloudScans")
			.withIndex("by_controller_id", (q) =>
				q.eq("controllerId", config.controllerId),
			)
			.unique();
		if (scan === null) {
			const id = await ctx.db.insert("hetznerCloudScans", {
				controllerId: config.controllerId,
				collection: "servers",
				page: 1,
				dueAt: 0,
				epoch: 0,
			});
			scan = await ctx.db.get("hetznerCloudScans", id);
		}
		if (scan === null || scan.dueAt > Date.now()) {
			return null;
		}
		const rateLimit = await hetznerCloudRateLimiter.limit(
			ctx,
			"hetznerCloudWork",
			{ count: requestsPerScan },
		);
		if (!rateLimit.ok) {
			return null;
		}
		const epoch = scan.epoch + 1;
		await ctx.db.patch("hetznerCloudScans", scan._id, {
			epoch,
			dueAt: Date.now() + scanLeaseMs,
		});
		await hetznerCloudWorkPool.enqueueAction(
			ctx,
			internal.allocations.hetzner_cloud.inventory.run,
			{ scan: { ...scan, epoch }, firewallId: config.firewallId },
			{ retry: false },
		);
		return null;
	},
});

async function checkResource(
	ctx: MutationCtx,
	scan: Scan,
	resource: ScannedResource,
): Promise<Infer<typeof hetznerCloudFindingReason> | null> {
	const allocationId = ctx.db.normalizeId(
		"serverAllocations",
		resource.allocationId,
	);
	const allocation =
		allocationId === null
			? null
			: await ctx.db.get("serverAllocations", allocationId);
	const hetznerCloudAllocation =
		allocationId === null
			? null
			: await getHetznerCloudAllocation(ctx, allocationId);
	if (
		allocation === null ||
		hetznerCloudAllocation === null ||
		hetznerCloudAllocation.controllerId !== scan.controllerId ||
		allocation.status === "deleted"
	) {
		return "unknown_allocation";
	}
	if (
		resource.kind !== "server" &&
		resource.kind !== "ipv4" &&
		resource.kind !== "ipv6"
	) {
		return "unknown_allocation";
	}
	const status = hetznerCloudAllocation.resources[resource.kind];
	if (status.status === "present" && status.id === resource.id) {
		return null;
	}
	if (status.status === "pending" || status.status === "uncertain") {
		// Wake the allocation, so that its worker adopts the resource.
		await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
			dueAt: Math.max(Date.now(), hetznerCloudAllocation.leaseExpiresAt),
		});
		return null;
	}
	return "unexpected_resource";
}

async function recordFinding(
	ctx: MutationCtx,
	scan: Scan,
	resource: ScannedResource,
	reason: Infer<typeof hetznerCloudFindingReason> | null,
) {
	const existing = await ctx.db
		.query("hetznerCloudFindings")
		.withIndex("by_controller_id_and_collection_and_resource_id", (q) =>
			q
				.eq("controllerId", scan.controllerId)
				.eq("collection", scan.collection)
				.eq("resourceId", resource.id),
		)
		.unique();
	if (reason !== null) {
		const finding = {
			controllerId: scan.controllerId,
			collection: scan.collection,
			resourceId: resource.id,
			reason,
			observedAt: Date.now(),
			resolved: false,
		};
		if (existing === null) {
			await ctx.db.insert("hetznerCloudFindings", finding);
		} else {
			await ctx.db.patch("hetznerCloudFindings", existing._id, finding);
		}
	} else if (existing !== null) {
		await ctx.db.patch("hetznerCloudFindings", existing._id, {
			resolved: true,
			observedAt: Date.now(),
		});
	}
}

export const record = internalMutation({
	args: {
		scanId: v.id("hetznerCloudScans"),
		epoch: v.number(),
		resources: v.array(scannedResource),
		nextPage: v.union(v.number(), v.null()),
		error: v.union(v.string(), v.null()),
	},
	returns: v.null(),
	handler: async (ctx, { scanId, epoch, resources, nextPage, error }) => {
		const scan = await ctx.db.get("hetznerCloudScans", scanId);
		if (scan === null || scan.epoch !== epoch) {
			return null;
		}
		if (error !== null) {
			await ctx.db.patch("hetznerCloudScans", scan._id, {
				error,
				dueAt: Date.now() + errorDelayMs,
			});
			return null;
		}
		for (const resource of resources) {
			await recordFinding(
				ctx,
				scan,
				resource,
				await checkResource(ctx, scan, resource),
			);
		}
		const isCycleFinished =
			nextPage === null && scan.collection === "primary_ips";
		await ctx.db.patch("hetznerCloudScans", scan._id, {
			page: nextPage ?? 1,
			collection:
				nextPage === null ? nextCollections[scan.collection] : scan.collection,
			dueAt: Date.now() + (isCycleFinished ? cycleDelayMs : pageDelayMs),
			error: undefined,
		});
		return null;
	},
});

export const run = internalAction({
	args: { scan: schema.doc("hetznerCloudScans"), firewallId: v.number() },
	returns: v.null(),
	handler: async (ctx, { scan, firewallId }) => {
		let resources: ScannedResource[] = [];
		let nextPage: number | null = null;
		let error: string | null = null;
		try {
			await requireHetznerCloudController(firewallId, scan.controllerId);
			const listed = await listHetznerCloudResources(
				scan.controllerId,
				scan.collection,
				scan.page,
			);
			resources = listed.resources;
			nextPage = listed.nextPage;
		} catch (scanError) {
			error =
				scanError instanceof HetznerCloudError
					? scanError.code
					: "inventory_failed";
		}
		await ctx.runMutation(internal.allocations.hetzner_cloud.inventory.record, {
			scanId: scan._id,
			epoch: scan.epoch,
			resources,
			nextPage,
			error,
		});
		return null;
	},
});
