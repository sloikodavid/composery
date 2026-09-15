"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { type ActionCtx, action } from "../_generated/server";
import { type ErrorCode, toConvexError } from "../errors";
import { requireSshConnection } from "./access";
import { discoverSshAccounts } from "./accounts";
import {
	type AuthorizedKeysEdit,
	AuthorizedKeysFile,
	type AuthorizedKeysLine,
} from "./authorized_keys";
import {
	type SshConnectionOptions,
	SshError,
	type SshFailure,
} from "./connection";
import { readSshFile } from "./read_file";
import { type SshFileWriteResult, writeSshFile } from "./write_file";

const maxFileBytes = 131_072;
const maxFilesRead = 10;
const maxEdits = 64;

// biome-ignore-start lint/style/useNamingConvention: SSH failures and error codes use snake_case
/** Every way the machine can refuse, stated as one public code. */
const failureCodes: Record<SshFailure, ErrorCode> = {
	aborted: "machine_unreachable",
	authentication_failed: "machine_unreachable",
	changed_during_read: "file_changed",
	command_unavailable: "machine_unsupported",
	connection_closed: "machine_unreachable",
	connection_failed: "machine_unreachable",
	deadline_exceeded: "machine_unreachable",
	file_missing: "file_unwritable",
	host_key_mismatch: "machine_unreachable",
	invalid_request: "edit_invalid",
	invalid_response: "machine_unsupported",
	not_regular_file: "file_unwritable",
	output_limit: "machine_unsupported",
	permission_denied: "file_unwritable",
	remote_error: "machine_unreachable",
	sftp_unavailable: "machine_unsupported",
	too_large: "file_unwritable",
};

/** Every outcome the write program reports, stated as one public code. */
const writeCodes: Record<SshFileWriteResult["status"], ErrorCode | null> = {
	busy: "file_changed",
	changed: "file_changed",
	command_unavailable: "machine_unsupported",
	deadline_exceeded: "machine_unreachable",
	file_missing: "file_unwritable",
	invalid_request: "edit_invalid",
	metadata_not_preserved: "file_unwritable",
	permission_denied: "file_unwritable",
	too_large: "file_unwritable",
	uncertain: "edit_uncertain",
	unchanged: null,
	unsupported_file: "file_unwritable",
	write_failed: "file_unwritable",
	written: null,
};
// biome-ignore-end lint/style/useNamingConvention: SSH failures and error codes use snake_case

type KeyFileListing = {
	files: Awaited<ReturnType<typeof readKeyFile>>[];
	limits: string[];
};

const authorizedKey = v.object({
	type: v.string(),
	base64: v.string(),
});

const keyLine = v.object({
	line: v.number(),
	kind: v.union(
		v.literal("entry"),
		v.literal("comment"),
		v.literal("blank"),
		v.literal("opaque"),
	),
	fingerprint: v.union(v.string(), v.null()),
	keyType: v.union(v.string(), v.null()),
	comment: v.union(v.string(), v.null()),
	options: v.array(v.string()),
});

const keyFile = v.object({
	account: v.string(),
	path: v.string(),
	/** What the file held when it was read. Every edit names it, and a stale one is refused. */
	revision: v.string(),
	lines: v.array(keyLine),
});

function toPublicError(error: unknown): never {
	if (error instanceof SshError) {
		throw toConvexError(failureCodes[error.code]);
	}
	throw error;
}

