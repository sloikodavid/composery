import { v } from "convex/values";
import { internalMutation } from "../../convex/functions";

/** Installed only in a disposable backend to exercise writes outside product lifecycle code. */
export const write = internalMutation({
	args: {
		change: v.union(
			v.object({ kind: v.literal("insert"), userId: v.id("users") }),
			v.object({
				kind: v.literal("catchInsertFailure"),
				userId: v.id("users"),
			}),
			v.object({
				kind: v.literal("patch"),
				serverId: v.id("servers"),
				userId: v.id("users"),
			}),
			v.object({
				kind: v.literal("replace"),
				serverId: v.id("servers"),
				userId: v.id("users"),
			}),
			v.object({ kind: v.literal("delete"), serverId: v.id("servers") }),
		),
	},
	returns: v.union(v.id("servers"), v.null()),
	handler: async (ctx, { change }) => {
		switch (change.kind) {
			case "insert":
				return await ctx.db.insert("servers", {
					name: "quota-test",
					ownerId: change.userId,
				});
			case "catchInsertFailure":
				try {
					await ctx.db.insert("servers", {
						name: "quota-test",
						ownerId: change.userId,
					});
				} catch {
					return null;
				}
				return null;
			case "patch":
				await ctx.db.patch("servers", change.serverId, {
					ownerId: change.userId,
				});
				return null;
			case "replace":
				await ctx.db.replace("servers", change.serverId, {
					name: "quota-test",
					ownerId: change.userId,
				});
				return null;
			case "delete":
				await ctx.db.delete("servers", change.serverId);
				return null;
		}
	},
});
