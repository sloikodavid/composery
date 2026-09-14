import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	env,
	internalMutation,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import { type Failure, fail } from "../failures";
import {
	deleteAllocationSshAccess,
	requireSshCredentialKeyFormat,
} from "../ssh/bootstrap_state";
import { releaseServerGrant } from "./grants";
import {
	getHetznerCloudConfig,
	type HetznerCloudConfig,
} from "./hetzner_cloud/api";
import {
	checkHetznerCloudPower,
	createHetznerCloudAllocation,
	hetznerCloudPowerDeadlineMs,
	wakeHetznerCloudAllocation,
} from "./hetzner_cloud/worker_state";
import type { allocationBackend, powerOperationKind } from "./schema";

const requestIdPattern = /^[a-zA-Z0-9_-]{8,100}$/;

type AllocationBackend = Infer<typeof allocationBackend>;

export type AllocationConfig = {
	backend: "hetznerCloud";
	hetznerCloud: HetznerCloudConfig;
};

export function requireRequestId(requestId: string) {
	if (!requestIdPattern.test(requestId)) {
		throw new ConvexError({
			message:
				"Use a request ID with 8 to 100 letters, numbers, hyphens, or underscores.",
		});
	}
}

export async function getServerAllocation(
	ctx: QueryCtx,
	serverId: Id<"servers">,
) {
	return await ctx.db
		.query("serverAllocations")
		.withIndex("by_server_id", (q) => q.eq("serverId", serverId))
		.unique();
}

export async function getOperationByRequest(
	ctx: QueryCtx,
	requesterId: Id<"users">,
	requestId: string,
) {
	return await ctx.db
		.query("serverOperations")
		.withIndex("by_requester_id_and_request_id", (q) =>
			q.eq("requesterId", requesterId).eq("requestId", requestId),
		)
		.unique();
}

/**
 * Resolves the configuration for a new allocation. Returns null when creation
 * is not configured, and throws when the configuration is invalid.
 * An existing allocation keeps the configuration that it was created with.
 */
export function getAllocationConfig(): AllocationConfig | null {
	if (!env.SSH_CREDENTIAL_KEY) {
		return null;
	}
	requireSshCredentialKeyFormat(env.SSH_CREDENTIAL_KEY);
	const hetznerCloud = getHetznerCloudConfig();
	return hetznerCloud === null
		? null
		: { backend: "hetznerCloud", hetznerCloud };
}

function getPowerDeadlineMs(backend: AllocationBackend) {
	switch (backend) {
		case "hetznerCloud":
			return hetznerCloudPowerDeadlineMs;
	}
}

export async function requestAllocationCreate(
	ctx: MutationCtx,
	request: {
		serverId: Id<"servers">;
		requesterId: Id<"users">;
		requestId: string;
		name: string;
		grantId: Id<"serverGrants">;
		config: AllocationConfig;
	},
) {
	const operationId = await ctx.db.insert("serverOperations", {
		serverId: request.serverId,
		requesterId: request.requesterId,
		requestId: request.requestId,
		name: request.name,
		kind: "create",
		status: "pending",
	});
	const allocationId = await ctx.db.insert("serverAllocations", {
		serverId: request.serverId,
		grantId: request.grantId,
		operationId,
		backend: request.config.backend,
		status: "creating",
		deleteRequested: false,
	});
	switch (request.config.backend) {
		case "hetznerCloud":
			await createHetznerCloudAllocation(
				ctx,
				allocationId,
				request.config.hetznerCloud,
			);
			return;
	}
}

export async function requestAllocationPower(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
	request: {
		requesterId: Id<"users">;
		requestId: string;
		kind: Infer<typeof powerOperationKind>;
	},
): Promise<Failure | { ok: true; operationId: Id<"serverOperations"> }> {
	if (allocation.deleteRequested) {
		return fail(null, "This server cannot accept a power operation.");
	}
	const current = await ctx.db.get("serverOperations", allocation.operationId);
	if (current?.status === "pending") {
		return fail(null, "Wait for the current operation to finish.");
	}
	const backendFailure = await checkBackendPower(ctx, allocation);
	if (backendFailure !== null) {
		return backendFailure;
	}
	const operationId = await ctx.db.insert("serverOperations", {
		serverId: allocation.serverId,
		requesterId: request.requesterId,
		requestId: request.requestId,
		kind: request.kind,
		status: "pending",
		deadlineAt: Date.now() + getPowerDeadlineMs(allocation.backend),
	});
	await ctx.db.patch("serverAllocations", allocation._id, {
		operationId,
		error: undefined,
	});
	await wakeBackend(ctx, allocation);
	return { ok: true, operationId };
}

async function checkBackendPower(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
) {
	switch (allocation.backend) {
		case "hetznerCloud":
			return await checkHetznerCloudPower(ctx, allocation._id);
	}
}

async function wakeBackend(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
) {
	switch (allocation.backend) {
		case "hetznerCloud":
			await wakeHetznerCloudAllocation(ctx, allocation._id);
			return;
	}
}

/** Records the delete intent. The backend deletes the infrastructure and then calls `finishDelete`. */
export async function requestAllocationDelete(
	ctx: MutationCtx,
	allocation: Doc<"serverAllocations">,
	requesterId?: Id<"users">,
) {
	if (allocation.deleteRequested) {
		return;
	}
	const current = await ctx.db.get("serverOperations", allocation.operationId);
	if (current !== null && current.status !== "succeeded") {
		await ctx.db.patch("serverOperations", current._id, {
			status: "superseded",
			finishedAt: Date.now(),
		});
	}
	const operationId = await ctx.db.insert("serverOperations", {
		serverId: allocation.serverId,
		...(requesterId === undefined ? {} : { requesterId }),
		requestId: `delete_${allocation._id}`,
		kind: "delete",
		status: "pending",
	});
	await ctx.db.patch("serverAllocations", allocation._id, {
		operationId,
		deleteRequested: true,
		status: "deleting",
		error: undefined,
	});
	await wakeBackend(ctx, { ...allocation, deleteRequested: true });
}

// A backend schedules this once, after it confirms that the infrastructure is absent.
export const finishDelete = internalMutation({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.null(),
	handler: async (ctx, { allocationId }) => {
		const allocation = await ctx.db.get("serverAllocations", allocationId);
		if (allocation === null || allocation.status !== "deleted") {
			throw new Error("An allocation must be deleted before it is finished.");
		}
		await releaseServerGrant(ctx, allocation.grantId);
		await deleteAllocationSshAccess(ctx, allocationId);
		await ctx.scheduler.runAfter(0, internal.servers.lifecycle.finishDelete, {
			serverId: allocation.serverId,
		});
		return null;
	},
});
