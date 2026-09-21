import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getEnvelopeKeyId } from "../../../convex/ssh/encryption_keys";
import { SshAccessError } from "../../../convex/ssh/errors";
import { generateSshKeyPair } from "../../../convex/ssh/key_pair";
import {
	decryptSshSecretsWith,
	encryptSshSecretsWith,
	toEncryptionKeyId,
} from "../../../convex/ssh/secrets";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../harness/convex/backend";
import { createServer, createServerOwner } from "../../../harness/servers";

const keyBytes = 32;
const distinctKeys = 100;
const allocationId = "k1000000000000000000000000000000";

// Rotation preserves old values, identifies missing keys, and binds envelopes to an allocation.
const otherAllocationId = "k2000000000000000000000000000000";
const secrets = { privateKey: "PRIVATE KEY", token: "a-token" };
const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;
const settleTimeoutMs = 240_000;
const settleDelayMs = 1000;

let backend: ConvexBackend;

beforeAll(async () => {
	backend = await useConvexBackend();
}, setupTimeoutMs);

function toKey() {
	return randomBytes(keyBytes).toString("base64");
}

function toCode(run: () => unknown) {
	try {
		run();
	} catch (error) {
		return error instanceof SshAccessError ? error.code : "not an SSH error";
	}
	return "nothing was thrown";
}

test("secrets read with the key that encrypted them", () => {
	const key = toKey();
	const envelope = encryptSshSecretsWith([key], allocationId, secrets);
	expect(decryptSshSecretsWith([key], allocationId, envelope)).toEqual(secrets);
});

test("the first key encrypts, and every key reads", () => {
	const [older, newer] = [toKey(), toKey()];
	const old = encryptSshSecretsWith([older, newer], allocationId, secrets);
	expect(getEnvelopeKeyId(old)).toBe(toEncryptionKeyId(older));

	const fresh = encryptSshSecretsWith([newer, older], allocationId, secrets);
	expect(getEnvelopeKeyId(fresh)).toBe(toEncryptionKeyId(newer));
	expect(decryptSshSecretsWith([newer, older], allocationId, old)).toEqual(
		secrets,
	);
	expect(decryptSshSecretsWith([newer, older], allocationId, fresh)).toEqual(
		secrets,
	);
});

test("a value whose key is gone says which thing is missing", () => {
	const [older, newer] = [toKey(), toKey()];
	const old = encryptSshSecretsWith([older], allocationId, secrets);
	expect(toCode(() => decryptSshSecretsWith([newer], allocationId, old))).toBe(
		"encryption_key_unknown",
	);
	expect(toCode(() => decryptSshSecretsWith([], allocationId, old))).toBe(
		"encryption_key_missing",
	);
});

test("an envelope belongs to one allocation and to the key it names", () => {
	const key = toKey();
	const envelope = encryptSshSecretsWith([key], allocationId, secrets);
	expect(
		toCode(() => decryptSshSecretsWith([key], otherAllocationId, envelope)),
	).toBe("secrets_unreadable");

	const bytes = Buffer.from(envelope, "base64");
	const moved = Buffer.from(bytes);
	const flip = 0xff;
	moved[1] = (bytes[1] ?? 0) ^ flip;
	expect(
		toCode(() =>
			decryptSshSecretsWith([key], allocationId, moved.toString("base64")),
		),
	).toBe("encryption_key_unknown");
});

test("a value that is not one of ours is refused", () => {
	const key = toKey();
	expect(
		toCode(() =>
			decryptSshSecretsWith([key], allocationId, "not base64 at all"),
		),
	).toBe("secrets_unreadable");
	expect(getEnvelopeKeyId("not base64 at all")).toBe(null);
	const envelope = encryptSshSecretsWith([key], allocationId, secrets);
	for (const malformed of [envelope.slice(0, -1), `${envelope}!`]) {
		expect(
			toCode(() => decryptSshSecretsWith([key], allocationId, malformed)),
		).toBe("secrets_unreadable");
		expect(getEnvelopeKeyId(malformed)).toBe(null);
	}
});

test("two different keys are never named the same", () => {
	const ids = new Set(
		Array.from({ length: distinctKeys }, () => toEncryptionKeyId(toKey())),
	);
	expect(ids.size).toBe(distinctKeys);
});

async function createSshAccess() {
	const serverId = await createServer(await createServerOwner(backend));
	const deadline = Date.now() + settleTimeoutMs;
	while (Date.now() < deadline) {
		const allocation = await backend.runAsAdmin(
			internal.allocations.operations.getForServer,
			{ serverId },
		);
		const record =
			allocation === null
				? null
				: await backend.runAsAdmin(
						internal.allocations.hetzner_cloud.worker_state.get,
						{ allocationId: allocation._id },
					);
		if (allocation !== null && record?.resources.server.status === "present") {
			return await readSshAccess(allocation._id);
		}
		await Bun.sleep(settleDelayMs);
	}
	throw new Error("The server was not created in time.");
}

