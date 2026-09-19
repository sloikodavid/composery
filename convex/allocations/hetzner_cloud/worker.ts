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
	applyHetznerCloudFirewall,
	createHetznerCloudResource,
	createHetznerCloudUsage,
	findHetznerCloudResource,
	findHetznerCloudServer,
	getHetznerCloudActionStatus,
	type HetznerCloudCreateRequest,
	HetznerCloudError,
	type HetznerCloudOwner,
	type HetznerCloudResource,
	requireHetznerCloudController,
	requireHetznerCloudFirewall,
	resolveHetznerCloudSpec,
	sendHetznerCloudDelete,
	sendHetznerCloudPower,
} from "./api";
import {
	observeHetznerCloudServer,
	type ServerObservation,
} from "./observation";
import type { HetznerCloudUsage } from "./pacing";
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
	usage: HetznerCloudUsage;
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

function getKnownId(
	resource: HetznerCloudAllocation["resources"][ResourceKind],
) {
	// Pending and uncertain resources must be found by ownership, not retried by ID.
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
		hostname: lease.operation.name ?? "",
	});
}

async function toCreateRequest(
	ctx: ActionCtx,
	lease: Lease,
	kind: ResourceKind,
): Promise<
	{ request: HetznerCloudCreateRequest } | { update: HetznerCloudWorkerUpdate }
> {
	const { firewallId, resources, spec } = lease.hetznerCloudAllocation;
	if (spec === undefined || firewallId === undefined) {
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
		lease.usage,
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
		const created = await createHetznerCloudResource(
			lease.usage,
			owner,
			prepared.request,
		);
		return {
			resource: toPresentResource(kind, created),
			...(created.actionId === null ? {} : { actionId: created.actionId }),
		};
	} catch (error) {
		if (error instanceof HetznerCloudError && error.isRejected) {
			// Rejections are known not to have created the resource; other outcomes remain uncertain.
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
		lease.usage,
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
		// A resource found after an uncertain create belongs to that request.
		return { resource: { kind, status: { status: "present", id: found.id } } };
	}
	if (found.isAssigned) {
		return toFailure("address_assigned_to_another_resource", "waiting");
	}
	const sent = await sendHetznerCloudDelete(lease.usage, kind, found.id);
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
	lease: Lease,
	action: NonNullable<HetznerCloudAllocation["action"]>,
): Promise<HetznerCloudWorkerUpdate> {
	const status = await getHetznerCloudActionStatus(lease.usage, action.id);
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
	const actionId = await sendHetznerCloudPower(
		lease.usage,
		serverId,
		operation.kind,
	);
	return actionId === null ? {} : { actionId };
}

async function observeServer(
	ctx: ActionCtx,
	lease: Lease,
): Promise<HetznerCloudWorkerUpdate> {
	// A missing or mismatched server is a failure to observe, not proof of deletion.
	const { hetznerCloudAllocation } = lease;
	const server = await findHetznerCloudServer(
		lease.usage,
		toOwner(hetznerCloudAllocation),
		getKnownId(hetznerCloudAllocation.resources.server),
	);
	if (server === null) {
		return toFailure("server_missing", "waiting", { missing: true });
	}
	if (server.status === "changing") {
		return toFailure("server_status_changing", "transient");
	}
	const checked = observeHetznerCloudServer(hetznerCloudAllocation, server);
	if (checked === null) {
		return toFailure("server_configuration_mismatch", "waiting");
	}
	const powerUpdate = await stepPower(ctx, lease, server.id, server.status);
	if (powerUpdate !== null) {
		return powerUpdate;
	}
	return (
		(await stepFirewall(lease, checked, server.id)) ?? { observation: server }
	);
}

async function stepFirewall(
	lease: Lease,
	checked: ServerObservation,
	serverId: number,
): Promise<HetznerCloudWorkerUpdate | null> {
	// The controller owns the firewall; a detached firewall is repaired on the next pass.
	const { firewallId } = lease.hetznerCloudAllocation;
	if (
		checked.parts.firewall !== "missing" ||
		firewallId === undefined ||
		lease.allocation.deleteRequested
	) {
		return null;
	}
	const actionId = await applyHetznerCloudFirewall(
		lease.usage,
		firewallId,
		serverId,
	);
	return actionId === null ? {} : { actionId };
}

async function step(
	ctx: ActionCtx,
	lease: Lease,
): Promise<HetznerCloudWorkerUpdate> {
	const { allocation, hetznerCloudAllocation } = lease;
	const { controllerId, firewallId } = hetznerCloudAllocation;
	if (firewallId === undefined) {
		// Do not create provider resources until the project firewall proves ownership.
		return {
			firewallId: (await requireHetznerCloudFirewall(lease.usage, controllerId))
				.id,
		};
	}
	await requireHetznerCloudController(lease.usage, firewallId, controllerId);
	if (hetznerCloudAllocation.action !== undefined) {
		return await stepAction(lease, hetznerCloudAllocation.action);
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
				lease.usage,
				hetznerCloudAllocation.locations,
				hetznerCloudAllocation.image,
				hetznerCloudAllocation.serverType,
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
		const leased = await ctx.runMutation(
			internal.allocations.hetzner_cloud.worker_state.lease,
			args,
		);
		if (leased === null) {
			return null;
		}
		const lease: Lease = { ...leased, usage: createHetznerCloudUsage() };
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
				queue: lease.hetznerCloudAllocation.queue,
				update,
				usage: lease.usage,
			},
		);
		return null;
	},
});
