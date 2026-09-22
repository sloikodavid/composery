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
import { isAllocationDeleting } from "../schema";
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
import type { HetznerCloudOutcome } from "./outcomes";
import type { HetznerCloudUsage } from "./pacing";
import type { hetznerCloudResourceKind } from "./schema";
import { hetznerCloudPowerDeadlineMs } from "./worker_state";

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
	failureClass: FailureClass,
	kind: "failed" | "serverMissing" | "deadlinePassed" = "failed",
): HetznerCloudOutcome {
	return { kind, failure: { error, class: failureClass } };
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

function toPresentResource(
	kind: ResourceKind,
	resource: HetznerCloudResource,
	actionId: number | null = null,
): HetznerCloudOutcome {
	return {
		kind: "resourceFound",
		resource: kind,
		id: resource.id,
		actionId,
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
	{ request: HetznerCloudCreateRequest } | { outcome: HetznerCloudOutcome }
> {
	const { firewallId, resources, spec } = lease.hetznerCloudAllocation;
	if (spec === undefined || firewallId === undefined) {
		return { outcome: toFailure("spec_missing", "transient") };
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
				return { outcome: toFailure("addresses_missing", "transient") };
			}
			const userData = await renderUserData(ctx, lease);
			if (userData === null) {
				return { outcome: { kind: "waiting" } };
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
): Promise<HetznerCloudOutcome> {
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
		return toPresentResource(kind, found);
	}
	if (resource.status === "uncertain") {
		return toFailure("create_outcome_unknown", "indeterminate");
	}
	if (resource.status !== "pending") {
		return toFailure(
			"resource_missing",
			"waiting",
			kind === "server" ? "serverMissing" : "failed",
		);
	}
	const prepared = await toCreateRequest(ctx, lease, kind);
	if ("outcome" in prepared) {
		return prepared.outcome;
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
		return { kind: "waiting" };
	}
	try {
		const created = await createHetznerCloudResource(
			lease.usage,
			owner,
			prepared.request,
		);
		return toPresentResource(kind, created, created.actionId);
	} catch (error) {
		if (error instanceof HetznerCloudError && error.isRejected) {
			// Rejections are known not to have created the resource; other outcomes remain uncertain.
			return {
				kind: "createRejected",
				resource: kind,
				failure: toProviderFailure(error),
			};
		}
		throw error;
	}
}

async function deleteResource(
	lease: Lease,
	kind: ResourceKind,
): Promise<HetznerCloudOutcome> {
	const { hetznerCloudAllocation } = lease;
	const resource = hetznerCloudAllocation.resources[kind];
	if (resource.status === "pending") {
		return { kind: "resourceAbsent", resource: kind };
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
			kind: "resourceAbsent",
			resource: kind,
			...(knownId === undefined ? {} : { id: knownId }),
		};
	}
	if (resource.status === "uncertain") {
		// A resource found after an uncertain create belongs to that request.
		return toPresentResource(kind, found);
	}
	if (found.isAssigned) {
		return toFailure("address_assigned_to_another_resource", "waiting");
	}
	const sent = await sendHetznerCloudDelete(lease.usage, kind, found.id);
	switch (sent.status) {
		case "absent":
			return { kind: "resourceAbsent", resource: kind, id: found.id };
		case "deleting":
			return toPresentResource(kind, found, sent.actionId);
	}
}

async function stepAction(
	lease: Lease,
	action: NonNullable<HetznerCloudAllocation["action"]>,
): Promise<HetznerCloudOutcome> {
	const status = await getHetznerCloudActionStatus(lease.usage, action.id);
	switch (status) {
		case null:
		case "succeeded":
			return { kind: "actionFinished" };
		case "running":
			return Date.now() - action.startedAt > actionTimeoutMs
				? toFailure("action_stalled", "waiting")
				: { kind: "waiting" };
		case "failed":
			return {
				kind: "actionFailed",
				failure: { error: "action_failed", class: "transient" },
			};
	}
}

async function stepPower(
	ctx: ActionCtx,
	lease: Lease,
	serverId: number,
	status: ObservedStatus,
): Promise<HetznerCloudOutcome | null> {
	const { allocation, hetznerCloudAllocation, operation } = lease;
	if (
		operation.status !== "pending" ||
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
		return toFailure("power_change_timed_out", "invalid", "deadlinePassed");
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
		return { kind: "waiting" };
	}
	const actionId = await sendHetznerCloudPower(
		lease.usage,
		serverId,
		operation.kind,
	);
	return actionId === null
		? { kind: "waiting" }
		: { kind: "actionStarted", id: actionId };
}

async function observeServer(
	ctx: ActionCtx,
	lease: Lease,
): Promise<HetznerCloudOutcome> {
	// A missing or mismatched server is a failure to observe, not proof of deletion.
	const { hetznerCloudAllocation } = lease;
	const server = await findHetznerCloudServer(
		lease.usage,
		toOwner(hetznerCloudAllocation),
		getKnownId(hetznerCloudAllocation.resources.server),
	);
	if (server === null) {
		return toFailure("server_missing", "waiting", "serverMissing");
	}
	if (server.status === "changing") {
		return toFailure("server_status_changing", "transient");
	}
	const checked = observeHetznerCloudServer(hetznerCloudAllocation, server);
	if (checked === null) {
		return toFailure("server_configuration_mismatch", "waiting");
	}
	const powerOutcome = await stepPower(ctx, lease, server.id, server.status);
	if (powerOutcome !== null) {
		return powerOutcome;
	}
	return (
		(await stepFirewall(lease, checked, server.id)) ?? {
			kind: "observed",
			server,
		}
	);
}

async function stepFirewall(
	lease: Lease,
	checked: ServerObservation,
	serverId: number,
): Promise<HetznerCloudOutcome | null> {
	// The controller owns the firewall; a detached firewall is repaired on the next pass.
	const { firewallId } = lease.hetznerCloudAllocation;
	if (
		checked.parts.firewall !== "missing" ||
		firewallId === undefined ||
		isAllocationDeleting(lease.allocation)
	) {
		return null;
	}
	const actionId = await applyHetznerCloudFirewall(
		lease.usage,
		firewallId,
		serverId,
	);
	return actionId === null
		? { kind: "waiting" }
		: { kind: "actionStarted", id: actionId };
}

async function step(
	ctx: ActionCtx,
	lease: Lease,
): Promise<HetznerCloudOutcome> {
	const { allocation, hetznerCloudAllocation } = lease;
	const { controllerId, firewallId } = hetznerCloudAllocation;
	if (firewallId === undefined) {
		// Do not create provider resources until the project firewall proves ownership.
		return {
			kind: "firewallFound",
			id: (await requireHetznerCloudFirewall(lease.usage, controllerId)).id,
		};
	}
	await requireHetznerCloudController(lease.usage, firewallId, controllerId);
	if (hetznerCloudAllocation.action !== undefined) {
		return await stepAction(lease, hetznerCloudAllocation.action);
	}
	if (isAllocationDeleting(allocation)) {
		for (const kind of deleteOrder) {
			if (hetznerCloudAllocation.resources[kind].status !== "absent") {
				return await deleteResource(lease, kind);
			}
		}
		return { kind: "deleted" };
	}
	if (hetznerCloudAllocation.spec === undefined) {
		return {
			kind: "specResolved",
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

function toErrorOutcome(error: unknown): HetznerCloudOutcome {
	if (error instanceof HetznerCloudError) {
		return { kind: "failed", failure: toProviderFailure(error) };
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
		let outcome: HetznerCloudOutcome;
		try {
			outcome = await step(ctx, lease);
		} catch (error) {
			outcome = toErrorOutcome(error);
		}
		await ctx.runMutation(
			internal.allocations.hetzner_cloud.worker_state.record,
			{
				allocationId: args.allocationId,
				epoch: lease.hetznerCloudAllocation.epoch,
				operationId: lease.operation._id,
				queue: lease.hetznerCloudAllocation.queue,
				outcome,
				usage: lease.usage,
			},
		);
		return null;
	},
});
