import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

type ReaderCtx = Pick<QueryCtx, "auth" | "db">;
type WriterCtx = Pick<MutationCtx, "auth" | "db">;
type ActionAuthCtx = Pick<ActionCtx, "auth" | "runQuery">;

export function publicUser(user: Doc<"users">) {
	return {
		clerkUserId: user.clerk_user_id,
		email: user.email,
		role: user.role,
		suspended: user.suspended,
		suspendedReason: user.suspended_reason
	};
}

export type ActiveUser = {
	clerkUserId: string;
	email: string;
	user: Doc<"users">;
};

export async function requireIdentity(ctx: ReaderCtx) {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError("Authentication required.");
	}

	return identity;
}

export function emailFromIdentity(identity: UserIdentity) {
	if (!identity.email) {
		throw new ConvexError(
			"No email on the authenticated identity. Add an `email` claim to Clerk's session token (Configure -> Sessions -> Customize session token); see docs/developing/web/clerk.md."
		);
	}
	return identity.email;
}

export async function getUserByClerkId(ctx: ReaderCtx, clerkUserId: string) {
	return await ctx.db
		.query("users")
		.withIndex("clerk_user_id", (query) =>
			query.eq("clerk_user_id", clerkUserId)
		)
		.first();
}

// Create the user row, or patch its email if Clerk's changed.
export async function upsertUser(
	ctx: WriterCtx,
	clerkUserId: string,
	email: string
) {
	const now = Date.now();
	const existing = await getUserByClerkId(ctx, clerkUserId);

	if (existing) {
		if (existing.email !== email) {
			await ctx.db.patch(existing._id, { email, updated_at: now });
			return { ...existing, email, updated_at: now };
		}

		return existing;
	}

	const id = await ctx.db.insert("users", {
		clerk_user_id: clerkUserId,
		email,
		role: "user",
		suspended: false,
		created_at: now,
		updated_at: now
	});

	const user = await ctx.db.get(id);
	if (!user) {
		throw new ConvexError("Failed to create user.");
	}

	return user;
}

export async function ensureUserRecord(ctx: WriterCtx) {
	const identity = await requireIdentity(ctx);
	return await upsertUser(ctx, identity.subject, emailFromIdentity(identity));
}

export async function requireActiveUser(ctx: WriterCtx): Promise<ActiveUser> {
	const user = await ensureUserRecord(ctx);

	if (user.suspended) {
		throw new ConvexError("User is suspended.");
	}

	return {
		clerkUserId: user.clerk_user_id,
		email: user.email,
		user
	};
}

export async function requireActiveUserForRead(
	ctx: ReaderCtx
): Promise<ActiveUser> {
	const identity = await requireIdentity(ctx);
	const user = await getUserByClerkId(ctx, identity.subject);

	if (!user) {
		throw new ConvexError("User record has not been initialized.");
	}

	if (user.suspended) {
		throw new ConvexError("User is suspended.");
	}

	return {
		clerkUserId: user.clerk_user_id,
		email: user.email,
		user
	};
}

// A non-default role that isn't suspended. Shared by every staff guard.
export function isStaffUser(
	user: Doc<"users"> | null | undefined
): user is Doc<"users"> {
	return !!user && user.role !== "user" && !user.suspended;
}

export async function requireStaff(ctx: ReaderCtx) {
	const identity = await requireIdentity(ctx);
	const user = await getUserByClerkId(ctx, identity.subject);

	if (!isStaffUser(user)) {
		throw new ConvexError("Staff access required.");
	}

	return user;
}

// Actions have no `db`, so they re-check auth through internal queries.
export async function requireActiveUserInAction(ctx: ActionAuthCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new ConvexError("Authentication required.");

	const user = await ctx.runQuery(internal.users.activeUserByClerkId, {
		clerkUserId: identity.subject
	});
	if (!user) throw new ConvexError("Account is suspended or not initialized.");

	return user;
}

export async function requireStaffInAction(ctx: ActionAuthCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new ConvexError("Staff access required.");

	const staffUser = await ctx.runQuery(
		internal.staff.users.staffUserByClerkId,
		{
			clerkUserId: identity.subject
		}
	);
	if (!staffUser) throw new ConvexError("Staff access required.");

	return staffUser;
}
