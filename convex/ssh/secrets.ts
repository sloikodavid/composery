"use node";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../_generated/server";
import { isSshAccessEncryptionKey } from "./access_state";
import { SshAccessError } from "./errors";

const nonceBytes = 12;
const authTagBytes = 16;

/** What only Composery may read: the management key it signs in with, and the token the server reports with. */
export type SshAccessSecrets = { privateKey: string; token: string };

function getEncryptionKey() {
	const value = env.SSH_ACCESS_ENCRYPTION_KEY;
	if (!value) {
		throw new SshAccessError("encryption_key_missing");
	}
	if (!isSshAccessEncryptionKey(value)) {
		throw new SshAccessError("encryption_key_invalid");
	}
	return Buffer.from(value, "base64");
}

// Binding the allocation ID as authenticated data prevents moving secrets to another allocation.
function toAuthenticatedData(allocationId: string) {
	return Buffer.from(`allocationSshAccess:${allocationId}`);
}

export function encryptSshSecrets(
	allocationId: string,
	secrets: SshAccessSecrets,
) {
	const nonce = randomBytes(nonceBytes);
	const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
	cipher.setAAD(toAuthenticatedData(allocationId));
	const data = Buffer.concat([
		cipher.update(JSON.stringify(secrets), "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSshSecrets(
	allocationId: string,
	encryptedSecrets: string,
): SshAccessSecrets {
	try {
		const bytes = Buffer.from(encryptedSecrets, "base64");
		const dataStart = nonceBytes + authTagBytes;
		const decipher = createDecipheriv(
			"aes-256-gcm",
			getEncryptionKey(),
			bytes.subarray(0, nonceBytes),
		);
		decipher.setAAD(toAuthenticatedData(allocationId));
		decipher.setAuthTag(bytes.subarray(nonceBytes, dataStart));
		const secrets: unknown = JSON.parse(
			Buffer.concat([
				decipher.update(bytes.subarray(dataStart)),
				decipher.final(),
			]).toString("utf8"),
		);
		if (
			secrets === null ||
			typeof secrets !== "object" ||
			!("privateKey" in secrets) ||
			!("token" in secrets) ||
			typeof secrets.privateKey !== "string" ||
			typeof secrets.token !== "string"
		) {
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
