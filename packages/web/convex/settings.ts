import { v } from "convex/values";
import {
	internalMutation,
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
import { sendStaffAlert, staffConsoleUrl } from "./staffAlerts";

// Legit buyers rarely juggle more than a couple of pending purchases; the
// default caps concurrent active checkout reservations so one account can't hog
// slugs it never pays for. Staff-tunable via the console.
export const DEFAULT_MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER = 3;
export const MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER = 50;

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
		hetznerServerLimit: settings?.hetzner_server_limit ?? null,
		hetznerSnapshotLimit: settings?.hetzner_snapshot_limit ?? null,
		autoSuspendEnabled: settings?.auto_suspend_enabled ?? false,
		maxActiveCheckoutIntentsPerUser:
			settings?.max_active_checkout_intents_per_user ??
			DEFAULT_MAX_ACTIVE_CHECKOUT_INTENTS_PER_USER,
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
		hetzner_server_limit?: number;
		hetzner_snapshot_limit?: number;
		max_active_checkout_intents_per_user?: number;
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
		hetzner_server_limit: patch.hetzner_server_limit,
		hetzner_snapshot_limit: patch.hetzner_snapshot_limit,
		auto_suspend_enabled: patch.auto_suspend_enabled,
		max_active_checkout_intents_per_user:
			patch.max_active_checkout_intents_per_user,
		thresholds: patch.thresholds,
		snapshot_policy: patch.snapshot_policy,
		updated_at: now,
		updated_by: updatedBy
	});
}

export const setCheckoutEnabled = internalMutation({
	args: {
		checkoutEnabled: v.boolean(),
		updatedBy: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const previous = await readGlobalSettings(ctx);
		await patchGlobalSettings(
			ctx,
			{ checkout_enabled: args.checkoutEnabled },
			args.updatedBy
		);
		if (previous.checkoutEnabled === args.checkoutEnabled) return;

		const state = args.checkoutEnabled ? "enabled" : "disabled";
		const actor = args.updatedBy ?? "system";
		await sendStaffAlert(ctx, {
			key: `checkout-${state}:${Date.now()}:${actor}`,
			severity: args.checkoutEnabled ? "resolved" : "critical",
			subject: `Checkout ${state}`,
			text: `New box checkout was ${state} by ${actor}.\n\nReview capacity and checkout state: ${staffConsoleUrl()}`
		});
	}
});

export const setHetznerLimits = internalMutation({
	args: {
		serverLimit: v.union(v.number(), v.null()),
		snapshotLimit: v.union(v.number(), v.null()),
		updatedBy: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const previous = await readGlobalSettings(ctx);
		await patchGlobalSettings(
			ctx,
			{
				hetzner_server_limit: args.serverLimit ?? undefined,
				hetzner_snapshot_limit: args.snapshotLimit ?? undefined
			},
			args.updatedBy
		);
		const wasConfigured =
			previous.hetznerServerLimit !== null &&
			previous.hetznerSnapshotLimit !== null;
		const configured = args.serverLimit !== null && args.snapshotLimit !== null;
		if (!wasConfigured || configured) return;

		const actor = args.updatedBy ?? "system";
		await sendStaffAlert(ctx, {
			key: `capacity-admission-disabled:${Date.now()}:${actor}`,
			severity: "critical",
			subject: "Capacity admission disabled",
			text: `Hetzner server and snapshot allocations were removed by ${actor}. New checkout now fails closed until both are configured.\n\nReview the allocation: ${staffConsoleUrl()}`
		});
	}
});

export const setAutoSuspendEnabled = internalMutation({
	args: {
		autoSuspendEnabled: v.boolean(),
		updatedBy: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const previous = await readGlobalSettings(ctx);
		await patchGlobalSettings(
			ctx,
			{ auto_suspend_enabled: args.autoSuspendEnabled },
			args.updatedBy
		);
		if (previous.autoSuspendEnabled === args.autoSuspendEnabled) return;

		const state = args.autoSuspendEnabled ? "enabled" : "disabled";
		const actor = args.updatedBy ?? "system";
		await sendStaffAlert(ctx, {
			key: `auto-suspend-${state}:${Date.now()}:${actor}`,
			severity: args.autoSuspendEnabled ? "warning" : "critical",
			subject: `Automatic suspension ${state}`,
			text: `Automatic abuse suspension was ${state} by ${actor}.\n\nReview the thresholds and current flags: ${staffConsoleUrl()}`
		});
	}
});

export const setMaxActiveCheckoutIntentsPerUser = internalMutation({
	args: {
		max: v.number(),
		updatedBy: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await patchGlobalSettings(
			ctx,
			{ max_active_checkout_intents_per_user: args.max },
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
