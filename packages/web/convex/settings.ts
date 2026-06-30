import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	query,
	type DatabaseReader,
	type DatabaseWriter
} from "./_generated/server";
import type { StoredSnapshotPolicy, StoredThreshold } from "./schema";
import {
	resolveThresholds,
	thresholdsToStored,
	type ThresholdSetting
} from "./boxes/metricThresholds";
import {
	resolveSnapshotPolicy,
	snapshotPolicyToStored,
	type SnapshotPolicy
} from "./boxes/snapshotPolicy";

async function globalSettings(ctx: { db: DatabaseReader }) {
	return await ctx.db
		.query("settings")
		.withIndex("key", (query) => query.eq("key", "global"))
		.first();
}

export async function readGlobalSettings(ctx: { db: DatabaseReader }) {
	const settings = await globalSettings(ctx);

	return {
		checkoutEnabled: settings?.checkout_enabled ?? true,
		autoSuspendEnabled: settings?.auto_suspend_enabled ?? false,
		thresholds: resolveThresholds(settings?.thresholds),
		snapshotPolicy: resolveSnapshotPolicy(settings?.snapshot_policy),
		updatedAt: settings?.updated_at ?? null,
		updatedBy: settings?.updated_by ?? null
	};
}

async function patchGlobalSettings(
	ctx: { db: DatabaseWriter },
	patch: {
		auto_suspend_enabled?: boolean;
		checkout_enabled?: boolean;
		thresholds?: StoredThreshold[];
		snapshot_policy?: StoredSnapshotPolicy;
	},
	updatedBy?: string
) {
	const now = Date.now();
	const settings = await globalSettings(ctx);

	if (settings) {
		await ctx.db.patch(settings._id, {
			...patch,
			updated_at: now,
			updated_by: updatedBy
		});
		return;
	}

	await ctx.db.insert("settings", {
		key: "global",
		checkout_enabled: patch.checkout_enabled ?? true,
		auto_suspend_enabled: patch.auto_suspend_enabled,
		thresholds: patch.thresholds,
		snapshot_policy: patch.snapshot_policy,
		updated_at: now,
		updated_by: updatedBy
	});
}

export const get = query({
	args: {},
	handler: async (ctx) => {
		return await readGlobalSettings(ctx);
	}
});

export const readCheckoutEnabled = internalQuery({
	args: {},
	handler: async (ctx) => {
		return (await readGlobalSettings(ctx)).checkoutEnabled;
	}
});

export const setCheckoutEnabled = internalMutation({
	args: {
		checkoutEnabled: v.boolean(),
		updatedBy: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await patchGlobalSettings(
			ctx,
			{ checkout_enabled: args.checkoutEnabled },
			args.updatedBy
		);
	}
});

export const setAutoSuspendEnabled = internalMutation({
	args: {
		autoSuspendEnabled: v.boolean(),
		updatedBy: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await patchGlobalSettings(
			ctx,
			{ auto_suspend_enabled: args.autoSuspendEnabled },
			args.updatedBy
		);
	}
});

export const setThresholds = internalMutation({
	args: {
		thresholds: v.array(
			v.object({
				signal: v.union(v.literal("egress_bandwidth"), v.literal("egress_pps")),
				value: v.number(),
				sustainedSamples: v.number()
			})
		),
		updatedBy: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const thresholds: ThresholdSetting[] = args.thresholds.map((t) => ({
			signal: t.signal,
			value: t.value,
			sustainedSamples: t.sustainedSamples
		}));
		await patchGlobalSettings(
			ctx,
			{ thresholds: thresholdsToStored(thresholds) },
			args.updatedBy
		);
	}
});

export const setSnapshotPolicy = internalMutation({
	args: {
		policy: v.object({
			manualCap: v.number(),
			automaticCap: v.number(),
			manualMinIntervalMinutes: v.number(),
			manualRetentionDays: v.number(),
			automaticRetentionDays: v.number()
		}),
		updatedBy: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const policy: SnapshotPolicy = args.policy;
		await patchGlobalSettings(
			ctx,
			{ snapshot_policy: snapshotPolicyToStored(policy) },
			args.updatedBy
		);
	}
});
