import { createClerkClient, type User } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import {
	type ActionCtx,
	action,
	env,
	internalAction,
} from "./_generated/server";
import { toConvexError } from "./errors";
import { httpStatus } from "./http_status";
import { requireRateLimit } from "./rate_limits";
import type { userFields } from "./schema";

const clerkPageSize = 100;

type UserFields = Infer<typeof userFields>;

function createClient() {
	return createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
}

// Returns null until the Clerk account has every field that sign-up requires.
function toUserFields(user: User): UserFields | null {
	const email = user.primaryEmailAddress?.emailAddress;
	if (email === undefined || user.username === null) {
		return null;
	}
	return {
		clerkUserId: user.id,
		username: user.username,
		email,
		imageUrl: user.imageUrl,
	};
}

async function storeUsers(ctx: ActionCtx, users: User[]) {
	const complete: UserFields[] = [];
	const incomplete: string[] = [];
	for (const user of users) {
		const fields = toUserFields(user);
		if (fields === null) {
			incomplete.push(user.id);
		} else {
			complete.push(fields);
		}
	}
	if (complete.length > 0) {
		await ctx.runMutation(internal.users.store, { users: complete });
	}
	if (incomplete.length > 0) {
		await ctx.runMutation(internal.users.disable, {
			clerkUserIds: incomplete,
		});
	}
}

// Reads the current state from Clerk, so the order in which events arrive does not matter.
export async function syncClerkUser(ctx: ActionCtx, clerkUserId: string) {
	let user: User;
	try {
		user = await createClient().users.getUser(clerkUserId);
	} catch (error) {
		if (
			isClerkAPIResponseError(error) &&
			error.status === httpStatus.notFound
		) {
			await ctx.runMutation(internal.users.remove, {
				clerkUserIds: [clerkUserId],
			});
			return;
		}
		throw error;
	}
	await storeUsers(ctx, [user]);
}

export const syncCurrent = action({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (identity === null) {
			throw toConvexError("unauthenticated");
		}
		await requireRateLimit(ctx, "userSync", identity.subject);
		const isEnabled: boolean = await ctx.runQuery(internal.users.isEnabled, {
			clerkUserId: identity.subject,
		});
		if (!isEnabled) {
			await syncClerkUser(ctx, identity.subject);
		}
		return null;
	},
});

/** Webhook delivery is not guaranteed, so this runs every hour. */
export const reconcile = internalAction({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const clerk = createClient();

		for (let offset = 0; ; offset += clerkPageSize) {
			const { data } = await clerk.users.getUserList({
				limit: clerkPageSize,
				offset,
				orderBy: "+created_at",
			});
			await storeUsers(ctx, data);
			if (data.length < clerkPageSize) {
				break;
			}
		}

		let cursor: string | null = null;
		for (;;) {
			const page: { page: string[]; isDone: boolean; continueCursor: string } =
				await ctx.runQuery(internal.users.listClerkIds, {
					paginationOpts: { numItems: clerkPageSize, cursor },
				});
			if (page.page.length > 0) {
				const { data } = await clerk.users.getUserList({
					userId: page.page,
					limit: page.page.length,
				});
				const existing = new Set(data.map((user) => user.id));
				const missing = page.page.filter((id) => !existing.has(id));
				if (missing.length > 0) {
					await ctx.runMutation(internal.users.remove, {
						clerkUserIds: missing,
					});
				}
			}
			if (page.isDone) {
				break;
			}
			cursor = page.continueCursor;
		}
		return null;
	},
});
