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
const maxPages = 1000;
const authTagBytes = 16;
const keyBytes = 32;
const prefixBytes = 1 + envelopeKeyIdBytes;

export type SshAccessSecrets = { privateKey: string; token: string };

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

function toAuthenticatedData(allocationId: string, prefix: Buffer) {
	// Bind ciphertext to its allocation and key identifier.
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

/** Re-encrypts with the current key and reports rows whose old key is still required. */
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
