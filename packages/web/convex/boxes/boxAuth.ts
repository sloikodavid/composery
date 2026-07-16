import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery
} from "../_generated/server";
import { requireActiveUserInAction } from "../authorization";
import { cloudUrl } from "../env";
import { startBoxOperation } from "./boxOperations";

const AUTHORIZATION_CODE_TTL_MS = 2 * 60_000;
const SETUP_GRANT_TTL_MS = 10 * 60_000;
const PASSWORD_RECONCILE_DELAY_MS = 5_000;
const PASSWORD_RECONCILE_RETRY_MS = 60_000;
const PASSWORD_RECONCILE_MAX_ATTEMPTS = 20;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ARGON2ID_PATTERN = /^\$argon2id\$/;

function bytes(length: number) {
	const value = new Uint8Array(length);
	crypto.getRandomValues(value);
	return value;
}

function base64url(value: Uint8Array) {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

async function sha256(value: string) {
	return base64url(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
		)
	);
}

function callbackUrl(box: Doc<"boxes">) {
	return new URL("/_composery/cloud/callback", cloudUrl(box.slug)).toString();
}

export const createAuthorizationCode = action({
	args: {
		boxId: v.id("boxes"),
		codeChallenge: v.string()
	},
	returns: v.object({ code: v.string(), redirectUri: v.string() }),
	handler: async (ctx, args) => {
		const user = await requireActiveUserInAction(ctx);
		if (!BASE64URL_SHA256_PATTERN.test(args.codeChallenge)) {
			throw new ConvexError("Invalid authorization request.");
		}

		const box = await ctx.runQuery(internal.boxes.boxAuth.boxForAuthorization, {
			boxId: args.boxId
		});
		if (!box || box.user_id !== user.clerk_user_id || box.deleted_at) {
			throw new ConvexError("Box not found.");
		}

		// A configured password does not block authorization: the owner proved
		// ownership right here, so re-running the flow is how password recovery
		// and changes work on cloud boxes.
		const code = base64url(bytes(32));
		const redirectUri = callbackUrl(box);
		await ctx.runMutation(internal.boxes.boxAuth.storeAuthorizationCode, {
			boxId: box._id,
			codeHash: await sha256(code),
			codeChallenge: args.codeChallenge,
			redirectUri
		});
		return { code, redirectUri };
	}
});

export const exchangeAuthorizationCode = action({
	args: {
		boxId: v.id("boxes"),
		code: v.string(),
		codeVerifier: v.string(),
		redirectUri: v.string()
	},
	returns: v.object({ grant: v.string() }),
	handler: async (ctx, args) => {
		if (
			!BASE64URL_SHA256_PATTERN.test(args.code) ||
			!BASE64URL_SHA256_PATTERN.test(args.codeVerifier) ||
			args.redirectUri.length > 512
		) {
			throw new ConvexError("Invalid authorization code.");
		}
		const grant = base64url(bytes(32));
		await ctx.runMutation(internal.boxes.boxAuth.exchangeCode, {
			boxId: args.boxId,
			codeHash: await sha256(args.code),
			codeChallenge: await sha256(args.codeVerifier),
			redirectUri: args.redirectUri,
			grantHash: await sha256(grant)
		});
		return { grant };
	}
});

export const installPassword = action({
	args: {
		boxId: v.id("boxes"),
		grant: v.string(),
		runtimeAuthHash: v.string()
	},
	returns: v.object({ accepted: v.boolean() }),
	handler: async (ctx, args) => {
		if (
			!BASE64URL_SHA256_PATTERN.test(args.grant) ||
			!ARGON2ID_PATTERN.test(args.runtimeAuthHash) ||
			args.runtimeAuthHash.length > 512
		) {
			throw new ConvexError("Invalid password hash.");
		}
		await ctx.runMutation(internal.boxes.boxAuth.claimGrantForPassword, {
			boxId: args.boxId,
			grantHash: await sha256(args.grant),
			runtimeAuthHash: args.runtimeAuthHash
		});
		return { accepted: true };
	}
});

export const boxForAuthorization = internalQuery({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => await ctx.db.get(args.boxId)
});

export const storeAuthorizationCode = internalMutation({
	args: {
		boxId: v.id("boxes"),
		codeHash: v.string(),
		codeChallenge: v.string(),
		redirectUri: v.string()
	},
	handler: async (ctx, args) => {
		const timestamp = Date.now();
		await ctx.db.insert("box_auth_codes", {
			box_id: args.boxId,
			code_hash: args.codeHash,
			code_challenge: args.codeChallenge,
			redirect_uri: args.redirectUri,
			expires_at: timestamp + AUTHORIZATION_CODE_TTL_MS,
			created_at: timestamp
		});
	}
});