async function readSshAccess(id: Id<"serverAllocations">) {
	const sshAccess = await backend.runAsAdmin(internal.ssh.access_state.get, {
		allocationId: id,
	});
	if (sshAccess === null) {
		throw new Error("The allocation has no SSH access.");
	}
	return sshAccess;
}

async function storeEnvelope(
	sshAccess: Awaited<ReturnType<typeof readSshAccess>>,
	encryptedSecrets: string,
) {
	const outcome = await backend.runAsAdmin(
		internal.ssh.secrets_state.storeReEncrypted,
		{
			id: sshAccess._id,
			encryptedSecrets,
			pendingEncryptedSecrets: null,
			expected: {
				encryptedSecrets: sshAccess.encryptedSecrets,
				pendingEncryptedSecrets: sshAccess.pendingEncryptedSecrets ?? null,
			},
		},
	);
	expect(outcome).toBe("stored");
	return await readSshAccess(sshAccess.allocationId);
}

test(
	"re-encrypting moves stored values off an older key, and leaves one no key can read",
	async () => {
		const [currentKey, previousKey] = backend.sshAccessEncryptionKeys;
		const created = await createSshAccess();

		const unheldKey = toKey();
		const unheld = await storeEnvelope(
			created,
			encryptSshSecretsWith([unheldKey], created.allocationId, secrets),
		);
		const first = await backend.runAsAdmin(internal.ssh.secrets.reEncrypt, {});
		expect(first.remaining).toContainEqual({
			keyId: toEncryptionKeyId(unheldKey),
			count: 1,
		});
		expect((await readSshAccess(created.allocationId)).encryptedSecrets).toBe(
			unheld.encryptedSecrets,
		);

		await storeEnvelope(
			unheld,
			encryptSshSecretsWith([previousKey], created.allocationId, secrets),
		);
		const second = await backend.runAsAdmin(internal.ssh.secrets.reEncrypt, {});
		expect(second.remaining.map(({ keyId }) => keyId)).not.toContain(
			toEncryptionKeyId(previousKey),
		);
		const moved = await readSshAccess(created.allocationId);
		expect(getEnvelopeKeyId(moved.encryptedSecrets)).toBe(
			toEncryptionKeyId(currentKey),
		);
		expect(
			decryptSshSecretsWith(
				[currentKey],
				created.allocationId,
				moved.encryptedSecrets,
			),
		).toEqual(secrets);
	},
	testTimeoutMs,
);

test(
	"concurrent renewals keep the first pending key and reject the stale writer",
	async () => {
		const created = await createSshAccess();
		const first = generateSshKeyPair();
		const second = generateSshKeyPair();
		const firstSecrets = encryptSshSecretsWith(
			backend.sshAccessEncryptionKeys,
			created.allocationId,
			{ privateKey: first.privateKey, token: "first" },
		);
		const secondSecrets = encryptSshSecretsWith(
			backend.sshAccessEncryptionKeys,
			created.allocationId,
			{ privateKey: second.privateKey, token: "second" },
		);
		const expected = {
			publicKey: created.publicKey,
			pendingPublicKey: created.pendingPublicKey ?? null,
			pendingEncryptedSecrets: created.pendingEncryptedSecrets ?? null,
			bootstrapExpiresAt: created.bootstrapExpiresAt,
		};
		const firstOutcome = await backend.runAsAdmin(
			internal.ssh.bootstrap_state.storeRenewal,
			{
				allocationId: created.allocationId,
				pendingPublicKey: first.publicKey,
				pendingEncryptedSecrets: firstSecrets,
				bootstrapTokenDigest: "first-digest",
				expected,
			},
		);
		const secondOutcome = await backend.runAsAdmin(
			internal.ssh.bootstrap_state.storeRenewal,
			{
				allocationId: created.allocationId,
				pendingPublicKey: second.publicKey,
				pendingEncryptedSecrets: secondSecrets,
				bootstrapTokenDigest: "second-digest",
				expected,
			},
		);
		expect(firstOutcome).toBe("stored");
		expect(secondOutcome).toBe("changed");
		expect((await readSshAccess(created.allocationId)).pendingPublicKey).toBe(
			first.publicKey,
		);
	},
	testTimeoutMs,
);

test(
	"a successful host-key report can be retried after its reply is lost",
	async () => {
		const created = await createSshAccess();
		const allocation = await backend.runAsAdmin(
			internal.allocations.operations.get,
			{ allocationId: created.allocationId },
		);
		if (allocation?.ipv4 === undefined) {
			throw new Error("The test allocation has no IPv4 address.");
		}
		const hostKey = generateSshKeyPair().publicKey;
		const report = {
			allocationId: created.allocationId,
			bootstrapTokenDigest: created.bootstrapTokenDigest,
			hostKey,
			port: 22,
			source: allocation.ipv4,
		};
		expect(
			await backend.runAsAdmin(
				internal.ssh.bootstrap_state.registerHostKey,
				report,
			),
		).toBe(true);
		expect(
			await backend.runAsAdmin(
				internal.ssh.bootstrap_state.registerHostKey,
				report,
			),
		).toBe(true);
		expect((await readSshAccess(created.allocationId)).hostKey).toBe(hostKey);
	},
	testTimeoutMs,
);
