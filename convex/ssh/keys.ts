"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { type ActionCtx, action } from "../_generated/server";
import { toConvexError } from "../errors";
import { requireSshConnection } from "./access";
import {
	type AuthorizedKeysEdit,
	AuthorizedKeysFile,
	type AuthorizedKeysLine,
} from "./authorized_keys";
import type { SshConnectionOptions } from "./connection";
import { discoverSshServer } from "./discovery";
import { rethrowPublicSshError, writeCodes } from "./failures";
import { discoverSshKeyAcceptance } from "./key_acceptance";
import { readSshFile, type SshFileObservation } from "./read_file";
import { writeSshFile } from "./write_file";

const maxFileBytes = 131_072;
const maxFilesRead = 10;
const maxEdits = 64;

type KeyFileListing = {
	files: Awaited<ReturnType<typeof readKeyFile>>[];
	unknowns: string[];
};

const acceptance = v.union(
	v.literal("accepted"),
	v.literal("refused"),
	v.literal("unknown"),
);

type Acceptance = "accepted" | "refused" | "unknown";

type AcceptanceQuestion = Readonly<{
	account: string;
	/** The key and options that the edited line holds afterwards, from the file as it was read. */
	toEntry: (file: AuthorizedKeysFile) => Readonly<{
		key: Readonly<{ type: string; base64: string }>;
		options: readonly string[];
	}> | null;
}>;

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

/**
 * Names one state of one file: its bytes and the metadata around them. Metadata belongs in it
 * because bytes alone repeat: a file restored to what it held before would otherwise let a
 * request that was planned against that earlier state apply a second time.
 */
function toRevision(observation: SshFileObservation) {
	const { size, uid, gid, mode, mtime } = observation.attributes;
	return createHash("sha256")
		.update(observation.bytes)
		.update(`:${size}:${uid}:${gid}:${mode}:${mtime}`)
		.digest("hex");
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

async function requireConnection(ctx: ActionCtx, serverId: Id<"servers">) {
	const allocation: Doc<"serverAllocations"> = await ctx.runQuery(
		internal.ssh.permissions.requireAllocation,
		{ serverId },
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
		revision: toRevision(observation),
		lines: file.lines.map(toKeyLine),
	};
}

/**
 * Reads the key files that the server says apply, as they are right now. Composery keeps no
 * copy: a later edit names the revision it saw, and the server refuses a stale one.
 */
export const list = action({
	args: { serverId: v.id("servers") },
	returns: v.object({
		files: v.array(keyFile),
		unknowns: v.array(v.string()),
	}),
	handler: async (ctx, { serverId }): Promise<KeyFileListing> => {
		const connection = await requireConnection(ctx, serverId);
		try {
			const discovery = await discoverSshServer(connection);
			const files: KeyFileListing["files"] = [];
			const unknowns = [...discovery.unknowns];
			let skipped = 0;
			for (const account of discovery.accounts) {
				for (const source of account.sources) {
					if (source.kind !== "file" || source.state !== "present") {
						continue;
					}
					if (files.length >= maxFilesRead) {
						skipped += 1;
						continue;
					}
					files.push(await readKeyFile(connection, account.name, source.path));
				}
			}
			if (skipped > 0) {
				unknowns.push(
					`This server has more key files than one listing reads, and ${skipped} of them are not shown.`,
				);
			}
			return { files, unknowns };
		} catch (error) {
			return rethrowPublicSshError(error);
		}
	},
});

/**
 * Asks the running server about the key an edit left behind. The server judges from Composery's
 * address, so a key limited to other addresses cannot be answered for; and a write that succeeded
 * stays a success when the question itself fails.
 */
async function getKeyAcceptance(
	connection: SshConnectionOptions,
	account: string,
	entry: ReturnType<AcceptanceQuestion["toEntry"]>,
): Promise<Acceptance> {
	if (
		entry === null ||
		entry.options.some((option) =>
			option.trim().toLowerCase().startsWith("from="),
		)
	) {
		return "unknown";
	}
	try {
		return await discoverSshKeyAcceptance(
			{ ...connection, username: account },
			entry.key,
		);
	} catch {
		return "unknown";
	}
}

async function applyEdits(
	ctx: ActionCtx,
	request: {
		serverId: Id<"servers">;
		path: string;
		revision: string;
		edits: readonly AuthorizedKeysEdit[];
		question?: AcceptanceQuestion;
	},
): Promise<{ revision: string | null; acceptance: Acceptance | null }> {
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
		if (toRevision(observation) !== request.revision) {
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
		const acceptanceResult =
			request.question === undefined
				? null
				: await getKeyAcceptance(
						connection,
						request.question.account,
						request.question.toEntry(file),
					);
		// The written file names its own new state; a read that fails leaves the caller to list again.
		try {
			return {
				revision: toRevision(
					await readSshFile({
						...connection,
						path: request.path,
						maxBytes: maxFileBytes,
					}),
				),
				acceptance: acceptanceResult,
			};
		} catch {
			return { revision: null, acceptance: acceptanceResult };
		}
	} catch (error) {
		return rethrowPublicSshError(error);
	}
}

export const add = action({
	args: {
		serverId: v.id("servers"),
		account: v.string(),
		path: v.string(),
		revision: v.string(),
		key: authorizedKey,
		options: v.array(v.string()),
		comment: v.string(),
	},
	returns: v.object({
		revision: v.union(v.string(), v.null()),
		acceptance,
	}),
	handler: async (
		ctx,
		{ serverId, account, path, revision, key, options, comment },
	): Promise<{ revision: string | null; acceptance: Acceptance }> => {
		const result = await applyEdits(ctx, {
			serverId,
			path,
			revision,
			edits: [{ kind: "append", key, options, comment }],
			question: { account, toEntry: () => ({ key, options }) },
		});
		return {
			revision: result.revision,
			acceptance: result.acceptance ?? "unknown",
		};
	},
});

export const update = action({
	args: {
		serverId: v.id("servers"),
		account: v.string(),
		path: v.string(),
		revision: v.string(),
		line: v.number(),
		key: v.optional(authorizedKey),
		options: v.optional(v.array(v.string())),
		comment: v.optional(v.string()),
	},
	returns: v.object({
		revision: v.union(v.string(), v.null()),
		acceptance,
	}),
	handler: async (
		ctx,
		{ serverId, account, path, revision, line, key, options, comment },
	): Promise<{ revision: string | null; acceptance: Acceptance }> => {
		const result = await applyEdits(ctx, {
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
			question: {
				account,
				toEntry: (file) => {
					const current = file.lines.find(
						(candidate) => candidate.line === line,
					);
					if (current?.kind !== "entry") {
						return null;
					}
					return {
						key: key ?? current.entry.key,
						options:
							options ?? current.entry.options.map((option) => option.raw),
					};
				},
			},
		});
		return {
			revision: result.revision,
			acceptance: result.acceptance ?? "unknown",
		};
	},
});

export const remove = action({
	args: {
		serverId: v.id("servers"),
		path: v.string(),
		revision: v.string(),
		lines: v.array(v.number()),
	},
	returns: v.object({ revision: v.union(v.string(), v.null()) }),
	handler: async (
		ctx,
		{ serverId, path, revision, lines },
	): Promise<{ revision: string | null }> => {
		const result = await applyEdits(ctx, {
			serverId,
			path,
			revision,
			edits: lines.map((line) => ({ kind: "remove" as const, line })),
		});
		return { revision: result.revision };
	},
});
