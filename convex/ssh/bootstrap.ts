"use node";

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { v } from "convex/values";
import ssh2 from "ssh2";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { type ActionCtx, env, internalAction } from "../_generated/server";
import type { SshBootstrapFile } from "./cloud_init";
import type { SshConnectionOptions } from "./connection";

const { utils } = ssh2;

const bootstrapLifetimeMs = 3_600_000;
const bootstrapTokenBytes = 32;
const bootstrapTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const credentialKeyBytes = 32;
const credentialKeyPattern = /^[A-Za-z0-9+/]{43}=$/;
const nonceBytes = 12;
const authTagBytes = 16;
const maxHostKeyLength = 256;
const sshPort = 22;
const connectionTimeoutMs = 30_000;
const hostKeyType = "ssh-ed25519";

type AllocationSshAccess = Doc<"allocationSshAccess">;

export class SshBootstrapError extends Error {
	readonly code:
		| "allocation_unavailable"
		| "bootstrap_incomplete"
		| "credential_key_missing"
		| "credential_key_invalid"
		| "credential_unavailable"
		| "bootstrap_expired";

	constructor(code: SshBootstrapError["code"]) {
		super(code);
		this.name = "SshBootstrapError";
		this.code = code;
	}
}

function getCredentialKey() {
	const value = env.SSH_CREDENTIAL_KEY;
	if (!value || !credentialKeyPattern.test(value)) {
		throw new SshBootstrapError("credential_key_missing");
	}
	const key = Buffer.from(value, "base64");
	if (key.length !== credentialKeyBytes || key.toString("base64") !== value) {
		throw new SshBootstrapError("credential_key_invalid");
	}
	return key;
}

// The allocation ID is authenticated data, so a credential cannot be moved to another allocation.
function toAuthenticatedData(allocationId: string) {
	return Buffer.from(`allocationSshAccess:${allocationId}`);
}

function encrypt(allocationId: string, plaintext: string) {
	const nonce = randomBytes(nonceBytes);
	const cipher = createCipheriv("aes-256-gcm", getCredentialKey(), nonce);
	cipher.setAAD(toAuthenticatedData(allocationId));
	const data = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
}

function decrypt(sshAccess: AllocationSshAccess) {
	try {
		const bytes = Buffer.from(sshAccess.encryptedCredential, "base64");
		const dataStart = nonceBytes + authTagBytes;
		const decipher = createDecipheriv(
			"aes-256-gcm",
			getCredentialKey(),
			bytes.subarray(0, nonceBytes),
		);
		decipher.setAAD(toAuthenticatedData(sshAccess.allocationId));
		decipher.setAuthTag(bytes.subarray(nonceBytes, dataStart));
		const credential: unknown = JSON.parse(
			Buffer.concat([
				decipher.update(bytes.subarray(dataStart)),
				decipher.final(),
			]).toString("utf8"),
		);
		if (
			credential === null ||
			typeof credential !== "object" ||
			!("privateKey" in credential) ||
			!("token" in credential) ||
			typeof credential.privateKey !== "string" ||
			typeof credential.token !== "string"
		) {
			throw new Error("The credential has an unexpected shape.");
		}
		return { privateKey: credential.privateKey, token: credential.token };
	} catch {
		throw new SshBootstrapError("credential_unavailable");
	}
}

function toTokenDigest(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

/** Access data must come from an authorized backend lookup, never from a request body. */
export async function getSshConnection(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
): Promise<SshConnectionOptions> {
	if (allocation.deleteRequested || allocation.ipv4 === undefined) {
		throw new SshBootstrapError("allocation_unavailable");
	}
	const sshAccess: AllocationSshAccess | null = await ctx.runQuery(
		internal.ssh.bootstrap_state.get,
		{ allocationId: allocation._id },
	);
	if (sshAccess?.hostKey === undefined) {
		throw new SshBootstrapError("bootstrap_incomplete");
	}
	return {
		address: allocation.ipv4,
		port: sshPort,
		username: "root",
		privateKey: decrypt(sshAccess).privateKey,
		hostKey: Buffer.from(sshAccess.hostKey.split(" ")[1] ?? "", "base64"),
		timeoutMs: connectionTimeoutMs,
	};
}

/** Retries use the same key. Only an expired bootstrap without a registered host key needs new access. */
export function canReuseSshAccess(sshAccess: AllocationSshAccess | null) {
	return (
		sshAccess !== null &&
		(sshAccess.bootstrapExpiresAt > Date.now() ||
			sshAccess.hostKey !== undefined)
	);
}

export function createSshAccess(allocationId: Id<"serverAllocations">) {
	const keyPair = utils.generateKeyPairSync("ed25519");
	const token = randomBytes(bootstrapTokenBytes).toString("base64url");
	return {
		allocationId,
		publicKey: keyPair.public,
		encryptedCredential: encrypt(
			allocationId,
			JSON.stringify({ privateKey: keyPair.private, token }),
		),
		bootstrapTokenDigest: toTokenDigest(token),
		bootstrapExpiresAt: Date.now() + bootstrapLifetimeMs,
	};
}

export function getSshBootstrapFile(
	sshAccess: AllocationSshAccess,
): SshBootstrapFile {
	if (sshAccess.bootstrapExpiresAt <= Date.now()) {
		throw new SshBootstrapError("bootstrap_expired");
	}
	return {
		allocationId: sshAccess.allocationId,
		token: decrypt(sshAccess).token,
		url: `${env.CONVEX_SITE_URL}/bootstrap/ssh`,
	};
}

export const registerHostKey = internalAction({
	args: {
		allocationId: v.id("serverAllocations"),
		token: v.string(),
		hostKey: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, { allocationId, token, hostKey }): Promise<boolean> => {
		if (
			!bootstrapTokenPattern.test(token) ||
			hostKey.length > maxHostKeyLength
		) {
			return false;
		}
		const parsed = utils.parseKey(hostKey);
		if (
			parsed instanceof Error ||
			Array.isArray(parsed) ||
			parsed.type !== hostKeyType ||
			parsed.isPrivateKey()
		) {
			return false;
		}
		const canonical = `${hostKeyType} ${parsed.getPublicSSH().toString("base64")}`;
		if (canonical !== hostKey) {
			return false;
		}
		return await ctx.runMutation(internal.ssh.bootstrap_state.registerHostKey, {
			allocationId,
			bootstrapTokenDigest: toTokenDigest(token),
			hostKey: canonical,
		});
	},
});
