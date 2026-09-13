import { Workpool } from "@convex-dev/workpool";
import { ConvexError, type Infer, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	env,
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server";
import { rateLimiter } from "./limits";
import schema from "./schema";
import { allocationStatus, resourceKind, resourceState } from "./server_model";
import { requireRole } from "./servers";

const pool = new Workpool(components.workpool, {
	maxParallelism: 2,
	retryActionsByDefault: false,
});
const WATCHDOG_MS = 120_000;
const cleanupPool = new Workpool(components.serverCleanup, {
	maxParallelism: 1,
	retryActionsByDefault: false,
});
const IDLE_MS = 300_000;
const NEVER = Number.MAX_SAFE_INTEGER;

export function requestKey(value: string) {
	if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value))
		throw new ConvexError(
			"Use a request ID with 8 to 100 letters, numbers, hyphens, or underscores.",
		);
}

export async function allocationFor(ctx: MutationCtx, serverId: Id<"servers">) {
	return await ctx.db
		.query("serverAllocations")
		.withIndex("by_server_id", (q) => q.eq("serverId", serverId))
		.unique();
}

async function enqueue(ctx: MutationCtx, allocation: Doc<"serverAllocations">) {
	await (allocation.deleteRequested ? cleanupPool : pool).enqueueAction(
		ctx,
		internal.server_worker.run,
		{ allocationId: allocation._id, epoch: allocation.epoch },
		{ retry: false },
	);
	await ctx.db.patch("serverAllocations", allocation._id, {
		dueAt: Date.now() + WATCHDOG_MS,
	});
}

export async function reserve(ctx: MutationCtx, userId: Id<"users">) {
	const grant = await ctx.db
		.query("serverGrants")
		.withIndex("by_user_id", (q) => q.eq("userId", userId))
		.unique();
	if (!grant || grant.used >= grant.limit) return null;
	if (
		!env.HCLOUD_TOKEN ||
		!env.HCLOUD_CONTROLLER_ID ||
		!env.HCLOUD_LOCATIONS ||
		!env.HCLOUD_FIREWALL_ID
	)
		return null;
	const locations = env.HCLOUD_LOCATIONS.split(",").map((s) => s.trim());
	if (
		!locations.length ||
		locations.length > 20 ||
		locations.some((s) => !/^[a-z0-9]+$/.test(s)) ||
		new Set(locations).size !== locations.length
	)
		throw new ConvexError("The server location configuration is invalid.");
	const firewallId = Number(env.HCLOUD_FIREWALL_ID);
	if (
		!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,61}[a-zA-Z0-9]$/.test(
			env.HCLOUD_CONTROLLER_ID,
		)
	)
		throw new ConvexError("The controller identifier is invalid.");
	if (!Number.isSafeInteger(firewallId) || firewallId <= 0)
		throw new ConvexError("The server firewall configuration is invalid.");
	await ctx.db.patch("serverGrants", grant._id, { used: grant.used + 1 });
	return {
		grantId: grant._id,
		locations,
		firewallId,
		controllerId: env.HCLOUD_CONTROLLER_ID,
		image: env.HCLOUD_IMAGE ?? "ubuntu-24.04",
	};
}

export async function provision(
	ctx: MutationCtx,
	serverId: Id<"servers">,
	userId: Id<"users">,
	requestId: string,
	name: string,
	reservation: NonNullable<Awaited<ReturnType<typeof reserve>>>,
) {
	const operationId = await ctx.db.insert("serverOperations", {
		serverId,
		requesterId: userId,
		requestId,
		name,
		kind: "create",
		state: "pending",
	});
	const allocationId = await ctx.db.insert("serverAllocations", {
		serverId,
		...reservation,
		backend: "hetznerCloud",
		operationId,
		resources: {
			ipv4: { phase: "pending" },
			ipv6: { phase: "pending" },
			server: { phase: "pending" },
		},
		status: "allocating",
		deleteRequested: false,
		dueAt: Date.now(),
		leaseUntil: 0,
		epoch: 0,
		failures: 0,
	});
	const allocation = await ctx.db.get("serverAllocations", allocationId);
	if (allocation) await enqueue(ctx, allocation);
}

