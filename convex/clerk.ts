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
const maxPages = 100;
const maxFailedPages = 3;
// Only Clerk's own not-found code permits deletion.
const clerkAccountGoneCode = "resource_not_found";

type UserFields = Infer<typeof userFields>;

function createClient() {
	const apiUrl = getFakeAddress(env.CLERK_FAKE_URL, "CLERK_FAKE_URL");
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

async function storeUsers(ctx: ActionCtx, users: User[], epoch: number) {
	if (users.length > 0) {
		await ctx.runMutation(internal.users.store, {
			users: users.map(toUserFields),
			epoch,
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

type ClerkRsaKey = {
	kid: string;
	kty: string;
	n: string;
	e: string;
};

function toKeyMaterial(value: unknown, source: string) {
	if (!Array.isArray(value)) {
		throw new Error(`${source} returned an invalid signing-key list.`);
	}
	const keyMaterial = new Set<string>();
	for (const key of value) {
		if (key === null || typeof key !== "object") {
			continue;
		}
		const record = key as Record<string, unknown>;
		if (
			typeof record.kid !== "string" ||
			typeof record.kty !== "string" ||
			typeof record.n !== "string" ||
			typeof record.e !== "string" ||
			record.kid.length === 0 ||
			record.n.length === 0 ||
			record.e.length === 0
		) {
			continue;
		}
		if (record.kty !== "RSA") {
			continue;
		}
		const fields: ClerkRsaKey = {
			kid: record.kid,
			kty: record.kty,
			n: record.n,
			e: record.e,
		};
		// The ID and RSA public material identify the same signing key. The JWK alg field is metadata.
		keyMaterial.add(
			JSON.stringify([fields.kid, fields.kty, fields.n, fields.e]),
		);
	}
	return keyMaterial;
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
	const published = (await clientKeys.json()) as unknown;
	const publishedKeys =
		published !== null && typeof published === "object"
			? (published as { keys?: unknown }).keys
			: undefined;
	const clientKeyMaterial = toKeyMaterial(publishedKeys, "The sign-in issuer");
	const backend = await clerk.jwks.getJwks();
	const backendKeyMaterial = toKeyMaterial(backend.keys, "The Clerk backend");
	if (![...backendKeyMaterial].some((key) => clientKeyMaterial.has(key))) {
		throw new Error(
			"CLERK_SECRET_KEY and CLERK_FRONTEND_API_URL name different Clerk instances.",
		);
	}
}

export async function syncClerkUser(ctx: ActionCtx, clerkUserId: string) {
	const clerk = createClient();
	const epoch: number | null = await ctx.runMutation(
		internal.users.issueUserEpoch,
		{ clerkUserId },
	);
	if (epoch === null) {
		return "removed" as const;
	}
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
			epoch,
		});
		return "removed" as const;
	}
	await storeUsers(ctx, [user], epoch);
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
	let failedPages = 0;
	for (let asked = 0; asked < maxPages; asked += 1) {
		const epoch: number = await ctx.runMutation(
			internal.users.issueListEpoch,
			{},
		);
		let data: User[];
		try {
			({ data } = await clerk.users.getUserList({
				limit: clerkPageSize,
				offset: asked * clerkPageSize,
				orderBy: "+created_at",
			}));
		} catch {
			failedPages += 1;
			// Offset pagination still lets later pages be checked independently.
			if (failedPages >= maxFailedPages) {
				return failedPages;
			}
			continue;
		}
		await storeUsers(ctx, data, epoch);
		if (data.length < clerkPageSize) {
			return failedPages;
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
			try {
				unchecked += await syncUnlistedClerkUsers(ctx, clerk, page.page);
			} catch {
				// A failed external page must not prevent later local pages from checking.
				unchecked += page.page.length;
			}
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
			const failedPages = await storeClerkUsers(ctx, clerk);
			if (failedPages > 0) {
				problems.push(
					`${failedPages} Clerk account pages could not be read, so those accounts stay as they were`,
				);
			}
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
