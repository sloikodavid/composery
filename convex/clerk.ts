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
/** Clerk's own code for "no such account", which is the only evidence that removes one. */
const clerkAccountGoneCode = "resource_not_found";

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
 * An account as we keep it. Clerk's `id` is who the account is. Clerk makes the primary email
 * address and the picture optional, and lets each change, so each is kept exactly as Clerk sends it
 * and is absent when Clerk sends nothing. Every account is kept: one without an email address
 * simply cannot be found to be shared with, which is the truth and needs no other rule.
 */
function toUserFields(user: User): UserFields {
	const email = user.primaryEmailAddress?.emailAddress;
	return {
		clerkUserId: user.id,
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

/**
 * Whether Clerk itself said the account does not exist. Any other answer with that status is a
 * different thing: an address that is not Clerk, or a proxy in front of it. Removing an account
 * deletes every server it owns, so only Clerk's own code counts.
 */
function isClerkAccountGone(error: unknown) {
	return (
		isClerkAPIResponseError(error) &&
		error.status === httpStatus.notFound &&
		error.errors.some(({ code }) => code === clerkAccountGoneCode)
	);
}

/** The key identifiers a set names, whoever published it. */
function toKeyIds(keys: { kid?: string }[]) {
	return new Set(keys.map(({ kid }) => kid).filter((kid) => kid !== undefined));
}

/**
 * Proves that the secret key and the tokens our clients sign in with belong to one Clerk instance,
 * by the signing keys the two sides publish. A key from another instance answers "no such account"
 * for every account we hold, and that would otherwise delete every server on the deployment.
 */
async function requireOneClerkInstance(clerk: ClerkClient) {
	const clientKeys = await fetch(
		`${env.CLERK_FRONTEND_API_URL}/.well-known/jwks.json`,
	);
	if (!clientKeys.ok) {
		throw new Error(
			`The sign-in keys could not be read: ${clientKeys.status}.`,
		);
	}
	const published = (await clientKeys.json()) as { keys?: { kid?: string }[] };
	const clientKeyIds = toKeyIds(published.keys ?? []);
	const backendKeyIds = toKeyIds((await clerk.jwks.getJwks()).keys ?? []);
	if (![...backendKeyIds].some((keyId) => clientKeyIds.has(keyId))) {
		throw new Error(
			"CLERK_SECRET_KEY and CLERK_FRONTEND_API_URL name different Clerk instances.",
		);
	}
}

/** Reads the current state from Clerk, so the order in which events arrive does not matter. */
export async function syncClerkUser(ctx: ActionCtx, clerkUserId: string) {
	const clerk = createClient();
	let user: User;
	try {
		user = await clerk.users.getUser(clerkUserId);
	} catch (error) {
		if (!isClerkAccountGone(error)) {
			throw error;
		}
		await requireOneClerkInstance(clerk);
		await ctx.runMutation(internal.users.remove, {
			clerkUserIds: [clerkUserId],
		});
		return "removed" as const;
	}
	await storeUsers(ctx, [user]);
	return "stored" as const;
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

/**
 * Reads every account Clerk holds and keeps ours current. A `user.created` nobody delivered is what
 * this is for; an account nobody has signed in as since is only known this way.
 */
async function storeClerkUsers(ctx: ActionCtx, clerk: ClerkClient) {
	for (let asked = 0; asked < maxPages; asked += 1) {
		const { data } = await clerk.users.getUserList({
			limit: clerkPageSize,
			offset: asked * clerkPageSize,
			orderBy: "+created_at",
		});
		await storeUsers(ctx, data);
		if (data.length < clerkPageSize) {
			return;
		}
	}
	throw new Error(`Clerk still had accounts after ${maxPages} pages.`);
}

/** Checks every account we hold against Clerk, and returns how many could not be checked. */
async function checkOurClerkUsers(ctx: ActionCtx, clerk: ClerkClient) {
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
			return unchecked;
		}
		cursor = page.continueCursor;
	}
	throw new Error(
		`Composery still held accounts after ${maxPages} pages of its own.`,
	);
}

/**
 * Webhook delivery is not guaranteed, so this runs every hour. The two halves are independent: an
 * account we hold is checked against Clerk even when reading every account Clerk holds fails, or a
 * deletion nobody delivered would wait for a working list.
 */
export const reconcile = internalAction({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const clerk = createClient();
		const problems: string[] = [];
		try {
			await storeClerkUsers(ctx, clerk);
		} catch (error) {
			problems.push(`reading Clerk's accounts failed: ${String(error)}`);
		}
		try {
			const unchecked = await checkOurClerkUsers(ctx, clerk);
			if (unchecked > 0) {
				problems.push(
					`${unchecked} accounts could not be checked at Clerk, so they stay as they were`,
				);
			}
		} catch (error) {
			problems.push(`checking our accounts failed: ${String(error)}`);
		}
		// Whatever could be done was done, and the run still fails, so the logs show it.
		if (problems.length > 0) {
			throw new Error(problems.join("; "));
		}
		return null;
	},
});
