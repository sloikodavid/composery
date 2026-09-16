"use node";

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { env, internalAction } from "../_generated/server";
import {
	envelopeKeyIdBytes,
	envelopeVersion,
	getEnvelopeKeyId,
	isSshAccessEncryptionKey,
	listSshAccessEncryptionKeys,
} from "./encryption_keys";
import { SshAccessError } from "./errors";

const nonceBytes = 12;
// A page of stored values is small, so this is a ceiling on mistakes, not on real deployments.
const maxPages = 1000;
const authTagBytes = 16;
const keyBytes = 32;
const prefixBytes = 1 + envelopeKeyIdBytes;

/** What only Composery may read: the management key it signs in with, and the token the server reports with. */
export type SshAccessSecrets = { privateKey: string; token: string };

/** Names a key by a digest of it, so a stored value can say which key encrypted it. */
export function toEncryptionKeyId(key: string) {
	return createHash("sha256")
		.update(key)
		.digest()
		.subarray(0, envelopeKeyIdBytes)
		.toString("hex");
}

function toKeyBytes(key: string) {
	if (!isSshAccessEncryptionKey(key)) {
		throw new SshAccessError("encryption_key_invalid");
	}
	const bytes = Buffer.from(key, "base64");
	if (bytes.length !== keyBytes) {
		throw new SshAccessError("encryption_key_invalid");
	}
	return bytes;
}

/**
 * What the encryption is bound to. The allocation ID stops a value being moved to another
 * allocation, and the prefix is included so the key a value names cannot be changed without
 * making the value unreadable.
 */
function toAuthenticatedData(allocationId: string, prefix: Buffer) {
	return Buffer.concat([
		Buffer.from(`allocationSshAccess:${allocationId}`),
		prefix,
	]);
}

function toPrefix(keyId: string) {
	return Buffer.concat([
		Buffer.from([envelopeVersion]),
		Buffer.from(keyId, "hex"),
	]);
}

