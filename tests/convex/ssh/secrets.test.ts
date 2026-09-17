import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getEnvelopeKeyId } from "../../../convex/ssh/encryption_keys";
import { SshAccessError } from "../../../convex/ssh/errors";
import {
	decryptSshSecretsWith,
	encryptSshSecretsWith,
	toEncryptionKeyId,
} from "../../../convex/ssh/secrets";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../harness/convex-backend";
import { createServer, createServerOwner } from "../../harness/servers";

/**
 * Rotation is the point of all of this: a value encrypted by a key the deployment still holds must
 * read, a value encrypted by a key it no longer holds must say so rather than look corrupt, and an
 * envelope must not move to another allocation.
 */

const keyBytes = 32;
const distinctKeys = 100;
const allocationId = "k1000000000000000000000000000000";
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
	// Before the rotation: the old key encrypts, and both deployments can read what it wrote.
	const old = encryptSshSecretsWith([older, newer], allocationId, secrets);
	expect(getEnvelopeKeyId(old)).toBe(toEncryptionKeyId(older));

	// After moving the new key to the front, new values name it and old ones still read.
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
	// This is what dropping a key too early looks like, and it must not read as a broken value.
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

	// Changing the key identifier in front of the value fails the lookup, never a wrong key.
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
});

test("two different keys are never named the same", () => {
	const ids = new Set(
		Array.from({ length: distinctKeys }, () => toEncryptionKeyId(toKey())),
	);
	expect(ids.size).toBe(distinctKeys);
});

/** The SSH access of a new server, once the worker has created the server and stopped writing it. */
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

/** Puts a value in the row as a deployment with other keys would have written it. */
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

		// A value written under a key this deployment never held is counted and kept: deleting it
		// would lose a server's management key for good, and the missing key may yet be found.
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

		// A value the previous key wrote is written again under the current one, and after that the
		// current key alone reads it, which is what makes dropping the previous key safe.
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
