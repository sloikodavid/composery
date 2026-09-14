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

const { utils } = ssh2;

export class SshBootstrapError extends Error {
	readonly code:
		| "ssh_allocation_unavailable"
		| "ssh_bootstrap_incomplete"
		| "ssh_credential_key_missing"
		| "ssh_credential_key_invalid"
		| "ssh_credential_unavailable"
		| "ssh_bootstrap_expired";
	constructor(code: SshBootstrapError["code"]) {
		super(code);
		this.name = "SshBootstrapError";
		this.code = code;
	}
}

/** Allocation data must come from an authorized backend lookup, never an API body. */
export async function connectionForAllocation(
	ctx: ActionCtx,
	allocation: Doc<"serverAllocations">,
) {
	if (
		allocation.deleteRequested ||
		allocation.resources.server.phase !== "present" ||
		!allocation.ipv4
	)
		throw new SshBootstrapError("ssh_allocation_unavailable");
	const access: Doc<"serverSshAccess"> | null = await ctx.runQuery(
		internal.ssh.bootstrap_state.get,
		{ allocationId: allocation._id },
	);
	if (!access?.hostKey) throw new SshBootstrapError("ssh_bootstrap_incomplete");
	const { privateKey } = unseal(access);
	return {
		address: allocation.ipv4,
		port: 22,
		username: "root",
		privateKey,
		hostKey: Buffer.from(access.hostKey.split(" ")[1] ?? "", "base64"),
		timeoutMs: 30_000,
	};
}

function encryptionKey() {
	const value = env.SSH_CREDENTIAL_KEY;
	if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))
		throw new SshBootstrapError("ssh_credential_key_missing");
	const key = Buffer.from(value, "base64");
	if (key.length !== 32 || key.toString("base64") !== value)
		throw new SshBootstrapError("ssh_credential_key_invalid");
	return key;
}

function seal(allocationId: string, plaintext: string) {
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
	cipher.setAAD(Buffer.from(`server-ssh:${allocationId}`));
	const data = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
}

function unseal(access: Doc<"serverSshAccess">) {
	try {
		const bytes = Buffer.from(access.sealedCredential, "base64");
		const decipher = createDecipheriv(
			"aes-256-gcm",
			encryptionKey(),
			bytes.subarray(0, 12),
		);
		decipher.setAAD(Buffer.from(`server-ssh:${access.allocationId}`));
		decipher.setAuthTag(bytes.subarray(12, 28));
		const result: unknown = JSON.parse(
			Buffer.concat([
				decipher.update(bytes.subarray(28)),
				decipher.final(),
			]).toString("utf8"),
		);
		if (
			!result ||
			typeof result !== "object" ||
			!("privateKey" in result) ||
			!("token" in result) ||
			typeof result.privateKey !== "string" ||
			typeof result.token !== "string"
		)
			throw new Error();
		return { privateKey: result.privateKey, token: result.token };
	} catch {
		throw new SshBootstrapError("ssh_credential_unavailable");
	}
}

// Runs once during cloud-init. Credentials never enter command arguments or output.
const reportHostKey = `import json, pathlib, time, urllib.request
config_path = pathlib.Path("/run/composery-bootstrap.json")
config = json.loads(config_path.read_text())
host_key = pathlib.Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()
body = json.dumps(dict(allocationId=config["allocationId"], token=config["token"],
                       hostKey=" ".join(host_key[:2]))).encode()
request = urllib.request.Request(config["url"], data=body, headers={"Content-Type": "application/json"})
success = False
for attempt in range(30):
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            success = response.status == 204
        if success:
            break
    except Exception:
        pass
    time.sleep(min(20, 1 + attempt))
config_path.unlink(missing_ok=True)
if not success:
    raise SystemExit("Composery host identity registration failed.")
`;

/** Prepare durable credentials before provider dispatch; retries use the same key. */
export async function bootstrapConfig(
	ctx: ActionCtx,
	allocationId: Id<"serverAllocations">,
) {
	let access: Doc<"serverSshAccess"> | null = await ctx.runQuery(
		internal.ssh.bootstrap_state.get,
		{ allocationId },
	);
	if (!access || (access.bootstrapExpiresAt <= Date.now() && !access.hostKey)) {
		const key = utils.generateKeyPairSync("ed25519");
		const token = randomBytes(32).toString("base64url");
		access = await ctx.runMutation(internal.ssh.bootstrap_state.prepare, {
			allocationId,
			publicKey: key.public,
			sealedCredential: seal(
				allocationId,
				JSON.stringify({ privateKey: key.private, token }),
			),
			bootstrapDigest: createHash("sha256").update(token).digest("hex"),
			bootstrapExpiresAt: Date.now() + 60 * 60 * 1000,
		});
	}
	if (access.bootstrapExpiresAt <= Date.now())
		throw new SshBootstrapError("ssh_bootstrap_expired");
	const { token } = unseal(access);
	const config = {
		ssh_pwauth: false,
		disable_root: false,
		ssh_genkeytypes: ["ed25519", "rsa", "ecdsa"],
		chpasswd: { expire: false },
		users: [
			{
				name: "root",
				lock_passwd: true,
				ssh_authorized_keys: [access.publicKey],
			},
		],
		write_files: [
			{
				path: "/run/composery-bootstrap.json",
				permissions: "0600",
				owner: "root:root",
				content: JSON.stringify({
					allocationId,
					token,
					url: `${env.CONVEX_SITE_URL}/bootstrap/ssh`,
				}),
			},
		],
		runcmd: [["/usr/bin/python3", "-I", "-c", reportHostKey]],
	};
	// JSON is a YAML subset; scalar contents do not become cloud-config structure.
	return `#cloud-config\n${JSON.stringify(config)}\n`;
}

export const registerHostKey = internalAction({
	args: {
		allocationId: v.id("serverAllocations"),
		token: v.string(),
		hostKey: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, { allocationId, token, hostKey }): Promise<boolean> => {
		if (!/^[A-Za-z0-9_-]{43}$/.test(token) || hostKey.length > 256)
			return false;
		const parsed = utils.parseKey(hostKey);
		if (
			parsed instanceof Error ||
			Array.isArray(parsed) ||
			parsed.type !== "ssh-ed25519" ||
			parsed.isPrivateKey()
		)
			return false;
		const canonical = `ssh-ed25519 ${parsed.getPublicSSH().toString("base64")}`;
		if (canonical !== hostKey) return false;
		return ctx.runMutation(internal.ssh.bootstrap_state.acceptHostKey, {
			allocationId,
			digest: createHash("sha256").update(token).digest("hex"),
			hostKey: canonical,
		});
	},
});
