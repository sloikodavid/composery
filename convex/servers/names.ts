import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "../_generated/server";
import { requireChangeableServerAllocation } from "../allocations/operations";
import { type Failure, fail, failure } from "../errors";
import { checkRateLimit } from "../rate_limits";
import { getCurrentUser } from "../users";
import { getServerAccess, requireServerAccess } from "./permissions";
import { reservedServerNames } from "./reserved_names";
import { serverSummary, toServerSummary } from "./summary";

const namePattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function isValidName(name: string) {
	return namePattern.test(name) && !name.includes("--");
}

async function getNameClaim(ctx: QueryCtx, name: string) {
	return await ctx.db
		.query("serverNames")
		.withIndex("by_name", (q) => q.eq("name", name))
		.unique();
}

export async function checkServerNameClaim(
	ctx: MutationCtx,
	userId: Id<"users">,
	name: string,
	serverId?: Id<"servers">,
): Promise<Failure | null> {
	const attemptFailure = await checkRateLimit(ctx, "serverNameAttempt", userId);
	if (attemptFailure !== null) {
		return attemptFailure;
	}
	if (!isValidName(name)) {
		return fail("name_invalid", "name");
	}
	const claim = await getNameClaim(ctx, name);
	if (claim !== null && claim.serverId === serverId) {
		return null;
	}
	if (claim !== null || reservedServerNames.has(name)) {
		return fail("name_taken", "name");
	}
	return await checkRateLimit(ctx, "serverNameClaim", userId);
}

export async function claimServerName(
	ctx: MutationCtx,
	name: string,
	serverId: Id<"servers">,
) {
	if ((await getNameClaim(ctx, name)) === null) {
		await ctx.db.insert("serverNames", { name, serverId });
	}
}

export const rename = mutation({
	args: { serverId: v.id("servers"), name: v.string() },
	returns: v.union(
		v.object({ ok: v.literal(true), name: v.string() }),
		failure,
	),
	handler: async (ctx, { serverId, name }) => {
		const { user, server } = await requireServerAccess(ctx, serverId, "rename");
		await requireChangeableServerAllocation(ctx, serverId);
		if (server.name === name) {
			return { ok: true as const, name };
		}
		const claimFailure = await checkServerNameClaim(
			ctx,
			user._id,
			name,
			serverId,
		);
		if (claimFailure !== null) {
			return claimFailure;
		}
		await claimServerName(ctx, name, serverId);
		await ctx.db.patch("servers", serverId, { name });
		// The database rename succeeds even if SSH is unavailable.
		await ctx.scheduler.runAfter(0, internal.ssh.hostname.apply, {
			serverId,
			expected: server.name,
			next: name,
			attempt: 0,
		});
		return { ok: true as const, name };
	},
});

export const getByName = query({
	args: { name: v.string() },
	returns: v.union(serverSummary, v.null()),
	handler: async (ctx, { name }) => {
		const user = await getCurrentUser(ctx);
		if (user === null) {
			return null;
		}
		const claim = await getNameClaim(ctx, name);
		if (claim === null) {
			return null;
		}
		const server = await ctx.db.get("servers", claim.serverId);
		if (server === null) {
			return null;
		}
		const access = await getServerAccess(ctx, server, user._id);
		return access === null ? null : toServerSummary(server, access);
	},
});
