import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action, mutation, query } from "../_generated/server";
import {
	MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER,
	readGlobalSettings
} from "../settings";
import { requireCapability, requireCapabilityInAction } from "../authorization";
import {
	validateThresholds,
	type ThresholdSetting
} from "../boxes/metricThresholds";
import {
	validateSnapshotPolicy,
	type SnapshotPolicy
} from "../boxes/snapshotPolicy";
import type { BoxFlagSignal } from "../schema";
import { readCapacityUsage } from "../boxes/capacity";
import { reconcileCapacityAlert } from "../boxes/capacityAlerts";

export const get = query({
	args: {},
	handler: async (ctx) => {
		await requireCapability(ctx, "staff_console");
		const settings = await readGlobalSettings(ctx);
		return {
			...settings,
			capacity: await readCapacityUsage(ctx, settings)
		};
	}
});

export const setCheckoutEnabled = mutation({
	args: {
		enabled: v.boolean()
	},
	handler: async (ctx, args) => {
		const staffUser = await requireCapability(ctx, "settings_management");
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
		const staffUser = await requireCapability(ctx, "settings_management");
		await ctx.runMutation(internal.settings.setAutoSuspendEnabled, {
			autoSuspendEnabled: args.enabled,
			updatedBy: staffUser.clerk_user_id
		});
	}
});

// Pin the fleet's floor to whatever the channel currently resolves to.
//
// The floor is always set from the *resolved* release rather than a value typed
// into the console: a floor is a digest a box is compared against, and a
// hand-entered tag or version string would either not match any box or, worse,
// match by name while the box runs a different build. Staff choose the deadline;
// the image is whatever the deployment is already shipping.
//
// Omitting the deadline announces the floor without enforcing it - the interface
// tells owners they are behind and nothing updates itself.
export const setMinimumRuntimeToCurrent = action({
	args: {
		deadline: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<void> => {
		const staffUser = await requireCapabilityInAction(
			ctx,
			"settings_management"
		);
		if (args.deadline !== undefined && args.deadline <= Date.now()) {
			throw new ConvexError(
				"A floor deadline must be in the future, or it updates every box below it on the next run."
			);
		}

		const release = await ctx.runAction(
			internal.boxes.infra.runtimeImages.resolveConfiguredRuntimeRelease,
			{}
		);
		await ctx.runMutation(internal.settings.setMinimumRuntime, {
			deadline: args.deadline,
			image: release.image,
			version: release.version,
			updatedBy: staffUser.clerk_user_id
		});
	}
});

export const setHetznerLimits = mutation({
	args: {
		serverLimit: v.union(v.number(), v.null()),
		snapshotLimit: v.union(v.number(), v.null())
	},
	handler: async (ctx, args) => {
		const staffUser = await requireCapability(ctx, "settings_management");
		if ((args.serverLimit === null) !== (args.snapshotLimit === null)) {
			throw new ConvexError(
				"Set both Hetzner limits, or clear both to disable capacity admission."
			);
		}
		for (const [label, value] of [
			["Server limit", args.serverLimit],
			["Snapshot limit", args.snapshotLimit]
		] as const) {
			if (
				value !== null &&
				(!Number.isInteger(value) || value < 1 || value > 100_000)
			) {
				throw new ConvexError(
					`${label} must be a whole number between 1 and 100000.`
				);
			}
		}
		await ctx.runMutation(internal.settings.setHetznerLimits, {
			serverLimit: args.serverLimit,
			snapshotLimit: args.snapshotLimit,
			updatedBy: staffUser.clerk_user_id
		});
		await reconcileCapacityAlert(ctx);
	}
});

export const setMaxActiveCheckoutIntentsPerUser = mutation({
	args: {
		max: v.number()
	},
	handler: async (ctx, args) => {
		const staffUser = await requireCapability(ctx, "settings_management");
		if (
			!Number.isInteger(args.max) ||
			args.max < 1 ||
			args.max > MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER
		) {
			throw new ConvexError("Limit must be a whole number between 1 and 50.");
		}
		await ctx.runMutation(
			internal.settings.setMaxActiveCheckoutIntentsPerUser,
			{ max: args.max, updatedBy: staffUser.clerk_user_id }
		);
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
		const staffUser = await requireCapability(ctx, "settings_management");

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
			manualMinIntervalMinutes: v.number(),
			manualRetentionDays: v.number(),
			automaticRetentionDays: v.number()
		})
	},
	handler: async (ctx, args) => {
		const staffUser = await requireCapability(ctx, "settings_management");

		const policy: SnapshotPolicy = args.policy;
		try {
			validateSnapshotPolicy(policy);
		} catch (error) {
			throw new ConvexError(
				error instanceof Error ? error.message : "Invalid snapshot policy."
			);
		}

		const currentSettings = await readGlobalSettings(ctx);
		if (currentSettings.hetznerSnapshotLimit !== null) {
			const currentCapacity = await readCapacityUsage(ctx, currentSettings);
			const nextCapacity = await readCapacityUsage(ctx, {
				...currentSettings,
				snapshotPolicy: policy
			});
			if (
				nextCapacity.snapshotCommitments >
					currentSettings.hetznerSnapshotLimit &&
				nextCapacity.snapshotCommitments > currentCapacity.snapshotCommitments
			) {
				throw new ConvexError(
					`This snapshot policy would commit ${nextCapacity.snapshotCommitments} slots, above the configured Hetzner snapshot limit of ${currentSettings.hetznerSnapshotLimit}. Increase the Hetzner allocation first.`
				);
			}
		}

		await ctx.runMutation(internal.settings.setSnapshotPolicy, {
			policy: args.policy,
			updatedBy: staffUser.clerk_user_id
		});
		await reconcileCapacityAlert(ctx);
	}
});