export async function deleteServer(
	ctx: MutationCtx,
	serverId: Id<"servers">,
	requesterId?: Id<"users">,
) {
	const allocation = await allocationFor(ctx, serverId);
	if (!allocation) {
		if (await ctx.db.get("servers", serverId))
			await ctx.db.delete("servers", serverId);
		await ctx.scheduler.runAfter(0, internal.servers.deleteMembers, {
			serverId,
		});
		return;
	}
	if (allocation.deleteRequested) return;
	const old = await ctx.db.get("serverOperations", allocation.operationId);
	if (old && old.state !== "succeeded")
		await ctx.db.patch("serverOperations", old._id, {
			state: "superseded",
			finishedAt: Date.now(),
		});
	const operationId = await ctx.db.insert("serverOperations", {
		serverId,
		...(requesterId ? { requesterId } : {}),
		requestId: `delete_${allocation._id}`,
		kind: "delete",
		state: "pending",
	});
	// Preserve the worker epoch and resource identities: a create may still return.
	await ctx.db.patch("serverAllocations", allocation._id, {
		operationId,
		deleteRequested: true,
		status: "deleting",
		error: undefined,
		failures: 0,
		dueAt: Math.max(Date.now(), allocation.leaseUntil),
	});
}

export const setGrant = internalMutation({
	args: { userId: v.id("users"), limit: v.number() },
	returns: v.null(),
	handler: async (ctx, { userId, limit }) => {
		if (!Number.isSafeInteger(limit) || limit < 0)
			throw new ConvexError("The server limit must be a nonnegative integer.");
		if (!(await ctx.db.get("users", userId)))
			throw new ConvexError("The user does not exist.");
		const grant = await ctx.db
			.query("serverGrants")
			.withIndex("by_user_id", (q) => q.eq("userId", userId))
			.unique();
		if (grant) await ctx.db.patch("serverGrants", grant._id, { limit });
		else await ctx.db.insert("serverGrants", { userId, limit, used: 0 });
		return null;
	},
});

export const power = mutation({
	args: {
		serverId: v.id("servers"),
		requestId: v.string(),
		command: v.union(
			v.literal("start"),
			v.literal("stop"),
			v.literal("forceStop"),
		),
	},
	returns: v.id("serverOperations"),
	handler: async (ctx, { serverId, requestId, command }) => {
		const { user } = await requireRole(ctx, serverId, "write");
		requestKey(requestId);
		const previous = await ctx.db
			.query("serverOperations")
			.withIndex("by_requester_id_and_request_id", (q) =>
				q.eq("requesterId", user._id).eq("requestId", requestId),
			)
			.unique();
		if (previous) {
			if (previous.serverId !== serverId || previous.kind !== command)
				throw new ConvexError("This request ID was used for another command.");
			return previous._id;
		}
		const limit = await rateLimiter.limit(ctx, "serverChange", {
			key: user._id,
		});
		if (!limit.ok)
			throw new ConvexError("Too many server changes. Try again later.");
		const allocation = await allocationFor(ctx, serverId);
		if (
			!allocation ||
			allocation.deleteRequested ||
			allocation.resources.server.phase !== "present"
		)
			throw new ConvexError("This server cannot accept a power command.");
		const current = await ctx.db.get(
			"serverOperations",
			allocation.operationId,
		);
		if (current?.state === "pending")
			throw new ConvexError("Wait for the current server command to finish.");
		if (allocation.leaseUntil > Date.now() || allocation.action)
			throw new ConvexError("The server is being checked. Try again shortly.");
		const operationId = await ctx.db.insert("serverOperations", {
			serverId,
			requesterId: user._id,
			requestId,
			kind: command,
			state: "pending",
			deadlineAt: Date.now() + 300_000,
		});
		await ctx.db.patch("serverAllocations", allocation._id, {
			operationId,
			failures: 0,
			error: undefined,
			dueAt: Date.now(),
		});
		await enqueue(ctx, { ...allocation, operationId });
		return operationId;
	},
});

export const status = query({
	args: { serverId: v.id("servers") },
	returns: v.union(
		v.null(),
		v.object({
			status: allocationStatus,
			error: v.union(v.string(), v.null()),
			location: v.union(v.string(), v.null()),
			ipv4: v.union(v.string(), v.null()),
			ipv6: v.union(v.string(), v.null()),
			observedAt: v.union(v.number(), v.null()),
			operation: v.union(v.null(), schema.doc("serverOperations")),
		}),
	),
	handler: async (ctx, { serverId }) => {
		await requireRole(ctx, serverId, "read");
		const a = await ctx.db
			.query("serverAllocations")
			.withIndex("by_server_id", (q) => q.eq("serverId", serverId))
			.unique();
		if (!a) return null;
		return {
			status: a.status,
			error: a.error ?? null,
			location: a.spec?.location ?? null,
			ipv4: a.ipv4 ?? null,
			ipv6: a.ipv6 ?? null,
			observedAt: a.observedAt ?? null,
			operation: await ctx.db.get("serverOperations", a.operationId),
		};
	},
});

