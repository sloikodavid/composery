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
	createHetznerCloudUsage,
	getHetznerCloudConfig,
	HetznerCloudError,
	listHetznerCloudResources,
	requireHetznerCloudFirewall,
} from "./api";
import { hetznerCloudServerState } from "./observation";
import { chargeHetznerCloudPacing, checkHetznerCloudPacing } from "./pacing";
import { type hetznerCloudFindingReason, hetznerCloudUsage } from "./schema";
import {
	getHetznerCloudAllocation,
	hetznerCloudWorkPool,
	storeHetznerCloudObservation,
} from "./worker_state";

const scanLeaseMs = 120_000;
// One page per interval keeps scan cost bounded while allocations stay current.
const pageDelayMs = 10_000;
const errorDelayMs = 300_000;

const scannedResource = v.object({
	id: v.number(),
	allocationId: v.string(),
	kind: v.string(),
	// A scan observes active work; it must not replace the worker's operation state.
	server: v.optional(hetznerCloudServerState),
});

type ScannedResource = Infer<typeof scannedResource>;
type Scan = Doc<"hetznerCloudScans">;
type HetznerCloudAllocation = Doc<"hetznerCloudAllocations">;

const nextCollections = {
	servers: "primary_ips",
	// biome-ignore lint/style/useNamingConvention: external collection name
	primary_ips: "servers",
} as const satisfies Record<Scan["collection"], Scan["collection"]>;

async function scheduleHetznerCloudScan(ctx: MutationCtx, dueAt: number) {
	await ctx.scheduler.runAt(
		dueAt,
		internal.allocations.hetzner_cloud.inventory.sweep,
		{},
	);
}

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
		const retryAt = await checkHetznerCloudPacing(
			ctx,
			scan.controllerId,
			"work",
		);
		if (retryAt !== null) {
			await ctx.db.patch("hetznerCloudScans", scan._id, { dueAt: retryAt });
			await scheduleHetznerCloudScan(ctx, retryAt);
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
			{ scan: { ...scan, epoch } },
			{ retry: false },
		);
		return null;
	},
});

async function getScannedAllocation(
	ctx: MutationCtx,
	resource: ScannedResource,
) {
	const allocationId = ctx.db.normalizeId(
		"serverAllocations",
		resource.allocationId,
	);
	return allocationId === null
		? null
		: await getHetznerCloudAllocation(ctx, allocationId);
}

async function checkResource(
	ctx: MutationCtx,
	scan: Scan,
	resource: ScannedResource,
	hetznerCloudAllocation: HetznerCloudAllocation | null,
): Promise<Infer<typeof hetznerCloudFindingReason> | null> {
	const allocation =
		hetznerCloudAllocation === null
			? null
			: await ctx.db.get(
					"serverAllocations",
					hetznerCloudAllocation.allocationId,
				);
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
		await ctx.db.patch("hetznerCloudAllocations", hetznerCloudAllocation._id, {
			dueAt: Math.max(Date.now(), hetznerCloudAllocation.leaseExpiresAt),
		});
		return null;
	}
	return "unexpected_resource";
}

async function recordScannedServer(
	ctx: MutationCtx,
	scan: Scan,
	resource: ScannedResource,
	hetznerCloudAllocation: HetznerCloudAllocation | null,
) {
	const recorded = hetznerCloudAllocation?.resources.server;
	if (
		resource.server === undefined ||
		hetznerCloudAllocation === null ||
		hetznerCloudAllocation.controllerId !== scan.controllerId ||
		recorded?.status !== "present" ||
		recorded.id !== resource.server.id
	) {
		return;
	}
	await storeHetznerCloudObservation(
		ctx,
		hetznerCloudAllocation,
		resource.server,
	);
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
		usage: hetznerCloudUsage,
	},
	returns: v.null(),
	handler: async (
		ctx,
		{ scanId, epoch, resources, nextPage, error, usage },
	) => {
		const scan = await ctx.db.get("hetznerCloudScans", scanId);
		if (scan === null) {
			return null;
		}
		const resumeAt = await chargeHetznerCloudPacing(
			ctx,
			scan.controllerId,
			"work",
			usage,
		);
		if (scan.epoch !== epoch) {
			return null;
		}
		if (error !== null) {
			const dueAt = Math.max(Date.now() + errorDelayMs, resumeAt);
			await ctx.db.patch("hetznerCloudScans", scan._id, { error, dueAt });
			await scheduleHetznerCloudScan(ctx, dueAt);
			return null;
		}
		for (const resource of resources) {
			const hetznerCloudAllocation = await getScannedAllocation(ctx, resource);
			await recordFinding(
				ctx,
				scan,
				resource,
				await checkResource(ctx, scan, resource, hetznerCloudAllocation),
			);
			await recordScannedServer(ctx, scan, resource, hetznerCloudAllocation);
		}
		const dueAt = Math.max(Date.now() + pageDelayMs, resumeAt);
		await ctx.db.patch("hetznerCloudScans", scan._id, {
			page: nextPage ?? 1,
			collection:
				nextPage === null ? nextCollections[scan.collection] : scan.collection,
			dueAt,
			error: undefined,
		});
		await scheduleHetznerCloudScan(ctx, dueAt);
		return null;
	},
});

export const run = internalAction({
	args: { scan: schema.doc("hetznerCloudScans") },
	returns: v.null(),
	handler: async (ctx, { scan }) => {
		let resources: ScannedResource[] = [];
		let nextPage: number | null = null;
		let error: string | null = null;
		const usage = createHetznerCloudUsage();
		try {
			await requireHetznerCloudFirewall(usage, scan.controllerId);
			const listed = await listHetznerCloudResources(
				usage,
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
			usage,
		});
		return null;
	},
});
