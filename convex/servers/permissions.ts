import { type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { requireServerAllocation } from "../allocations/operations";
import { toConvexError } from "../errors";
import schema from "../schema";
import { requireUser } from "../users";
import { serverPermissions } from "./schema";

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

export const ownerAccess: Readonly<ServerAccess> = Object.freeze({
	isOwner: true,
	permissions: allServerPermissions,
});

export const serverSummary = v.object({
	_id: v.id("servers"),
	name: v.string(),
	isOwner: v.boolean(),
	permissions: serverPermissions,
});

/** A delegate cannot grant or remove authority outside their own permissions. */
export function hasServerPermissions(
	available: Readonly<ServerPermissions>,
	requested: Readonly<ServerPermissions>,
) {
	return Object.entries(requested).every(
		([permission, isGranted]) =>
			!isGranted || available[permission as ServerPermission],
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

export async function requireServerMembership(
	ctx: QueryCtx,
	membershipId: Id<"serverMemberships">,
) {
	const membership = await ctx.db.get("serverMemberships", membershipId);
	if (membership === null) {
		throw toConvexError("membership_not_found");
	}
	return membership;
}

/** Returns null for a user who neither owns the server nor has a membership. */
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

export function toServerSummary(
	server: Doc<"servers">,
	access: ServerAccess,
): Infer<typeof serverSummary> {
	return {
		_id: server._id,
		name: server.name,
		isOwner: access.isOwner,
		permissions: access.permissions,
	};
}

async function requireServerChangeable(ctx: QueryCtx, serverId: Id<"servers">) {
	if ((await requireServerAllocation(ctx, serverId)).deleteRequested) {
		throw toConvexError("server_deleting");
	}
}

/**
 * Access alone allows reads. A change also needs its permission, and a server
 * that is being deleted accepts no change.
 */
export async function requireServerAccess(
	ctx: QueryCtx,
	serverId: Id<"servers">,
	permission?: ServerPermission,
) {
	const user = await requireUser(ctx);
	const server = await ctx.db.get("servers", serverId);
	const access =
		server === null ? null : await getServerAccess(ctx, server, user._id);
	// A server that the user cannot access looks the same as one that does not exist.
	if (server === null || access === null) {
		throw toConvexError("server_not_found");
	}
	if (permission !== undefined) {
		if (!access.permissions[permission]) {
			throw toConvexError("permission_denied");
		}
		await requireServerChangeable(ctx, serverId);
	}
	return { user, server, ...access };
}

/** The allocation of a server whose SSH access the caller may change. */
export const requireSshAccess = internalQuery({
	args: { serverId: v.id("servers") },
	returns: schema.doc("serverAllocations"),
	handler: async (ctx, { serverId }) => {
		await requireServerAccess(ctx, serverId, "manageSsh");
		return await requireServerAllocation(ctx, serverId);
	},
});

export async function requireServerOwner(
	ctx: QueryCtx,
	serverId: Id<"servers">,
) {
	const access = await requireServerAccess(ctx, serverId);
	if (!access.isOwner) {
		throw toConvexError("permission_denied");
	}
	await requireServerChangeable(ctx, serverId);
	return access;
}
