import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { readGlobalSettings } from "../settings";
import { requireStaff } from "../authorization";
import {
	validateThresholds,
	type ThresholdSetting
} from "../boxes/metricThresholds";
import {
	validateSnapshotPolicy,
	type SnapshotPolicy
} from "../boxes/snapshotPolicy";
import type { BoxFlagSignal } from "../schema";

export const get = query({
	args: {},
	handler: async (ctx) => {
		await requireStaff(ctx);
		return await readGlobalSettings(ctx);
	}
});

export const setCheckoutEnabled = mutation({
	args: {
		enabled: v.boolean()
	},
	handler: async (ctx, args) => {
		const staffUser = await requireStaff(ctx);
		await ctx.runMutation(internal.settings.setCheckoutEnabled, {
			checkoutEnabled: args.enabled,
			updatedBy: staffUser.clerk_user_id
		});
	}
});

export const setAutoSuspendEnabled = mutation({
	args: {
		enabled: v.boolean()
	},
	handler: async (ctx, args) => {
		const staffUser = await requireStaff(ctx);
		await ctx.runMutation(internal.settings.setAutoSuspendEnabled, {
			autoSuspendEnabled: args.enabled,
			updatedBy: staffUser.clerk_user_id
		});
	}
});

export const setThresholds = mutation({
	args: {
		thresholds: v.array(
			v.object({
				signal: v.union(v.literal("egress_bandwidth"), v.literal("egress_pps")),
				value: v.number(),
				sustainedSamples: v.number()
			})
		)
	},
	handler: async (ctx, args) => {
		const staffUser = await requireStaff(ctx);

		const thresholds: ThresholdSetting[] = args.thresholds.map((t) => ({
			signal: t.signal as BoxFlagSignal,
			value: t.value,
			sustainedSamples: t.sustainedSamples
		}));

		try {
			validateThresholds(thresholds);
		} catch (error) {
			throw new ConvexError(
				error instanceof Error ? error.message : "Invalid thresholds."
			);
		}

		await ctx.runMutation(internal.settings.setThresholds, {
			thresholds: args.thresholds,
			updatedBy: staffUser.clerk_user_id
		});
	}
});

export const setSnapshotPolicy = mutation({
	args: {
		policy: v.object({
			manualCap: v.number(),
			automaticCap: v.number(),
			manualMinIntervalMinutes: v.number(),
			manualRetentionDays: v.number(),
			automaticRetentionDays: v.number()
		})
	},
	handler: async (ctx, args) => {
		const staffUser = await requireStaff(ctx);

		const policy: SnapshotPolicy = args.policy;
		try {
			validateSnapshotPolicy(policy);
		} catch (error) {
			throw new ConvexError(
				error instanceof Error ? error.message : "Invalid snapshot policy."
			);
		}

		await ctx.runMutation(internal.settings.setSnapshotPolicy, {
			policy: args.policy,
			updatedBy: staffUser.clerk_user_id
		});
	}
});
