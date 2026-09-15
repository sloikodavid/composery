"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { type ActionCtx, internalAction } from "../../_generated/server";
import {
	httpStatus,
	isHttpClientError,
	isHttpServerError,
} from "../../http_status";
import {
	canReuseAllocationSshAccess,
	generateAllocationSshAccess,
	requireSshBootstrapFile,
	SshAccessError,
} from "../../ssh/access";
import { renderCloudInit } from "../../ssh/cloud_init";
import {
	callHetznerCloud,
	HetznerCloudError,
	requireController,
	requireId,
	requireList,
	requireObject,
	requireOwnedResource,
	requireText,
	resolveSpec,
} from "./api";
import {
	type HetznerCloudWorkerUpdate,
	hetznerCloudPowerDeadlineMs,
} from "./worker_state";

type ResourceKind = "server" | "ipv4" | "ipv6";
type PowerKind = "start" | "stop" | "forceStop";
type ObservedStatus = "running" | "stopped";
type Lease = {
	allocation: Doc<"serverAllocations">;
	hetznerCloudAllocation: Doc<"hetznerCloudAllocations">;
	operation: Doc<"serverOperations">;
};

const actionTimeoutMs = 600_000;
const lookupPageSize = "2";
const createOrder = ["ipv4", "ipv6", "server"] as const;
const deleteOrder = ["server", "ipv6", "ipv4"] as const;
const retryableStatuses: ReadonlySet<number> = new Set([
	httpStatus.preconditionFailed,
	httpStatus.locked,
	httpStatus.tooManyRequests,
]);
const uncertainCreateStatuses: ReadonlySet<number> = new Set([
	httpStatus.requestTimeout,
	httpStatus.conflict,
]);

const collections = {
	server: "servers",
	ipv4: "primary_ips",
	ipv6: "primary_ips",
} as const satisfies Record<ResourceKind, string>;

const resourceKeys = {
	server: "server",
	ipv4: "primary_ip",
	ipv6: "primary_ip",
} as const satisfies Record<ResourceKind, string>;

const powerActions = {
	start: "poweron",
	stop: "shutdown",
	forceStop: "poweroff",
} as const satisfies Record<PowerKind, string>;

const powerTargets = {
	start: "running",
	stop: "stopped",
	forceStop: "stopped",
} as const satisfies Record<PowerKind, ObservedStatus>;

// Hetzner's documented server statuses. Only a settled status is an observation.
const observedStatuses = {
	initializing: null,
	starting: null,
	running: "running",
	stopping: null,
	off: "stopped",
	deleting: null,
	migrating: null,
	rebuilding: null,
	unknown: null,
} as const satisfies Record<string, ObservedStatus | null>;

type HetznerServerStatus = keyof typeof observedStatuses;

function isHetznerServerStatus(value: string): value is HetznerServerStatus {
	return Object.hasOwn(observedStatuses, value);
}

function toFailure(
	error: string,
	details: { retry: boolean; missing?: true },
): HetznerCloudWorkerUpdate {
	return { failure: { error, ...details } };
}

function getResourceName(
	allocationId: Id<"serverAllocations">,
	kind: ResourceKind,
) {
	return `c-${allocationId}-${kind}`;
}

/** A Primary IP carries its address; a server's addresses come from its own record. */
function toResourceAddress(
	kind: ResourceKind,
	resource: Record<string, unknown>,
) {
	return kind === "server" ? {} : { address: requireText(resource.ip) };
}

function getActionId(response: Record<string, unknown> | null) {
	return response?.action ? requireId(requireObject(response.action).id) : null;
}

function requireOneMatch(
	matches: unknown[],
	hetznerCloudAllocation: Doc<"hetznerCloudAllocations">,
	kind: ResourceKind,
) {
	if (matches.length > 1) {
		throw new HetznerCloudError("duplicate_resources", {
			status: httpStatus.conflict,
		});
	}
	if (matches.length === 0) {
		return null;
	}
	const resource = requireObject(matches[0]);
	requireOwnedResource(resource, hetznerCloudAllocation.controllerId, {
		id: hetznerCloudAllocation.allocationId,
		kind,
	});
	return resource;
}

