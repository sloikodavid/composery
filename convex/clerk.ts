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

/** Page size used for both list reads and their bounded pagination. */
export const clerkPageSize = 100;
// Bound a malformed or non-terminating pagination response.
const maxPages = 1000;
// Only Clerk's own not-found code permits deletion.
const clerkAccountGoneCode = "resource_not_found";

type UserFields = Infer<typeof userFields>;

function createClient() {
	const apiUrl = getFakeAddress(env.CLERK_API_URL, "CLERK_API_URL");
	return createClerkClient({
		secretKey: env.CLERK_SECRET_KEY,
		...(apiUrl === null ? {} : { apiUrl }),
	});
}

function toUserFields(user: User): UserFields {
	// Optional Clerk fields are omitted rather than stored as stale values.
	const email = user.primaryEmailAddress?.emailAddress;
	return {
		clerkUserId: user.id,
		...(email === undefined ? {} : { email }),
		// biome-ignore lint/suspicious/noUnnecessaryConditions: Clerk may omit image_url
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

function isClerkAccountGone(error: unknown) {
	// A proxy or another Clerk instance must not delete local servers.
	return (
		isClerkAPIResponseError(error) &&
		error.status === httpStatus.notFound &&
		error.errors.some(({ code }) => code === clerkAccountGoneCode)
	);
}

function toKeyIds(keys: { kid?: string }[]) {
	return new Set(keys.map(({ kid }) => kid).filter((kid) => kid !== undefined));
}

async function requireOneClerkInstance(clerk: ClerkClient) {
	// Match the backend secret to the issuer's signing keys before reconciling deletions.
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
		// A sign-in can arrive before its webhook.
		const isSynced: boolean = await ctx.runQuery(internal.users.isSynced, {
			clerkUserId: identity.subject,
		});
		if (!isSynced) {
			await syncClerkUser(ctx, identity.subject);
		}
		return null;
	},
});

async function syncUnlistedClerkUsers(
	ctx: ActionCtx,
	clerk: ClerkClient,
	clerkUserIds: string[],
) {
	// A missing list entry is weak evidence; confirm each account with a direct read.
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

export const reconcile = internalAction({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		// Webhooks are not guaranteed, so reconcile both directions independently.
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
		if (problems.length > 0) {
			throw new Error(problems.join("; "));
		}
		return null;
	},
});
