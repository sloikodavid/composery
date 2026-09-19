import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { requireChangeableServerAllocation } from "../allocations/operations";
import schema from "../schema";
import { requireServerAccess } from "../servers/permissions";

/** Node actions call this query before accessing the SSH allocation. */
export const requireAllocation = internalQuery({
	args: { serverId: v.id("servers") },
	returns: schema.doc("serverAllocations"),
	handler: async (ctx, { serverId }) => {
		await requireServerAccess(ctx, serverId, "manageSsh");
		return await requireChangeableServerAllocation(ctx, serverId);
	},
});
