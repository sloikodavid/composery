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
import { getFakeAddress } from "./fake_address";
import { httpStatus } from "./http_status";
import { requireRateLimit } from "./rate_limits";
import type { userFields } from "./schema";

/** How many accounts Clerk is asked for at once. A test reads it to make Clerk page its answer. */
export const clerkPageSize = 100;
/**
 * How many pages either side may hold before we stop asking. Reading a page is a request to Clerk
 * and a write here, so a page that never says it is the last one must end the run rather than
 * repeat every hour until something else stops it.
 */
const maxPages = 1000;

type UserFields = Infer<typeof userFields>;

/** Clerk's own address, or the fake that a test runs on this machine. */
function createClient() {
	const apiUrl = getFakeAddress(env.CLERK_API_URL, "CLERK_API_URL");
	return createClerkClient({
		secretKey: env.CLERK_SECRET_KEY,
		...(apiUrl === null ? {} : { apiUrl }),
	});
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

		let read = false;
		for (let asked = 0; asked < maxPages && !read; asked += 1) {
			const { data } = await clerk.users.getUserList({
				limit: clerkPageSize,
				offset: asked * clerkPageSize,
				orderBy: "+created_at",
			});
			await storeUsers(ctx, data);
			read = data.length < clerkPageSize;
		}
		if (!read) {
			throw new Error(
				`Clerk still had accounts after ${maxPages} pages, so none were removed.`,
			);
		}

		let cursor: string | null = null;
		for (let asked = 0; asked < maxPages; asked += 1) {
			const page: { page: string[]; isDone: boolean; continueCursor: string } =
				await ctx.runQuery(internal.users.listClerkIds, {
					paginationOpts: { numItems: clerkPageSize, cursor },
				});
			if (page.page.length > 0) {
				const { data } = await clerk.users.getUserList({
					userId: page.page,
					limit: page.page.length,
				});
				// Only an account Clerk was asked about, and did not return, is gone.
				const existing = new Set(data.map((user) => user.id));
				const missing = page.page.filter((id) => !existing.has(id));
				if (missing.length > 0) {
					await ctx.runMutation(internal.users.remove, {
						clerkUserIds: missing,
					});
				}
			}
			if (page.isDone) {
				return null;
			}
			cursor = page.continueCursor;
		}
		throw new Error(
			`Composery still held accounts after ${maxPages} pages of its own.`,
		);
	},
});
