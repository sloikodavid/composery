import { Workpool } from "@convex-dev/workpool";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { env, internalAction, internalMutation } from "./_generated/server";
import {
	idField,
	list,
	object,
	ProviderError,
	request,
	verifyController,
} from "./hetzner";
import { rateLimiter } from "./limits";

const pool = new Workpool(components.workpool, {
	maxParallelism: 2,
	retryActionsByDefault: false,
});
const resource = v.object({
	id: v.number(),
	allocation: v.string(),
	kind: v.string(),
});

export const schedule = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const controllerId = env.HCLOUD_CONTROLLER_ID;
		if (!controllerId || !env.HCLOUD_TOKEN || !env.HCLOUD_FIREWALL_ID)
			return null;
		let scan = await ctx.db
			.query("serverInventory")
			.withIndex("by_controller_id", (q) => q.eq("controllerId", controllerId))
			.unique();
		if (!scan) {
			const id = await ctx.db.insert("serverInventory", {
				controllerId,
				kind: "servers",
				page: 1,
				dueAt: 0,
				epoch: 0,
			});
			scan = await ctx.db.get("serverInventory", id);
		}
		if (!scan || scan.dueAt > Date.now()) return null;
		const pacing = await rateLimiter.limit(ctx, "providerRequest", {
			count: 2,
		});
		if (!pacing.ok) return null;
		const epoch = scan.epoch + 1;
		await ctx.db.patch("serverInventory", scan._id, {
			epoch,
			dueAt: Date.now() + 120_000,
		});
		await pool.enqueueAction(
			ctx,
			internal.server_inventory.run,
			{ scan: { ...scan, epoch } },
			{ retry: false },
		);
		return null;
	},
});

export const record = internalMutation({
	args: {
		scanId: v.id("serverInventory"),
		epoch: v.number(),
		resources: v.array(resource),
		nextPage: v.union(v.number(), v.null()),
		error: v.union(v.string(), v.null()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const scan = await ctx.db.get("serverInventory", args.scanId);
		if (!scan || scan.epoch !== args.epoch) return null;
		if (args.error) {
			await ctx.db.patch("serverInventory", scan._id, {
				error: args.error,
				dueAt: Date.now() + 300_000,
			});
			return null;
		}
		for (const resource of args.resources) {
			const allocationId = ctx.db.normalizeId(
				"serverAllocations",
				resource.allocation,
			);
			const allocation = allocationId
				? await ctx.db.get("serverAllocations", allocationId)
				: null;
			let reason = "unknown_allocation";
			if (
				allocation &&
				allocation.controllerId === scan.controllerId &&
				allocation.status !== "deleted"
			) {
				const kind = resource.kind;
				if (kind === "server" || kind === "ipv4" || kind === "ipv6") {
					const state = allocation.resources[kind];
					if (state.phase === "present" && state.id === resource.id)
						reason = "";
					else if (state.phase === "pending" || state.phase === "uncertain") {
						await ctx.db.patch("serverAllocations", allocation._id, {
							dueAt: Math.max(Date.now(), allocation.leaseUntil),
						});
						reason = "";
					} else reason = "unexpected_resource";
				}
			}
			const existing = await ctx.db
				.query("serverFindings")
				.withIndex("by_controller_id_and_kind_and_provider_id", (q) =>
					q
						.eq("controllerId", scan.controllerId)
						.eq("kind", scan.kind)
						.eq("providerId", resource.id),
				)
				.unique();
			if (reason) {
				const fields = {
					controllerId: scan.controllerId,
					kind: scan.kind,
					providerId: resource.id,
					reason,
					observedAt: Date.now(),
					resolved: false,
				};
				if (existing)
					await ctx.db.patch("serverFindings", existing._id, fields);
				else await ctx.db.insert("serverFindings", fields);
			} else if (existing)
				await ctx.db.patch("serverFindings", existing._id, {
					resolved: true,
					observedAt: Date.now(),
				});
		}
		const finished = args.nextPage === null && scan.kind === "primary_ips";
		await ctx.db.patch("serverInventory", scan._id, {
			page: args.nextPage ?? 1,
			kind: args.nextPage
				? scan.kind
				: scan.kind === "servers"
					? "primary_ips"
					: "servers",
			dueAt: Date.now() + (finished ? 300_000 : 10_000),
			error: undefined,
		});
		return null;
	},
});

import schema from "./schema";
export const run = internalAction({
	args: { scan: schema.doc("serverInventory") },
	returns: v.null(),
	handler: async (ctx, { scan }) => {
		let resources: { id: number; allocation: string; kind: string }[] = [];
		let nextPage: number | null = null;
		let error: string | null = null;
		try {
			await verifyController(Number(env.HCLOUD_FIREWALL_ID), scan.controllerId);
			const response = await request(
				`${scan.kind}?label_selector=controller-id%3D${encodeURIComponent(scan.controllerId)}&per_page=50&page=${scan.page}`,
			);
			resources = list(response?.[scan.kind]).map((value) => {
				const row = object(value);
				const labels = object(row.labels);
				return {
					id: idField(row.id),
					allocation:
						typeof labels["allocation-id"] === "string"
							? labels["allocation-id"]
							: "",
					kind:
						typeof labels["resource-kind"] === "string"
							? labels["resource-kind"]
							: "",
				};
			});
			const next = object(object(response?.meta).pagination).next_page;
			nextPage = next === null ? null : idField(next);
		} catch (e) {
			error = e instanceof ProviderError ? e.code : "inventory_failed";
		}
		await ctx.runMutation(internal.server_inventory.record, {
			scanId: scan._id,
			epoch: scan.epoch,
			resources,
			nextPage,
			error,
		});
		return null;
	},
});
