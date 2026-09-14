import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireUser } from "../users";
import { serverPermissions } from "./schema";

export type ServerPermissions = Infer<typeof serverPermissions>;
export type ServerPermission = keyof ServerPermissions;

export const allServerPermissions: Readonly<ServerPermissions> = Object.freeze({
	rename: true,
	power: true,
	manageMembers: true,
	manageSsh: true,
	delete: true,
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

export function toServerAccess(
	server: Doc<"servers">,
	membership: Doc<"serverMemberships">,
) {
	const isOwner = server.ownerId === membership.userId;
	return {
		isOwner,
		permissions: isOwner ? allServerPermissions : membership.permissions,
	};
}

export function toServerSummary(
	server: Doc<"servers">,
	membership: Doc<"serverMemberships">,
): Infer<typeof serverSummary> {
	return {
		_id: server._id,
		name: server.name,
		...toServerAccess(server, membership),
	};
}

/** Membership grants reads. Each platform change also needs its permission. */
export async function requireServerAccess(
	ctx: QueryCtx,
	serverId: Id<"servers">,
	permission?: ServerPermission,
) {
	const user = await requireUser(ctx);
	const server = await ctx.db.get("servers", serverId);
	const membership = await getServerMembership(ctx, serverId, user._id);
	if (server === null || membership === null) {
		throw new ConvexError({
			message: "You do not have access to this server.",
		});
	}
	const access = toServerAccess(server, membership);
	if (permission !== undefined && !access.permissions[permission]) {
		throw new ConvexError({ message: "You do not have access to do this." });
	}
	return { user, server, membership, ...access };
}

export async function requireServerOwner(
	ctx: QueryCtx,
	serverId: Id<"servers">,
) {
	const access = await requireServerAccess(ctx, serverId);
	if (!access.isOwner) {
		throw new ConvexError({
			message: "Only the owner can transfer ownership.",
		});
	}
	return access;
}
