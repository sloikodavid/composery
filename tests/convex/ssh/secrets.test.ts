import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { getEnvelopeKeyId } from "../../../convex/ssh/encryption_keys";
import { SshAccessError } from "../../../convex/ssh/errors";
import {
	decryptSshSecretsWith,
	encryptSshSecretsWith,
	toEncryptionKeyId,
} from "../../../convex/ssh/secrets";

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
