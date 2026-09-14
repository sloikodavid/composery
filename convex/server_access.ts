import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
	allServerPermissions,
	type ServerPermission,
} from "./server_permissions";
import { getCurrentUser } from "./users";

export async function requireUser(ctx: QueryCtx) {
	const user = await getCurrentUser(ctx);
	if (user === null) throw new ConvexError({ message: "Sign in to continue." });
	return user;
}

export async function getMembership(
	ctx: QueryCtx,
	serverId: Id<"servers">,
	userId: Id<"users">,
) {
	return await ctx.db
		.query("serverMembers")
		.withIndex("by_server_id_and_user_id", (q) =>
			q.eq("serverId", serverId).eq("userId", userId),
		)
		.unique();
}

export function memberAccess(
	server: Doc<"servers">,
	member: Doc<"serverMembers">,
) {
	const isOwner = server.ownerId === member.userId;
	return {
		isOwner,
		permissions: isOwner ? allServerPermissions : member.permissions,
	};
}

/** Membership grants reads; an explicit permission gates each platform change. */
export async function requireServerAccess(
	ctx: QueryCtx,
	serverId: Id<"servers">,
	permission?: ServerPermission,
) {
	const user = await requireUser(ctx);
	const server = await ctx.db.get("servers", serverId);
	const membership = await getMembership(ctx, serverId, user._id);
	if (!server || !membership)
		throw new ConvexError({
			message: "You do not have access to this server.",
		});
	const access = memberAccess(server, membership);
	if (permission && !access.permissions[permission])
		throw new ConvexError({ message: "You do not have access to do this." });
	return { user, server, membership, ...access };
}

export async function requireServerOwner(
	ctx: QueryCtx,
	serverId: Id<"servers">,
) {
	const access = await requireServerAccess(ctx, serverId);
	if (!access.isOwner)
		throw new ConvexError({
			message: "Only the owner can transfer ownership.",
		});
	return access;
}
