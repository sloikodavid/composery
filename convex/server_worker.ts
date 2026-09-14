"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import {
	idField,
	list,
	object,
	owned,
	ProviderError,
	request,
	resolveSpec,
	textField,
	verifyController,
} from "./hetzner";
import type { WorkerUpdate } from "./server_lifecycle";
import { bootstrapConfig, SshBootstrapError } from "./ssh/bootstrap";

type Kind = "server" | "ipv4" | "ipv6";
type Allocation = Doc<"serverAllocations">;
const pathFor = (kind: Kind) => (kind === "server" ? "servers" : "primary_ips");
const singular = (kind: Kind) => (kind === "server" ? "server" : "primary_ip");
const nameFor = (a: Allocation, kind: Kind) => `c-${a._id}-${kind}`;

async function find(a: Allocation, kind: Kind) {
	const state = a.resources[kind];
	if (state.phase === "present" || (state.phase === "absent" && state.id)) {
		const response = await request(`${pathFor(kind)}/${state.id}`);
		if (!response) return null;
		const result = object(response[singular(kind)]);
		owned(result, a.controllerId, a._id, kind);
		return result;
	}
	// Labels also recover a provider-side rename after a lost create response.
	const query = new URLSearchParams({
		label_selector: `controller-id=${a.controllerId},allocation-id=${a._id},resource-kind=${kind}`,
		per_page: "2",
	});
	const response = await request(`${pathFor(kind)}?${query}`);
	const matches = list(response?.[pathFor(kind)]);
	if (matches.length > 1) throw new ProviderError("duplicate_resources", 409);
	if (matches.length === 1) {
		const result = object(matches[0]);
		owned(result, a.controllerId, a._id, kind);
		return result;
	}
	const named = await request(
		`${pathFor(kind)}?name=${nameFor(a, kind)}&per_page=2`,
	);
	const names = list(named?.[pathFor(kind)]);
	if (!names.length) return null;
	if (names.length !== 1) throw new ProviderError("duplicate_resources", 409);
	const result = object(names[0]);
	owned(result, a.controllerId, a._id, kind);
	return result;
}

function actionId(response: Record<string, unknown> | null) {
	return response?.action ? idField(object(response.action).id) : null;
}

async function create(
	ctx: ActionCtx,
	a: Allocation,
	kind: Kind,
): Promise<WorkerUpdate> {
	const found = await find(a, kind);
	if (found)
		return {
			resource: { kind, state: { phase: "present", id: idField(found.id) } },
		};
	if (a.resources[kind].phase === "uncertain")
		return { error: `create_outcome_unknown:${kind}`, retry: false };
	if (a.resources[kind].phase !== "pending")
		return {
			error: `resource_missing:${kind}`,
			status: "missing",
			retry: false,
		};
	if (a.status === "blocked")
		return { error: a.error ?? "operator_retry_required", retry: false };
	if (!a.spec) throw new ProviderError("spec_missing");
	const body: Record<string, unknown> = {
		name: nameFor(a, kind),
		location: a.spec.location,
		labels: {
			"controller-id": a.controllerId,
			"allocation-id": a._id,
			"resource-kind": kind,
		},
	};
	if (kind === "server") {
		if (
			a.resources.ipv4.phase !== "present" ||
			a.resources.ipv6.phase !== "present"
		)
			throw new ProviderError("addresses_missing");
		Object.assign(body, {
			server_type: a.spec.serverType,
			image: a.spec.imageId,
			start_after_create: true,
			public_net: {
				enable_ipv4: true,
				enable_ipv6: true,
				ipv4: a.resources.ipv4.id,
				ipv6: a.resources.ipv6.id,
			},
			firewalls: [{ firewall: a.firewallId }],
			user_data: await bootstrapConfig(ctx, a._id),
		});
	} else
		Object.assign(body, {
			type: kind,
			assignee_type: "server",
			auto_delete: true,
		});
	const canDispatch: boolean = await ctx.runMutation(
		internal.server_lifecycle.dispatch,
		{ allocationId: a._id, epoch: a.epoch, kind },
	);
	if (!canDispatch) return {};
	try {
		const response = await request(pathFor(kind), "POST", body);
		const result = object(response?.[singular(kind)]);
		owned(result, a.controllerId, a._id, kind);
		return {
			resource: { kind, state: { phase: "present", id: idField(result.id) } },
			actionId: actionId(response),
		};
	} catch (error) {
		if (
			error instanceof ProviderError &&
			error.status >= 400 &&
			error.status < 500 &&
			![408, 409].includes(error.status)
		) {
			return {
				resource: { kind, state: { phase: "pending" } },
				error: error.code,
				retryAfterMs: error.retryAfterMs,
				retry: [412, 423, 429].includes(error.status),
			};
		}
		throw error;
	}
}