export const sweep = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const due: Doc<"serverAllocations">[] = [];
		// Reserve half of each batch for cleanup, independently of new requests.
		for (const deleting of [true, false])
			due.push(
				...(await ctx.db
					.query("serverAllocations")
					.withIndex("by_delete_requested_and_due_at", (q) =>
						q.eq("deleteRequested", deleting).lte("dueAt", Date.now()),
					)
					.take(10)),
			);
		for (const allocation of due)
			if (allocation.leaseUntil <= Date.now()) await enqueue(ctx, allocation);
		return null;
	},
});

export const claim = internalMutation({
	args: { allocationId: v.id("serverAllocations"), epoch: v.number() },
	returns: v.union(
		v.null(),
		v.object({
			allocation: schema.doc("serverAllocations"),
			operation: schema.doc("serverOperations"),
		}),
	),
	handler: async (ctx, { allocationId, epoch }) => {
		const a = await ctx.db.get("serverAllocations", allocationId);
		if (
			!a ||
			a.epoch !== epoch ||
			a.leaseUntil > Date.now() ||
			a.status === "deleted"
		)
			return null;
		const pacing = await rateLimiter.limit(
			ctx,
			a.deleteRequested ? "providerCleanup" : "providerRequest",
			{
				count: 8,
			},
		);
		if (!pacing.ok) {
			await ctx.db.patch("serverAllocations", a._id, {
				dueAt: Date.now() + pacing.retryAfter,
			});
			return null;
		}
		const patch = {
			epoch: epoch + 1,
			leaseUntil: Date.now() + WATCHDOG_MS,
			dueAt: Date.now() + WATCHDOG_MS,
		};
		await ctx.db.patch("serverAllocations", a._id, patch);
		const operation = await ctx.db.get("serverOperations", a.operationId);
		if (!operation) throw new Error("Missing server operation.");
		return { allocation: { ...a, ...patch }, operation };
	},
});

export const dispatch = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		epoch: v.number(),
		kind: resourceKind,
	},
	returns: v.boolean(),
	handler: async (ctx, { allocationId, epoch, kind }) => {
		const a = await ctx.db.get("serverAllocations", allocationId);
		if (
			!a ||
			a.epoch !== epoch ||
			a.deleteRequested ||
			a.leaseUntil <= Date.now() ||
			a.resources[kind].phase !== "pending"
		)
			return false;
		await ctx.db.patch("serverAllocations", a._id, {
			resources: { ...a.resources, [kind]: { phase: "uncertain" } },
		});
		return true;
	},
});

export const authorizePower = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		epoch: v.number(),
		operationId: v.id("serverOperations"),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const a = await ctx.db.get("serverAllocations", args.allocationId);
		return (
			!!a &&
			!a.deleteRequested &&
			a.epoch === args.epoch &&
			a.operationId === args.operationId &&
			a.leaseUntil > Date.now()
		);
	},
});

const update = v.object({
	resource: v.optional(v.object({ kind: resourceKind, state: resourceState })),
	spec: v.optional(
		v.object({
			location: v.string(),
			imageId: v.number(),
			serverType: v.string(),
		}),
	),
	status: v.optional(allocationStatus),
	ipv4: v.optional(v.string()),
	ipv6: v.optional(v.string()),
	actionId: v.optional(v.union(v.number(), v.null())),
	clearAction: v.optional(v.boolean()),
	error: v.optional(v.string()),
	retry: v.optional(v.boolean()),
	retryAfterMs: v.optional(v.number()),
	complete: v.optional(v.boolean()),
});

