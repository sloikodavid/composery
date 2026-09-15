import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { requireChangeableServerAllocation } from "../allocations/operations";
import schema from "../schema";
import { requireServerAccess } from "../servers/permissions";

/**
 * The allocation whose SSH the caller may change. Every SSH action runs in Node, where the
 * database is out of reach, so each one asks this query first.
 */
export const requireAllocation = internalQuery({
	args: { serverId: v.id("servers") },
	returns: schema.doc("serverAllocations"),
	handler: async (ctx, { serverId }) => {
		await requireServerAccess(ctx, serverId, "manageSsh");
		return await requireChangeableServerAllocation(ctx, serverId);
	},
});