function toRevision(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

function toFingerprint(base64: string) {
	const digest = createHash("sha256")
		.update(Buffer.from(base64, "base64"))
		.digest("base64");
	return `SHA256:${digest.replaceAll("=", "")}`;
}

function toKeyLine(line: AuthorizedKeysLine) {
	const entry = line.kind === "entry" ? line.entry : null;
	return {
		line: line.line,
		kind: line.kind === "opaque" ? ("opaque" as const) : line.kind,
		fingerprint: entry === null ? null : toFingerprint(entry.key.base64),
		keyType: entry?.key.type ?? null,
		comment: entry?.comment ?? null,
		options: entry === null ? [] : entry.options.map((option) => option.raw),
	};
}

async function requireConnection(ctx: ActionCtx, serverId: string) {
	const allocation: Doc<"serverAllocations"> = await ctx.runQuery(
		internal.servers.permissions.requireSshAccess,
		{ serverId: serverId as Doc<"servers">["_id"] },
	);
	return await requireSshConnection(ctx, allocation);
}

async function readKeyFile(
	connection: SshConnectionOptions,
	account: string,
	path: string,
) {
	const observation = await readSshFile({
		...connection,
		path,
		maxBytes: maxFileBytes,
	});
	const file = new AuthorizedKeysFile(observation.bytes);
	return {
		account,
		path,
		revision: toRevision(observation.bytes),
		lines: file.lines.map(toKeyLine),
	};
}

/**
 * Reads the key files that the machine says apply, as they are right now. Composery keeps no
 * copy: a later edit names the revision it saw, and the machine refuses a stale one.
 */
export const list = action({
	args: { serverId: v.id("servers") },
	returns: v.object({
		files: v.array(keyFile),
		limits: v.array(v.string()),
	}),
	handler: async (ctx, { serverId }): Promise<KeyFileListing> => {
		const connection = await requireConnection(ctx, serverId);
		try {
			const machine = await discoverSshAccounts(connection);
			const files: KeyFileListing["files"] = [];
			for (const account of machine.accounts) {
				for (const source of account.sources) {
					if (
						source.kind === "file" &&
						source.state === "present" &&
						files.length < maxFilesRead
					) {
						files.push(
							await readKeyFile(connection, account.name, source.path),
						);
					}
				}
			}
			return { files, limits: [...machine.limits] };
		} catch (error) {
			return toPublicError(error);
		}
	},
});

async function applyEdits(
	ctx: ActionCtx,
	request: {
		serverId: string;
		path: string;
		revision: string;
		edits: readonly AuthorizedKeysEdit[];
	},
) {
	if (request.edits.length === 0 || request.edits.length > maxEdits) {
		throw toConvexError("edit_invalid");
	}
	const connection = await requireConnection(ctx, request.serverId);
	try {
		const observation = await readSshFile({
			...connection,
			path: request.path,
			maxBytes: maxFileBytes,
		});
		if (toRevision(observation.bytes) !== request.revision) {
			throw toConvexError("file_changed");
		}
		const file = new AuthorizedKeysFile(observation.bytes);
		const plan = file.plan(observation.bytes, request.edits);
		if (!plan.ok) {
			throw toConvexError(
				plan.reason === "changed" ? "file_changed" : "edit_invalid",
			);
		}
		const result = await writeSshFile(
			connection,
			request.path,
			observation,
			plan.candidate,
		);
		const code = writeCodes[result.status];
		if (code !== null) {
			throw toConvexError(code);
		}
		return { revision: toRevision(plan.candidate) };
	} catch (error) {
		return toPublicError(error);
	}
}

export const add = action({
	args: {
		serverId: v.id("servers"),
		path: v.string(),
		revision: v.string(),
		key: authorizedKey,
		options: v.array(v.string()),
		comment: v.string(),
	},
	returns: v.object({ revision: v.string() }),
	handler: async (
		ctx,
		{ serverId, path, revision, key, options, comment },
	): Promise<{ revision: string }> =>
		await applyEdits(ctx, {
			serverId,
			path,
			revision,
			edits: [{ kind: "append", key, options, comment }],
		}),
});

export const update = action({
	args: {
		serverId: v.id("servers"),
		path: v.string(),
		revision: v.string(),
		line: v.number(),
		key: v.optional(authorizedKey),
		options: v.optional(v.array(v.string())),
		comment: v.optional(v.string()),
	},
	returns: v.object({ revision: v.string() }),
	handler: async (
		ctx,
		{ serverId, path, revision, line, key, options, comment },
	): Promise<{ revision: string }> =>
		await applyEdits(ctx, {
			serverId,
			path,
			revision,
			edits: [
				{
					kind: "update",
					line,
					...(key === undefined ? {} : { key }),
					...(options === undefined ? {} : { options }),
					...(comment === undefined ? {} : { comment }),
				},
			],
		}),
});

export const remove = action({
	args: {
		serverId: v.id("servers"),
		path: v.string(),
		revision: v.string(),
		lines: v.array(v.number()),
	},
	returns: v.object({ revision: v.string() }),
	handler: async (
		ctx,
		{ serverId, path, revision, lines },
	): Promise<{ revision: string }> =>
		await applyEdits(ctx, {
			serverId,
			path,
			revision,
			edits: lines.map((line) => ({ kind: "remove" as const, line })),
		}),
});