/** Encrypts secrets with the first key in the list, which is the one every new value uses. */
export function encryptSshSecretsWith(
	keys: readonly string[],
	allocationId: string,
	secrets: SshAccessSecrets,
) {
	const [key] = keys;
	if (key === undefined) {
		throw new SshAccessError("encryption_key_missing");
	}
	const prefix = toPrefix(toEncryptionKeyId(key));
	const nonce = randomBytes(nonceBytes);
	const cipher = createCipheriv("aes-256-gcm", toKeyBytes(key), nonce);
	cipher.setAAD(toAuthenticatedData(allocationId, prefix));
	const data = Buffer.concat([
		cipher.update(JSON.stringify(secrets), "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([prefix, nonce, cipher.getAuthTag(), data]).toString(
		"base64",
	);
}

function isSecrets(value: unknown): value is SshAccessSecrets {
	return (
		value !== null &&
		typeof value === "object" &&
		"privateKey" in value &&
		"token" in value &&
		typeof value.privateKey === "string" &&
		typeof value.token === "string"
	);
}

/** Decrypts secrets with whichever key in the list encrypted them. */
export function decryptSshSecretsWith(
	keys: readonly string[],
	allocationId: string,
	encryptedSecrets: string,
): SshAccessSecrets {
	if (keys.length === 0) {
		throw new SshAccessError("encryption_key_missing");
	}
	const bytes = Buffer.from(encryptedSecrets, "base64");
	if (bytes.length < prefixBytes || bytes[0] !== envelopeVersion) {
		throw new SshAccessError("secrets_unreadable");
	}
	const prefix = bytes.subarray(0, prefixBytes);
	const keyId = prefix.subarray(1).toString("hex");
	const key = keys.find((candidate) => toEncryptionKeyId(candidate) === keyId);
	if (key === undefined) {
		// The key that encrypted this is not one the deployment holds any more.
		throw new SshAccessError("encryption_key_unknown");
	}
	try {
		const nonceStart = prefixBytes;
		const tagStart = nonceStart + nonceBytes;
		const dataStart = tagStart + authTagBytes;
		const decipher = createDecipheriv(
			"aes-256-gcm",
			toKeyBytes(key),
			bytes.subarray(nonceStart, tagStart),
		);
		decipher.setAAD(toAuthenticatedData(allocationId, prefix));
		decipher.setAuthTag(bytes.subarray(tagStart, dataStart));
		const secrets: unknown = JSON.parse(
			Buffer.concat([
				decipher.update(bytes.subarray(dataStart)),
				decipher.final(),
			]).toString("utf8"),
		);
		if (!isSecrets(secrets)) {
			throw new Error("The secrets have an unexpected shape.");
		}
		return { privateKey: secrets.privateKey, token: secrets.token };
	} catch (error) {
		if (error instanceof SshAccessError) {
			throw error;
		}
		throw new SshAccessError("secrets_unreadable");
	}
}

/** The same secrets, encrypted again with the key that encrypts now. */
function toReEncrypted(
	keys: readonly string[],
	allocationId: string,
	encryptedSecrets: string,
) {
	return encryptSshSecretsWith(
		keys,
		allocationId,
		decryptSshSecretsWith(keys, allocationId, encryptedSecrets),
	);
}

/** Every key this deployment holds, in the order that decides which one encrypts. */
export function requireSshAccessEncryptionKeys() {
	const keys = listSshAccessEncryptionKeys(env.SSH_ACCESS_ENCRYPTION_KEYS);
	if (keys.length === 0) {
		throw new SshAccessError("encryption_key_missing");
	}
	return keys;
}

export function encryptSshSecrets(
	allocationId: string,
	secrets: SshAccessSecrets,
) {
	return encryptSshSecretsWith(
		requireSshAccessEncryptionKeys(),
		allocationId,
		secrets,
	);
}

export function decryptSshSecrets(
	allocationId: string,
	encryptedSecrets: string,
) {
	return decryptSshSecretsWith(
		requireSshAccessEncryptionKeys(),
		allocationId,
		encryptedSecrets,
	);
}

type EncryptedPage = {
	page: {
		id: Id<"allocationSshAccess">;
		allocationId: Id<"serverAllocations">;
		encryptedSecrets: string;
		pendingEncryptedSecrets: string | null;
	}[];
	isDone: boolean;
	continueCursor: string;
};

/**
 * The same row's envelopes, encrypted again with the key that encrypts now, or null when this
 * deployment holds no key that reads them. One stranded row must not stop the rest being rotated,
 * and the report says how many are stranded and under which key.
 */
function toNextEnvelopes(
	keys: readonly string[],
	row: EncryptedPage["page"][number],
) {
	try {
		return toEncryptedAgain(keys, row);
	} catch {
		return null;
	}
}

function toEncryptedAgain(
	keys: readonly string[],
	row: EncryptedPage["page"][number],
) {
	return {
		encryptedSecrets: toReEncrypted(
			keys,
			row.allocationId,
			row.encryptedSecrets,
		),
		pendingEncryptedSecrets:
			row.pendingEncryptedSecrets === null
				? null
				: toReEncrypted(keys, row.allocationId, row.pendingEncryptedSecrets),
	};
}

/** Adds what a row holds to the tally of which key each stored value still names. */
function countEnvelopes(
	remaining: Map<string, number>,
	held: Readonly<{
		encryptedSecrets: string;
		pendingEncryptedSecrets: string | null;
	}>,
) {
	for (const envelope of [
		held.encryptedSecrets,
		held.pendingEncryptedSecrets,
	]) {
		if (envelope === null) {
			continue;
		}
		const keyId = getEnvelopeKeyId(envelope) ?? "unreadable";
		remaining.set(keyId, (remaining.get(keyId) ?? 0) + 1);
	}
}

type ReEncryptReport = {
	reEncrypted: number;
	skipped: number;
	remaining: { keyId: string; count: number }[];
};

/**
 * Encrypts every stored value again with the key that encrypts now, and reports what is left. Run
 * it after moving a new key to the front of `SSH_ACCESS_ENCRYPTION_KEYS`; when nothing names the
 * old key any more, the old key can be dropped from the list.
 *
 * A row that changed while this ran is left for the next run rather than overwritten: a renewal
 * writes the same fields, and its secrets are the newer ones.
 */
export const reEncrypt = internalAction({
	args: {},
	returns: v.object({
		reEncrypted: v.number(),
		skipped: v.number(),
		remaining: v.array(v.object({ keyId: v.string(), count: v.number() })),
	}),
	handler: async (ctx): Promise<ReEncryptReport> => {
		const keys = requireSshAccessEncryptionKeys();
		let reEncrypted = 0;
		let skipped = 0;
		const remaining = new Map<string, number>();
		let cursor: string | null = null;
		for (let asked = 0; asked < maxPages; asked += 1) {
			const page: EncryptedPage = await ctx.runQuery(
				internal.ssh.secrets_state.listEncrypted,
				{ cursor },
			);
			for (const row of page.page) {
				const next = toNextEnvelopes(keys, row);
				if (next === null) {
					skipped += 1;
					countEnvelopes(remaining, row);
					continue;
				}
				const outcome = await ctx.runMutation(
					internal.ssh.secrets_state.storeReEncrypted,
					{
						id: row.id,
						...next,
						expected: {
							encryptedSecrets: row.encryptedSecrets,
							pendingEncryptedSecrets: row.pendingEncryptedSecrets,
						},
					},
				);
				if (outcome === "stored") {
					reEncrypted += 1;
				} else {
					skipped += 1;
				}
				// What the row holds now: the current key when it was stored, the old one when a
				// renewal got there first. Counting here means no second walk of the table.
				countEnvelopes(remaining, outcome === "stored" ? next : row);
			}
			if (page.isDone) {
				return {
					reEncrypted,
					skipped,
					remaining: [...remaining].map(([keyId, count]) => ({
						keyId,
						count,
					})),
				};
			}
			cursor = page.continueCursor;
		}
		throw new Error(`More than ${maxPages} pages of SSH access remained.`);
	},
});
