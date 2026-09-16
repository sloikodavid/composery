import { type ClerkClient, createClerkClient, type User } from "@clerk/backend";
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

/**
 * An account as we keep it. Clerk's `id` is who the account is. Clerk makes the username, the
 * primary email address and the picture optional, and lets each change, so each is kept exactly as
 * Clerk sends it and is absent when Clerk sends nothing. Every account is kept: one without a
 * username simply cannot be found to be shared with, which is the truth and needs no other rule.
 */
function toUserFields(user: User): UserFields {
	const email = user.primaryEmailAddress?.emailAddress;
	return {
		clerkUserId: user.id,
		...(user.username === null ? {} : { username: user.username }),
		...(email === undefined ? {} : { email }),
		// biome-ignore lint/suspicious/noUnnecessaryConditions: Clerk's own description makes image_url optional, and its client passes the field straight through, so the type says string where undefined can arrive
		...(user.imageUrl === undefined ? {} : { imageUrl: user.imageUrl }),
	};
}

async function storeUsers(ctx: ActionCtx, users: User[]) {
	if (users.length > 0) {
		await ctx.runMutation(internal.users.store, {
			users: users.map(toUserFields),
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
		// A person signed in to Clerk before its webhook reached us has no account here yet.
		const isSynced: boolean = await ctx.runQuery(internal.users.isSynced, {
			clerkUserId: identity.subject,
		});
		if (!isSynced) {
			await syncClerkUser(ctx, identity.subject);
		}
		return null;
	},
});

/**
 * Checks accounts the list did not return, one direct read each, and returns how many could not be
 * checked.
 *
 * A list that leaves an account out is weak evidence that it is gone: an answer can be short for
 * reasons that have nothing to do with the account. Removing somebody deletes every server they
 * own, so it needs the evidence the webhook acts on: a direct read that says the account does not
 * exist. One account that cannot be checked must not keep the accounts after it from being checked.
 */
async function syncUnlistedClerkUsers(
	ctx: ActionCtx,
	clerk: ClerkClient,
	clerkUserIds: string[],
) {
	const { data } = await clerk.users.getUserList({
		userId: clerkUserIds,
		limit: clerkUserIds.length,
	});
	const listed = new Set(data.map((user) => user.id));
	let unchecked = 0;
	for (const clerkUserId of clerkUserIds) {
		if (!listed.has(clerkUserId)) {
			try {
				await syncClerkUser(ctx, clerkUserId);
			} catch {
				unchecked += 1;
			}
		}
	}
	return unchecked;
}

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
		let unchecked = 0;
		for (let asked = 0; asked < maxPages; asked += 1) {
			const page: { page: string[]; isDone: boolean; continueCursor: string } =
				await ctx.runQuery(internal.users.listClerkIds, {
					paginationOpts: { numItems: clerkPageSize, cursor },
				});
			if (page.page.length > 0) {
				unchecked += await syncUnlistedClerkUsers(ctx, clerk, page.page);
			}
			if (page.isDone) {
				// The accounts after it were checked, and the run still fails, so the logs show it.
				if (unchecked > 0) {
					throw new Error(
						`${unchecked} accounts could not be checked at Clerk, so they stay as they were.`,
					);
				}
				return null;
			}
			cursor = page.continueCursor;
		}
		throw new Error(
			`Composery still held accounts after ${maxPages} pages of its own.`,
		);
	},
});
