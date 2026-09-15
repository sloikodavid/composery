"use node";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { v } from "convex/values";
import ssh2 from "ssh2";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { type ActionCtx, action, env } from "../_generated/server";
import { toConvexError } from "../errors";
import {
	bootstrapLifetimeMs,
	isSshAccessEncryptionKey,
	toBootstrapTokenDigest,
} from "./access_state";
import { toSshBootstrapCommand } from "./bootstrap_command";
import type { SshBootstrapFile } from "./cloud_init";
import type { SshConnectionOptions } from "./connection";

const { utils } = ssh2;

const bootstrapTokenBytes = 32;
const nonceBytes = 12;
const authTagBytes = 16;
const sshPort = 22;
const connectionTimeoutMs = 30_000;

type AllocationSshAccess = Doc<"allocationSshAccess">;
type SshAccessSecrets = { privateKey: string; token: string };

export class SshAccessError extends Error {
	readonly code:
		| "allocation_unavailable"
		| "bootstrap_expired"
		| "bootstrap_url_insecure"
		| "encryption_key_invalid"
		| "encryption_key_missing"
		| "host_key_missing"
		| "secrets_unreadable";

	constructor(code: SshAccessError["code"]) {
		super(code);
		this.name = "SshAccessError";
		this.code = code;
	}
}

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

function encrypt(allocationId: string, secrets: SshAccessSecrets) {
	const nonce = randomBytes(nonceBytes);
	const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
	cipher.setAAD(toAuthenticatedData(allocationId));
	const data = Buffer.concat([
		cipher.update(JSON.stringify(secrets), "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
}

function decrypt(sshAccess: AllocationSshAccess): SshAccessSecrets {
	try {
		const bytes = Buffer.from(sshAccess.encryptedSecrets, "base64");
		const dataStart = nonceBytes + authTagBytes;
		const decipher = createDecipheriv(
			"aes-256-gcm",
			getEncryptionKey(),
			bytes.subarray(0, nonceBytes),
		);
		decipher.setAAD(toAuthenticatedData(sshAccess.allocationId));
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

export async function requireSshConnection(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
): Promise<SshConnectionOptions> {
	if (allocation.deleteRequested || allocation.ipv4 === undefined) {
		throw new SshAccessError("allocation_unavailable");
	}
	const sshAccess: AllocationSshAccess | null = await ctx.runQuery(
		internal.ssh.access_state.get,
		{ allocationId: allocation._id },
	);
	if (sshAccess?.hostKey === undefined) {
		throw new SshAccessError("host_key_missing");
	}
	return {
		address: allocation.ipv4,
		port: sshAccess.port ?? sshPort,
		username: "root",
		privateKey: decrypt(sshAccess).privateKey,
		hostKey: Buffer.from(sshAccess.hostKey.split(" ")[1] ?? "", "base64"),
		timeoutMs: connectionTimeoutMs,
	};
}

/** Only an expired bootstrap without a registered host key needs new access. */
export function canReuseAllocationSshAccess(
	sshAccess: AllocationSshAccess | null,
) {
	return (
		sshAccess !== null &&
		(sshAccess.bootstrapExpiresAt > Date.now() ||
			sshAccess.hostKey !== undefined)
	);
}

export async function generateAllocationSshAccess(
	allocationId: Id<"serverAllocations">,
) {
	const keyPair = utils.generateKeyPairSync("ed25519");
	const token = randomBytes(bootstrapTokenBytes).toString("base64url");
	return {
		allocationId,
		publicKey: keyPair.public,
		encryptedSecrets: encrypt(allocationId, {
			privateKey: keyPair.private,
			token,
		}),
		bootstrapTokenDigest: await toBootstrapTokenDigest(token),
		bootstrapExpiresAt: Date.now() + bootstrapLifetimeMs,
	};
}

/**
 * Opens one more bootstrap window and returns the command that completes it, for a member whose
 * server no longer accepts Composery. The command must run on the server itself: the report
 * that it sends is refused from any other address.
 */
export const renewBootstrap = action({
	args: { serverId: v.id("servers") },
	returns: v.object({ command: v.string() }),
	handler: async (ctx, { serverId }): Promise<{ command: string }> => {
		const allocation: Doc<"serverAllocations"> = await ctx.runQuery(
			internal.servers.permissions.requireSshAccess,
			{ serverId },
		);
		const allocationId = allocation._id;
		const sshAccess: AllocationSshAccess | null = await ctx.runQuery(
			internal.ssh.access_state.get,
			{ allocationId },
		);
		if (sshAccess === null) {
			throw toConvexError("server_busy");
		}
		const token = randomBytes(bootstrapTokenBytes).toString("base64url");
		await ctx.runMutation(internal.ssh.access_state.storeBootstrap, {
			allocationId,
			encryptedSecrets: encrypt(allocationId, {
				privateKey: decrypt(sshAccess).privateKey,
				token,
			}),
			bootstrapTokenDigest: await toBootstrapTokenDigest(token),
		});
		return {
			command: toSshBootstrapCommand(
				{
					...toSshBootstrapFile(sshAccess),
					token,
				},
				sshAccess.publicKey,
			),
		};
	},
});

function toSshBootstrapFile(sshAccess: AllocationSshAccess): SshBootstrapFile {
	const url = `${env.CONVEX_SITE_URL}/ssh/host-keys`;
	// The token travels in this URL's request body, so a plain HTTP report would expose it.
	if (!url.startsWith("https://")) {
		throw new SshAccessError("bootstrap_url_insecure");
	}
	return {
		allocationId: sshAccess.allocationId,
		token: decrypt(sshAccess).token,
		url,
	};
}

export function requireSshBootstrapFile(
	sshAccess: AllocationSshAccess,
): SshBootstrapFile {
	if (sshAccess.bootstrapExpiresAt <= Date.now()) {
		throw new SshAccessError("bootstrap_expired");
	}
	return toSshBootstrapFile(sshAccess);
}
