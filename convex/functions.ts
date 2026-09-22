import { customMutation } from "convex-helpers/server/customFunctions";
import { type Trigger, Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
	// biome-ignore lint/style/noRestrictedImports: this boundary must wrap the generated mutation builder
	internalMutation as baseInternalMutation,
	// biome-ignore lint/style/noRestrictedImports: this boundary must wrap the generated mutation builder
	mutation as baseMutation,
} from "./_generated/server";
import {
	deleteUserServerQuota,
	updateServerQuotaUsage,
} from "./servers/quota_usage";

function wrapQuotaMutation(ctx: MutationCtx) {
	let failed = false;
	let failure: unknown;
	function protectTrigger<Table extends "servers" | "users">(
		trigger: Trigger<MutationCtx, DataModel, Table>,
	): Trigger<MutationCtx, DataModel, Table> {
		return async (context, change) => {
			try {
				await trigger(context, change);
			} catch (error) {
				failed = true;
				failure = error;
				throw error;
			}
		};
	}
	const triggers = new Triggers<DataModel>();
	triggers.register("servers", protectTrigger(updateServerQuotaUsage));
	triggers.register("users", protectTrigger(deleteUserServerQuota));
	return {
		ctx: triggers.wrapDB(ctx),
		args: {},
		onSuccess: () => {
			// Catching a failed write must not commit its row without its quota update.
			if (failed) {
				throw failure;
			}
		},
	};
}

const quotaMutation = { args: {}, input: wrapQuotaMutation };
export const mutation = customMutation(baseMutation, quotaMutation);
export const internalMutation = customMutation(
	baseInternalMutation,
	quotaMutation,
);