export const record = internalMutation({
	args: { allocationId: v.id("serverAllocations"), epoch: v.number(), update },
	returns: v.null(),
	handler: async (ctx, { allocationId, epoch, update: u }) => {
		const a = await ctx.db.get("serverAllocations", allocationId);
		if (!a || a.epoch !== epoch) return null;
		const patch: {
			[K in keyof Doc<"serverAllocations">]?: undefined extends Doc<"serverAllocations">[K]
				? Doc<"serverAllocations">[K] | undefined
				: Doc<"serverAllocations">[K];
		} = {
			leaseUntil: 0,
			dueAt: Date.now() + 5_000,
		};
		if (u.status && ["running", "off", "missing", "deleted"].includes(u.status))
			patch.observedAt = Date.now();
		if (u.resource)
			patch.resources = { ...a.resources, [u.resource.kind]: u.resource.state };
		if (
			u.resource?.state.phase === "present" &&
			a.resources[u.resource.kind].phase === "uncertain" &&
			a.status === "blocked"
		) {
			patch.status = a.deleteRequested ? "deleting" : "allocating";
			await ctx.db.patch("serverOperations", a.operationId, {
				state: "pending",
				error: undefined,
			});
		}
		if (u.spec) patch.spec = u.spec;
		if (u.ipv4) patch.ipv4 = u.ipv4;
		if (u.ipv6) patch.ipv6 = u.ipv6;
		if (u.clearAction) patch.action = undefined;
		if (u.actionId) patch.action = { id: u.actionId, startedAt: Date.now() };
		if (u.status)
			patch.status =
				a.deleteRequested && u.status !== "deleted" ? "deleting" : u.status;
		if (u.error) {
			patch.error = u.error;
			patch.failures = a.failures + 1;
			patch.dueAt =
				Date.now() +
				Math.min(3_600_000, 10_000 * 2 ** Math.min(a.failures, 8)) +
				Math.floor(Math.random() * 5_000);
			patch.dueAt = Math.max(patch.dueAt, Date.now() + (u.retryAfterMs ?? 0));
			if (!u.retry || a.failures >= 8) {
				patch.status = u.status === "missing" ? "missing" : "blocked";
				patch.dueAt = Math.max(patch.dueAt, Date.now() + 3_600_000);
				const operation = await ctx.db.get("serverOperations", a.operationId);
				if (operation && operation.state !== "succeeded")
					await ctx.db.patch("serverOperations", a.operationId, {
						state: "blocked",
						error: u.error,
					});
			}
		} else {
			patch.error = undefined;
			patch.failures = 0;
		}
		if (u.complete && (!a.deleteRequested || u.status === "deleted")) {
			const operation = await ctx.db.get("serverOperations", a.operationId);
			if (operation?.state !== "succeeded")
				await ctx.db.patch("serverOperations", a.operationId, {
					state: "succeeded",
					finishedAt: Date.now(),
					error: undefined,
				});
			patch.dueAt = Date.now() + IDLE_MS;
		}
		if (u.status === "deleted") {
			if (
				Object.values(patch.resources ?? a.resources).some(
					(r) => r.phase !== "absent",
				)
			)
				throw new Error(
					"Cannot release an allocation before resource cleanup.",
				);
			const grant = await ctx.db.get("serverGrants", a.grantId);
			if (grant && a.status !== "deleted")
				await ctx.db.patch("serverGrants", grant._id, {
					used: Math.max(0, grant.used - 1),
				});
			patch.dueAt = NEVER;
			patch.ipv4 = undefined;
			patch.ipv6 = undefined;
			if (await ctx.db.get("servers", a.serverId))
				await ctx.db.delete("servers", a.serverId);
			await ctx.scheduler.runAfter(0, internal.servers.deleteMembers, {
				serverId: a.serverId,
			});
		}
		await ctx.db.patch("serverAllocations", a._id, patch);
		return null;
	},
});

// Operator recovery requires explicit confirmation that an uncertain create never took effect.
export const retry = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		confirmedAbsent: v.optional(resourceKind),
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, confirmedAbsent }) => {
		const a = await ctx.db.get("serverAllocations", allocationId);
		if (!a || a.status === "deleted" || a.leaseUntil > Date.now())
			throw new ConvexError("The allocation cannot be retried now.");
		const resources = { ...a.resources };
		if (confirmedAbsent) {
			if (resources[confirmedAbsent].phase !== "uncertain")
				throw new ConvexError(
					"Only an uncertain resource needs absence confirmation.",
				);
			resources[confirmedAbsent] = {
				phase: a.deleteRequested ? "absent" : "pending",
			};
		}
		await ctx.db.patch("serverOperations", a.operationId, {
			state: "pending",
			error: undefined,
			deadlineAt: Date.now() + 300_000,
		});
		await ctx.db.patch("serverAllocations", a._id, {
			resources,
			status: a.deleteRequested ? "deleting" : "allocating",
			failures: 0,
			error: undefined,
			dueAt: Date.now(),
			action: undefined,
		});
		return null;
	},
});

export type WorkerUpdate = Infer<typeof update>;
