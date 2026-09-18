"use node";

import { type Infer, v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { type ActionCtx, internalAction } from "../../_generated/server";
import {
	canReuseAllocationSshAccess,
	generateAllocationSshAccess,
	requireSshBootstrapFile,
} from "../../ssh/bootstrap";
import { renderCloudInit } from "../../ssh/cloud_init";
import { SshAccessError } from "../../ssh/errors";
import type { FailureClass } from "../retries";
import type { powerOperationKind } from "../schema";
import {
	createHetznerCloudResource,
	findHetznerCloudResource,
	findHetznerCloudServer,
	getHetznerCloudActionStatus,
	type HetznerCloudCreateRequest,
	HetznerCloudError,
	type HetznerCloudOwner,
	type HetznerCloudResource,
	type HetznerCloudServer,
	requireHetznerCloudController,
	resolveHetznerCloudSpec,
	sendHetznerCloudDelete,
	sendHetznerCloudPower,
} from "./api";
import type { hetznerCloudResourceKind } from "./schema";
import {
	type HetznerCloudWorkerUpdate,
	hetznerCloudPowerDeadlineMs,
} from "./worker_state";

type ResourceKind = Infer<typeof hetznerCloudResourceKind>;
type PowerKind = Infer<typeof powerOperationKind>;
type ObservedStatus = "running" | "stopped";
type HetznerCloudAllocation = Doc<"hetznerCloudAllocations">;
type Lease = {
	allocation: Doc<"serverAllocations">;
	hetznerCloudAllocation: HetznerCloudAllocation;
	operation: Doc<"serverOperations">;
};

const actionTimeoutMs = 600_000;
const createOrder = ["ipv4", "ipv6", "server"] as const;
const deleteOrder = ["server", "ipv6", "ipv4"] as const;

const powerTargets = {
	start: "running",
	stop: "stopped",
	forceStop: "stopped",
} as const satisfies Record<PowerKind, ObservedStatus>;

function toFailure(
	error: string,
	kind: FailureClass,
	details: { missing?: true; final?: true } = {},
): HetznerCloudWorkerUpdate {
	return { failure: { error, class: kind, ...details } };
}

function toProviderFailure(error: HetznerCloudError) {
	return {
		error: error.code,
		class: error.failureClass,
		retryAfterMs: error.retryAfterMs,
		...(error.hetznerErrorCode === undefined
			? {}
			: { hetznerErrorCode: error.hetznerErrorCode }),
	};
}

function toOwner(
	hetznerCloudAllocation: HetznerCloudAllocation,
): HetznerCloudOwner {
	return {
		controllerId: hetznerCloudAllocation.controllerId,
		allocationId: hetznerCloudAllocation.allocationId,
	};
}

/** A recorded ID finds the resource directly. Without one, it is found by its labels and name. */
function getKnownId(
	resource: HetznerCloudAllocation["resources"][ResourceKind],
) {
	switch (resource.status) {
		case "present":
		case "absent":
			return resource.id;
		case "pending":
		case "uncertain":
			return undefined;
	}
}

function toPresentResource(kind: ResourceKind, resource: HetznerCloudResource) {
	return {
		kind,
		status: { status: "present" as const, id: resource.id },
		...(resource.address === undefined ? {} : { address: resource.address }),
	};
}

async function renderUserData(ctx: ActionCtx, lease: Lease) {
	const { allocationId, epoch } = lease.hetznerCloudAllocation;
	let sshAccess: Doc<"allocationSshAccess"> | null = await ctx.runQuery(
		internal.ssh.access_state.get,
		{ allocationId },
	);
	if (!canReuseAllocationSshAccess(sshAccess)) {
		sshAccess = await ctx.runMutation(
			internal.allocations.hetzner_cloud.worker_state.storeSshAccess,
			{ epoch, sshAccess: await generateAllocationSshAccess(allocationId) },
		);
	}
	if (sshAccess === null) {
		return null;
	}
	return renderCloudInit({
		publicKey: sshAccess.publicKey,
		bootstrapFile: requireSshBootstrapFile(sshAccess),
		// The create operation carries the name the server had when it was requested.
		hostname: lease.operation.name ?? "",
	});
}

/** Returns an update instead when the request cannot be built yet. */
async function toCreateRequest(
	ctx: ActionCtx,
	lease: Lease,
	kind: ResourceKind,
): Promise<
	{ request: HetznerCloudCreateRequest } | { update: HetznerCloudWorkerUpdate }
> {
	const { firewallId, resources, spec } = lease.hetznerCloudAllocation;
	if (spec === undefined) {
		return { update: toFailure("spec_missing", "transient") };
	}
	switch (kind) {
		case "ipv4":
		case "ipv6":
			return { request: { kind, location: spec.location } };
		case "server": {
			if (
				resources.ipv4.status !== "present" ||
				resources.ipv6.status !== "present"
			) {
				return { update: toFailure("addresses_missing", "transient") };
			}
			const userData = await renderUserData(ctx, lease);
			if (userData === null) {
				return { update: {} };
			}
			return {
				request: {
					kind,
					location: spec.location,
					serverType: spec.serverType,
					imageId: spec.imageId,
					ipv4Id: resources.ipv4.id,
					ipv6Id: resources.ipv6.id,
					firewallId,
					userData,
				},
			};
		}
	}
}

async function createResource(
	ctx: ActionCtx,
	lease: Lease,
	kind: ResourceKind,
): Promise<HetznerCloudWorkerUpdate> {
	const { allocation, hetznerCloudAllocation } = lease;
	const owner = toOwner(hetznerCloudAllocation);
	const resource = hetznerCloudAllocation.resources[kind];
	const found = await findHetznerCloudResource(
		owner,
		kind,
		getKnownId(resource),
	);
	if (found !== null) {
		return { resource: toPresentResource(kind, found) };
	}
	if (resource.status === "uncertain") {
		return toFailure("create_outcome_unknown", "indeterminate");
	}
	if (resource.status !== "pending") {
		return toFailure("resource_missing", "waiting", { missing: true });
	}
	const prepared = await toCreateRequest(ctx, lease, kind);
	if ("update" in prepared) {
		return prepared.update;
	}
	const canCreate: boolean = await ctx.runMutation(
		internal.allocations.hetzner_cloud.worker_state.markUncertain,
		{
			allocationId: allocation._id,
			epoch: hetznerCloudAllocation.epoch,
			kind,
		},
	);
	if (!canCreate) {
		return {};
	}
	try {
		const created = await createHetznerCloudResource(owner, prepared.request);
		return {
			resource: toPresentResource(kind, created),
			...(created.actionId === null ? {} : { actionId: created.actionId }),
		};
	} catch (error) {
		// A rejection returns the resource to pending. Any other outcome stays uncertain.
		if (error instanceof HetznerCloudError && error.isRejected) {
			return {
				resource: { kind, status: { status: "pending" } },
				failure: toProviderFailure(error),
			};
		}
		throw error;
	}
}

async function deleteResource(
	lease: Lease,
	kind: ResourceKind,
): Promise<HetznerCloudWorkerUpdate> {
	const { hetznerCloudAllocation } = lease;
	const resource = hetznerCloudAllocation.resources[kind];
	if (resource.status === "pending") {
		return { resource: { kind, status: { status: "absent" } } };
	}
	const found = await findHetznerCloudResource(
		toOwner(hetznerCloudAllocation),
		kind,
		getKnownId(resource),
	);
	if (found === null && resource.status === "uncertain") {
		return toFailure("create_outcome_unknown", "indeterminate");
	}
	if (found === null) {
		const knownId = "id" in resource ? resource.id : undefined;
		return {
			resource: {
				kind,
				status: {
					status: "absent",
					...(knownId === undefined ? {} : { id: knownId }),
				},
			},
			clearAction: true,
		};
	}
	if (resource.status === "uncertain") {
		// An uncertain resource that appears takes its identity first, which unblocks the allocation.
		return { resource: { kind, status: { status: "present", id: found.id } } };
	}
	if (found.isAssigned) {
		return toFailure("address_assigned_to_another_resource", "waiting");
	}
	const sent = await sendHetznerCloudDelete(kind, found.id);
	switch (sent.status) {
		case "absent":
			return { resource: { kind, status: { status: "absent", id: found.id } } };
		case "deleting":
			return {
				resource: { kind, status: { status: "present", id: found.id } },
				...(sent.actionId === null ? {} : { actionId: sent.actionId }),
			};
	}
}

async function stepAction(
	action: NonNullable<HetznerCloudAllocation["action"]>,
): Promise<HetznerCloudWorkerUpdate> {
	const status = await getHetznerCloudActionStatus(action.id);
	switch (status) {
		case null:
		case "succeeded":
			return { clearAction: true };
		case "running":
			return Date.now() - action.startedAt > actionTimeoutMs
				? toFailure("action_stalled", "waiting")
				: {};
		case "failed":
			return {
				clearAction: true,
				failure: { error: "action_failed", class: "transient" },
			};
	}
}

async function stepPower(
	ctx: ActionCtx,
	lease: Lease,
	serverId: number,
	status: ObservedStatus,
): Promise<HetznerCloudWorkerUpdate | null> {
	const { allocation, hetznerCloudAllocation, operation } = lease;
	if (
		operation.status === "succeeded" ||
		operation.kind === "create" ||
		operation.kind === "delete" ||
		status === powerTargets[operation.kind]
	) {
		return null;
	}
	if (
		Date.now() >
		(operation.deadlineAt ??
			operation._creationTime + hetznerCloudPowerDeadlineMs)
	) {
		return toFailure("power_change_timed_out", "invalid", { final: true });
	}
	const canSend: boolean = await ctx.runQuery(
		internal.allocations.hetzner_cloud.worker_state.canSendPower,
		{
			allocationId: allocation._id,
			epoch: hetznerCloudAllocation.epoch,
			operationId: operation._id,
		},
	);
	if (!canSend) {
		return {};
	}
	const actionId = await sendHetznerCloudPower(serverId, operation.kind);
	return actionId === null ? {} : { actionId };
}

/**
 * Whether the server Hetzner describes is the one this allocation records, and its addresses when
 * it is. A server that differs is never adopted as it. An address Hetzner no longer reports is a
 * mismatch like any other: somebody deleted a Primary IP, which Hetzner allows while the server is
 * off, and the allocation is not what we wrote down any more.
 */
function checkServer(
	hetznerCloudAllocation: HetznerCloudAllocation,
	server: HetznerCloudServer,
):
	| { failure: HetznerCloudWorkerUpdate }
	| { addresses: { ipv4: string; ipv6: string } } {
	const { resources, spec, firewallId } = hetznerCloudAllocation;
	const { ipv4, ipv6 } = server;
	if (
		ipv4 === null ||
		ipv6 === null ||
		ipv4.id !== (resources.ipv4.status === "present" ? resources.ipv4.id : 0) ||
		ipv6.id !== (resources.ipv6.status === "present" ? resources.ipv6.id : 0)
	) {
		return {
			failure: toFailure("address_identity_mismatch", "waiting"),
		};
	}
	if (
		server.serverType !== spec?.serverType ||
		server.location !== spec?.location
	) {
		return {
			failure: toFailure("server_configuration_mismatch", "waiting"),
		};
	}
	const firewall = server.firewalls.find(
		(attached) => attached.id === firewallId,
	);
	if (firewall === undefined) {
		return { failure: toFailure("firewall_detached", "waiting") };
	}
	if (!firewall.isApplied) {
		return { failure: toFailure("firewall_not_applied", "transient") };
	}
	return { addresses: { ipv4: ipv4.address, ipv6: ipv6.address } };
}

async function observeServer(
	ctx: ActionCtx,
	lease: Lease,
): Promise<HetznerCloudWorkerUpdate> {
	const { hetznerCloudAllocation } = lease;
	const server = await findHetznerCloudServer(
		toOwner(hetznerCloudAllocation),
		getKnownId(hetznerCloudAllocation.resources.server),
	);
	if (server === null) {
		return toFailure("server_missing", "waiting", { missing: true });
	}
	if (server.status === "changing") {
		return toFailure("server_status_changing", "transient");
	}
	const checked = checkServer(hetznerCloudAllocation, server);
	if ("failure" in checked) {
		return checked.failure;
	}
	const powerUpdate = await stepPower(ctx, lease, server.id, server.status);
	return (
		powerUpdate ?? {
			observation: { status: server.status, ...checked.addresses },
		}
	);
}

async function step(
	ctx: ActionCtx,
	lease: Lease,
): Promise<HetznerCloudWorkerUpdate> {
	const { allocation, hetznerCloudAllocation } = lease;
	await requireHetznerCloudController(
		hetznerCloudAllocation.firewallId,
		hetznerCloudAllocation.controllerId,
	);
	if (hetznerCloudAllocation.action !== undefined) {
		return await stepAction(hetznerCloudAllocation.action);
	}
	if (allocation.deleteRequested) {
		for (const kind of deleteOrder) {
			if (hetznerCloudAllocation.resources[kind].status !== "absent") {
				return await deleteResource(lease, kind);
			}
		}
		return { deleted: true };
	}
	if (hetznerCloudAllocation.spec === undefined) {
		return {
			spec: await resolveHetznerCloudSpec(
				hetznerCloudAllocation.locations,
				hetznerCloudAllocation.image,
			),
		};
	}
	for (const kind of createOrder) {
		if (hetznerCloudAllocation.resources[kind].status !== "present") {
			return await createResource(ctx, lease, kind);
		}
	}
	return await observeServer(ctx, lease);
}

function toErrorUpdate(error: unknown): HetznerCloudWorkerUpdate {
	if (error instanceof HetznerCloudError) {
		return { failure: toProviderFailure(error) };
	}
	if (error instanceof SshAccessError) {
		return toFailure(error.code, "waiting");
	}
	return toFailure("worker_failed", "bug");
}

export const run = internalAction({
	args: { allocationId: v.id("serverAllocations"), epoch: v.number() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const lease: Lease | null = await ctx.runMutation(
			internal.allocations.hetzner_cloud.worker_state.lease,
			args,
		);
		if (lease === null) {
			return null;
		}
		let update: HetznerCloudWorkerUpdate;
		try {
			update = await step(ctx, lease);
		} catch (error) {
			update = toErrorUpdate(error);
		}
		await ctx.runMutation(
			internal.allocations.hetzner_cloud.worker_state.record,
			{
				allocationId: args.allocationId,
				epoch: lease.hetznerCloudAllocation.epoch,
				operationId: lease.operation._id,
				update,
			},
		);
		return null;
	},
});
