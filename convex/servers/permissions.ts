import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { toConvexError } from "../errors";
import { requireUser } from "../users";
import type { serverPermissions } from "./schema";

export type ServerPermissions = Infer<typeof serverPermissions>;
export type ServerPermission = keyof ServerPermissions;

export type ServerAccess = {
	isOwner: boolean;
	permissions: Readonly<ServerPermissions>;
};

export const allServerPermissions: Readonly<ServerPermissions> = Object.freeze({
	rename: true,
	power: true,
	manageMembers: true,
	manageSsh: true,
	delete: true,
});

const everyServerPermission = Object.keys(
	allServerPermissions,
) as readonly ServerPermission[];

export const ownerAccess: Readonly<ServerAccess> = Object.freeze({
	isOwner: true,
	permissions: allServerPermissions,
});

export function hasServerPermissions(
	available: Readonly<ServerPermissions>,
	requested: Readonly<ServerPermissions>,
) {
	return everyServerPermission.every(
		(permission) => !requested[permission] || available[permission],
	);
}

export async function getServerMembership(
	ctx: QueryCtx,
	serverId: Id<"servers">,
	userId: Id<"users">,
) {
	return await ctx.db
		.query("serverMemberships")
		.withIndex("by_server_id_and_user_id", (q) =>
			q.eq("serverId", serverId).eq("userId", userId),
		)
		.unique();
}

export async function getServerAccess(
	ctx: QueryCtx,
	server: Doc<"servers">,
	userId: Id<"users">,
): Promise<ServerAccess | null> {
	if (server.ownerId === userId) {
		return ownerAccess;
	}
	const membership = await getServerMembership(ctx, server._id, userId);
	return membership === null
		? null
		: { isOwner: false, permissions: membership.permissions };
}

export async function requireServerAccess(
	ctx: QueryCtx,
	serverId: Id<"servers">,
	permission?: ServerPermission,
) {
	const user = await requireUser(ctx);
	const server = await ctx.db.get("servers", serverId);
	const access =
		server === null ? null : await getServerAccess(ctx, server, user._id);
	// Hide whether an inaccessible server exists.
	if (server === null || access === null) {
		throw toConvexError("server_not_found");
	}
	if (permission !== undefined && !access.permissions[permission]) {
		throw toConvexError("permission_denied");
	}
	return { user, server, ...access };
}

export async function requireServerOwner(
	ctx: QueryCtx,
	serverId: Id<"servers">,
) {
	const access = await requireServerAccess(ctx, serverId);
	if (!access.isOwner) {
		throw toConvexError("permission_denied");
	}
	return access;
}