async function remove(a: Allocation, kind: Kind): Promise<WorkerUpdate> {
	const state = a.resources[kind];
	if (state.phase === "pending")
		return { resource: { kind, state: { phase: "absent" } } };
	const found = await find(a, kind);
	if (!found) {
		if (state.phase === "uncertain")
			return { error: `create_outcome_unknown:${kind}`, retry: false };
		return {
			resource: {
				kind,
				state: {
					phase: "absent",
					...("id" in state && state.id ? { id: state.id } : {}),
				},
			},
			clearAction: true,
		};
	}
	const id = idField(found.id);
	if (a.status === "blocked")
		return { error: a.error ?? "operator_retry_required", retry: false };
	if (kind !== "server" && found.assignee_id !== null)
		return { error: "address_assigned_to_another_resource", retry: false };
	try {
		const response = await request(`${pathFor(kind)}/${id}`, "DELETE");
		return {
			resource: { kind, state: { phase: "present", id } },
			actionId: actionId(response),
		};
	} catch (error) {
		if (error instanceof ProviderError && error.status === 404)
			return { resource: { kind, state: { phase: "absent", id } } };
		throw error;
	}
}

async function step(
	ctx: ActionCtx,
	a: Allocation,
	operation: Doc<"serverOperations">,
): Promise<WorkerUpdate> {
	await verifyController(a.firewallId, a.controllerId);
	if (a.action) {
		const response = await request(`actions/${a.action.id}`);
		if (response) {
			const action = object(response.action);
			if (action.status === "running") {
				if (Date.now() - a.action.startedAt > 600_000)
					return { error: "provider_action_stalled", retry: false };
				return {};
			}
			if (action.status === "error")
				return {
					clearAction: true,
					error: "provider_action_failed",
					retry: false,
				};
		}
		return { clearAction: true };
	}
	if (a.deleteRequested) {
		for (const kind of ["server", "ipv6", "ipv4"] as const)
			if (a.resources[kind].phase !== "absent") return await remove(a, kind);
		return { status: "deleted", complete: true };
	}
	if (!a.spec) return { spec: await resolveSpec(a.locations, a.image) };
	for (const kind of ["ipv4", "ipv6", "server"] as const)
		if (a.resources[kind].phase !== "present")
			return await create(ctx, a, kind);
	const server = await find(a, "server");
	if (!server)
		return { error: "server_missing", status: "missing", retry: false };
	const providerStatus = textField(server.status);
	if (providerStatus !== "running" && providerStatus !== "off")
		return { error: `server_state:${providerStatus}`, retry: true };
	const publicNet = object(server.public_net);
	const ipv4 = object(publicNet.ipv4);
	const ipv6 = object(publicNet.ipv6);
	if (
		ipv4.id !==
			(a.resources.ipv4.phase === "present" ? a.resources.ipv4.id : 0) ||
		ipv6.id !== (a.resources.ipv6.phase === "present" ? a.resources.ipv6.id : 0)
	)
		throw new ProviderError("address_identity_mismatch", 409);
	if (
		object(server.server_type).name !== a.spec.serverType ||
		object(server.location).name !== a.spec.location
	)
		throw new ProviderError("server_configuration_mismatch", 409);
	const firewall = list(publicNet.firewalls)
		.map(object)
		.find((f) => f.id === a.firewallId);
	if (!firewall) throw new ProviderError("firewall_detached", 409);
	if (firewall.status !== "applied")
		return { error: "firewall_not_applied", retry: true };
	if (
		operation.state !== "succeeded" &&
		operation.kind !== "create" &&
		operation.kind !== "delete"
	) {
		const target = operation.kind === "start" ? "running" : "off";
		if (providerStatus !== target) {
			if (operation.state === "blocked")
				return {
					error: operation.error ?? "operator_retry_required",
					retry: false,
				};
			if (
				Date.now() > (operation.deadlineAt ?? operation._creationTime + 300_000)
			)
				return { error: "power_change_timed_out", retry: false };
			const command =
				operation.kind === "start"
					? "poweron"
					: operation.kind === "stop"
						? "shutdown"
						: "poweroff";
			const authorized: boolean = await ctx.runMutation(
				internal.server_lifecycle.authorizePower,
				{ allocationId: a._id, epoch: a.epoch, operationId: operation._id },
			);
			if (!authorized) return {};
			const response = await request(
				`servers/${idField(server.id)}/actions/${command}`,
				"POST",
			);
			return { actionId: actionId(response) };
		}
	}
	return {
		status: providerStatus,
		ipv4: textField(ipv4.ip),
		ipv6: textField(ipv6.ip),
		complete: true,
	};
}

export const run = internalAction({
	args: { allocationId: v.id("serverAllocations"), epoch: v.number() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const claim: {
			allocation: Allocation;
			operation: Doc<"serverOperations">;
		} | null = await ctx.runMutation(internal.server_lifecycle.claim, args);
		if (!claim) return null;
		let update: WorkerUpdate;
		try {
			update = await step(ctx, claim.allocation, claim.operation);
		} catch (error) {
			update = {
				error:
					error instanceof ProviderError || error instanceof SshBootstrapError
						? error.code
						: "worker_failed",
				retryAfterMs: error instanceof ProviderError ? error.retryAfterMs : 0,
				retry:
					!(error instanceof SshBootstrapError) &&
					(!(error instanceof ProviderError) ||
						error.status === 0 ||
						error.status >= 500 ||
						[412, 423, 429].includes(error.status)),
			};
		}
		await ctx.runMutation(internal.server_lifecycle.record, {
			allocationId: args.allocationId,
			epoch: claim.allocation.epoch,
			update,
		});
		return null;
	},
});