async function findResource(
	hetznerCloudAllocation: Doc<"hetznerCloudAllocations">,
	kind: ResourceKind,
) {
	const { allocationId, controllerId } = hetznerCloudAllocation;
	const collection = collections[kind];
	const resource = hetznerCloudAllocation.resources[kind];
	if (
		resource.status === "present" ||
		(resource.status === "absent" && resource.id)
	) {
		const response = await callHetznerCloud(`${collection}/${resource.id}`);
		if (response === null) {
			return null;
		}
		const found = requireObject(response[resourceKeys[kind]]);
		requireOwnedResource(found, controllerId, { id: allocationId, kind });
		return found;
	}
	// Labels also find a resource that was renamed at Hetzner after a lost create response.
	// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case parameters
	const labelQuery = new URLSearchParams({
		label_selector: `controller-id=${controllerId},allocation-id=${allocationId},resource-kind=${kind}`,
		per_page: lookupPageSize,
	});
	// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case parameters
	const labeled = await callHetznerCloud(`${collection}?${labelQuery}`);
	const labeledMatch = requireOneMatch(
		requireList(labeled?.[collection]),
		hetznerCloudAllocation,
		kind,
	);
	if (labeledMatch !== null) {
		return labeledMatch;
	}
	const named = await callHetznerCloud(
		`${collection}?name=${getResourceName(allocationId, kind)}&per_page=${lookupPageSize}`,
	);
	return requireOneMatch(
		requireList(named?.[collection]),
		hetznerCloudAllocation,
		kind,
	);
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

async function toCreateBody(ctx: ActionCtx, lease: Lease, kind: ResourceKind) {
	const hetznerCloudAllocation = lease.hetznerCloudAllocation;
	const { allocationId, controllerId, resources, spec } =
		hetznerCloudAllocation;
	if (spec === undefined) {
		throw new HetznerCloudError("spec_missing");
	}
	const body = {
		name: getResourceName(allocationId, kind),
		location: spec.location,
		labels: {
			"controller-id": controllerId,
			"allocation-id": allocationId,
			"resource-kind": kind,
		},
	};
	switch (kind) {
		case "ipv4":
		case "ipv6":
			// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case fields
			return {
				...body,
				type: kind,
				assignee_type: "server",
				auto_delete: true,
			};
		// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case fields
		case "server": {
			if (
				resources.ipv4.status !== "present" ||
				resources.ipv6.status !== "present"
			) {
				throw new HetznerCloudError("addresses_missing");
			}
			const userData = await renderUserData(ctx, lease);
			if (userData === null) {
				return null;
			}
			// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case fields
			return {
				...body,
				server_type: spec.serverType,
				image: spec.imageId,
				start_after_create: true,
				public_net: {
					enable_ipv4: true,
					enable_ipv6: true,
					ipv4: resources.ipv4.id,
					ipv6: resources.ipv6.id,
				},
				firewalls: [{ firewall: hetznerCloudAllocation.firewallId }],
				user_data: userData,
			};
			// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case fields
		}
	}
}

async function createResource(
	ctx: ActionCtx,
	lease: Lease,
	kind: ResourceKind,
): Promise<HetznerCloudWorkerUpdate> {
	const { allocation, hetznerCloudAllocation } = lease;
	const found = await findResource(hetznerCloudAllocation, kind);
	if (found !== null) {
		return {
			resource: {
				kind,
				status: { status: "present", id: requireId(found.id) },
				...toResourceAddress(kind, found),
			},
		};
	}
	const resource = hetznerCloudAllocation.resources[kind];
	if (resource.status === "uncertain") {
		return toFailure("create_outcome_unknown", { retry: false });
	}
	if (resource.status !== "pending") {
		return toFailure("resource_missing", { retry: false, missing: true });
	}
	if (allocation.status === "blocked") {
		return toFailure(hetznerCloudAllocation.error ?? "admin_retry_required", {
			retry: false,
		});
	}
	const body = await toCreateBody(ctx, lease, kind);
	if (body === null) {
		return {};
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
		const response = await callHetznerCloud(collections[kind], "POST", body);
		const created = requireObject(response?.[resourceKeys[kind]]);
		requireOwnedResource(created, hetznerCloudAllocation.controllerId, {
			id: allocation._id,
			kind,
		});
		const actionId = getActionId(response);
		return {
			resource: {
				kind,
				status: { status: "present", id: requireId(created.id) },
				...toResourceAddress(kind, created),
			},
			...(actionId === null ? {} : { actionId }),
		};
	} catch (error) {
		// A definite rejection returns the resource to pending. Any other outcome stays uncertain.
		if (
			error instanceof HetznerCloudError &&
			isHttpClientError(error.status) &&
			!uncertainCreateStatuses.has(error.status)
		) {
			return {
				resource: { kind, status: { status: "pending" } },
				failure: {
					error: error.code,
					retry: retryableStatuses.has(error.status),
					retryAfterMs: error.retryAfterMs,
					...(error.hetznerErrorCode === undefined
						? {}
						: { hetznerErrorCode: error.hetznerErrorCode }),
				},
			};
		}
		throw error;
	}
}

async function sendDelete(
	kind: ResourceKind,
	id: number,
): Promise<HetznerCloudWorkerUpdate> {
	try {
		const response = await callHetznerCloud(
			`${collections[kind]}/${id}`,
			"DELETE",
		);
		const actionId = getActionId(response);
		return {
			resource: { kind, status: { status: "present", id } },
			...(actionId === null ? {} : { actionId }),
		};
	} catch (error) {
		if (
			error instanceof HetznerCloudError &&
			error.status === httpStatus.notFound
		) {
			return { resource: { kind, status: { status: "absent", id } } };
		}
		throw error;
	}
}

async function deleteResource(
	lease: Lease,
	kind: ResourceKind,
): Promise<HetznerCloudWorkerUpdate> {
	const { allocation, hetznerCloudAllocation } = lease;
	const resource = hetznerCloudAllocation.resources[kind];
	if (resource.status === "pending") {
		return { resource: { kind, status: { status: "absent" } } };
	}
	const found = await findResource(hetznerCloudAllocation, kind);
	if (found === null && resource.status === "uncertain") {
		return toFailure("create_outcome_unknown", { retry: false });
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
		return {
			resource: {
				kind,
				status: { status: "present", id: requireId(found.id) },
			},
		};
	}
	if (allocation.status === "blocked") {
		return toFailure(hetznerCloudAllocation.error ?? "admin_retry_required", {
			retry: false,
		});
	}
	if (kind !== "server" && found.assignee_id !== null) {
		return toFailure("address_assigned_to_another_resource", {
			retry: false,
		});
	}
	return await sendDelete(kind, requireId(found.id));
}

async function stepAction(
	action: NonNullable<Doc<"hetznerCloudAllocations">["action"]>,
): Promise<HetznerCloudWorkerUpdate> {
	const response = await callHetznerCloud(`actions/${action.id}`);
	if (response === null) {
		return { clearAction: true };
	}
	const status = requireObject(response.action).status;
	if (status === "running") {
		return Date.now() - action.startedAt > actionTimeoutMs
			? toFailure("action_stalled", { retry: false })
			: {};
	}
	if (status === "error") {
		return {
			clearAction: true,
			failure: { error: "action_failed", retry: false },
		};
	}
	return { clearAction: true };
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
	if (operation.status === "blocked") {
		return toFailure(hetznerCloudAllocation.error ?? "admin_retry_required", {
			retry: false,
		});
	}
	if (
		Date.now() >
		(operation.deadlineAt ??
			operation._creationTime + hetznerCloudPowerDeadlineMs)
	) {
		return toFailure("power_change_timed_out", { retry: false });
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
	const response = await callHetznerCloud(
		`servers/${serverId}/actions/${powerActions[operation.kind]}`,
		"POST",
	);
	const actionId = getActionId(response);
	return actionId === null ? {} : { actionId };
}

function requireConfiguredServer(
	hetznerCloudAllocation: Doc<"hetznerCloudAllocations">,
	server: Record<string, unknown>,
) {
	const { resources, spec, firewallId } = hetznerCloudAllocation;
	const publicNet = requireObject(server.public_net);
	const ipv4 = requireObject(publicNet.ipv4);
	const ipv6 = requireObject(publicNet.ipv6);
	if (
		ipv4.id !== (resources.ipv4.status === "present" ? resources.ipv4.id : 0) ||
		ipv6.id !== (resources.ipv6.status === "present" ? resources.ipv6.id : 0)
	) {
		throw new HetznerCloudError("address_identity_mismatch", {
			status: httpStatus.conflict,
		});
	}
	if (
		requireObject(server.server_type).name !== spec?.serverType ||
		requireObject(server.location).name !== spec?.location
	) {
		throw new HetznerCloudError("server_configuration_mismatch", {
			status: httpStatus.conflict,
		});
	}
	const firewall = requireList(publicNet.firewalls)
		.map(requireObject)
		.find((attached) => attached.id === firewallId);
	if (firewall === undefined) {
		throw new HetznerCloudError("firewall_detached", {
			status: httpStatus.conflict,
		});
	}
	return {
		isFirewallApplied: firewall.status === "applied",
		ipv4: requireText(ipv4.ip),
		ipv6: requireText(ipv6.ip),
	};
}

async function observeServer(
	ctx: ActionCtx,
	lease: Lease,
): Promise<HetznerCloudWorkerUpdate> {
	const server = await findResource(lease.hetznerCloudAllocation, "server");
	if (server === null) {
		return toFailure("server_missing", { retry: false, missing: true });
	}
	const hetznerStatus = requireText(server.status);
	if (!isHetznerServerStatus(hetznerStatus)) {
		throw new HetznerCloudError("invalid_response");
	}
	const status = observedStatuses[hetznerStatus];
	if (status === null) {
		return toFailure("server_status_changing", { retry: true });
	}
	const configured = requireConfiguredServer(
		lease.hetznerCloudAllocation,
		server,
	);
	if (!configured.isFirewallApplied) {
		return toFailure("firewall_not_applied", { retry: true });
	}
	const powerUpdate = await stepPower(ctx, lease, requireId(server.id), status);
	return (
		powerUpdate ?? {
			observation: { status, ipv4: configured.ipv4, ipv6: configured.ipv6 },
		}
	);
}

async function step(
	ctx: ActionCtx,
	lease: Lease,
): Promise<HetznerCloudWorkerUpdate> {
	const { allocation, hetznerCloudAllocation } = lease;
	await requireController(
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
			spec: await resolveSpec(
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
		return {
			failure: {
				error: error.code,
				retry:
					error.status === 0 ||
					isHttpServerError(error.status) ||
					retryableStatuses.has(error.status),
				retryAfterMs: error.retryAfterMs,
				...(error.hetznerErrorCode === undefined
					? {}
					: { hetznerErrorCode: error.hetznerErrorCode }),
			},
		};
	}
	if (error instanceof SshAccessError) {
		return toFailure(error.code, { retry: false });
	}
	return toFailure("worker_failed", { retry: true });
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