export const exchangeCode = internalMutation({
	args: {
		boxId: v.id("boxes"),
		codeHash: v.string(),
		codeChallenge: v.string(),
		redirectUri: v.string(),
		grantHash: v.string()
	},
	handler: async (ctx, args) => {
		const code = await ctx.db
			.query("box_auth_codes")
			.withIndex("code_hash", (query) => query.eq("code_hash", args.codeHash))
			.unique();
		const timestamp = Date.now();
		if (
			!code ||
			code.box_id !== args.boxId ||
			code.consumed_at ||
			code.expires_at <= timestamp ||
			code.code_challenge !== args.codeChallenge ||
			code.redirect_uri !== args.redirectUri
		) {
			throw new ConvexError("Invalid or expired authorization code.");
		}

		await ctx.db.patch(code._id, { consumed_at: timestamp });
		await ctx.db.insert("box_auth_grants", {
			box_id: args.boxId,
			token_hash: args.grantHash,
			expires_at: timestamp + SETUP_GRANT_TTL_MS,
			created_at: timestamp
		});
	}
});

export const claimGrantForPassword = internalMutation({
	args: {
		boxId: v.id("boxes"),
		grantHash: v.string(),
		runtimeAuthHash: v.string()
	},
	handler: async (ctx, args) => {
		const grant = await ctx.db
			.query("box_auth_grants")
			.withIndex("token_hash", (query) =>
				query.eq("token_hash", args.grantHash)
			)
			.unique();
		const timestamp = Date.now();
		if (
			!grant ||
			grant.box_id !== args.boxId ||
			grant.expires_at <= timestamp ||
			(grant.consumed_at && grant.runtime_auth_hash !== args.runtimeAuthHash)
		) {
			throw new ConvexError("Invalid or expired setup grant.");
		}

		const box = await ctx.db.get(args.boxId);
		if (!box || box.deleted_at) {
			throw new ConvexError("Box not found.");
		}
		if (!grant.consumed_at) {
			await ctx.db.patch(grant._id, {
				consumed_at: timestamp,
				runtime_auth_hash: args.runtimeAuthHash
			});
		}
		await ctx.db.patch(box._id, {
			runtime_auth_hash: grant.runtime_auth_hash ?? args.runtimeAuthHash,
			password_setup_pending_at: timestamp,
			updated_at: timestamp
		});
		await ctx.scheduler.runAfter(
			PASSWORD_RECONCILE_DELAY_MS,
			internal.boxes.boxAuth.reconcilePassword,
			{
				boxId: grant.box_id,
				idempotencyKey: `password:${grant._id}`,
				runtimeAuthHash: grant.runtime_auth_hash ?? args.runtimeAuthHash,
				attempt: 1
			}
		);
	}
});

export const reconcilePassword = internalAction({
	args: {
		boxId: v.id("boxes"),
		idempotencyKey: v.string(),
		runtimeAuthHash: v.string(),
		attempt: v.number()
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(internal.boxes.boxAuth.boxForAuthorization, {
			boxId: args.boxId
		});
		if (
			!box ||
			box.deleted_at ||
			box.runtime_auth_hash !== args.runtimeAuthHash
		) {
			return;
		}

		try {
			await startBoxOperation(ctx, box._id, "change_password", {
				idempotencyKey: args.idempotencyKey,
				workflowArgs: { runtimeAuthHash: args.runtimeAuthHash }
			});
		} catch (error) {
			if (args.attempt >= PASSWORD_RECONCILE_MAX_ATTEMPTS) throw error;
			await ctx.scheduler.runAfter(
				PASSWORD_RECONCILE_RETRY_MS,
				internal.boxes.boxAuth.reconcilePassword,
				{ ...args, attempt: args.attempt + 1 }
			);
		}
	}
});

export const deleteExpiredAuthRecords = internalMutation({
	args: {},
	handler: async (ctx) => {
		const timestamp = Date.now();
		let deleted = 0;
		for (const table of ["box_auth_codes", "box_auth_grants"] as const) {
			const rows = await ctx.db
				.query(table)
				.withIndex("expires_at", (query) => query.lt("expires_at", timestamp))
				.take(200);
			for (const row of rows) {
				await ctx.db.delete(row._id as Id<typeof table>);
				deleted += 1;
			}
		}
		return deleted;
	}
});
