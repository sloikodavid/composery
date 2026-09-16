/**
 * The keys that SSH access secrets are encrypted with, and how an envelope says which key made it.
 *
 * `SSH_ACCESS_ENCRYPTION_KEYS` is an ordered list. The first key encrypts every new value; every
 * key in the list can read one. Rotation is therefore three deployments, never one: add the new
 * key at the end so every reader knows it, move it to the front so it starts encrypting, then
 * encrypt the stored values again and drop the old key. Doing it in one step means a value written
 * by a deployment that has the new key cannot be read by one that does not.
 *
 * Nothing here touches Node, because the deployment's own runtime reads these too.
 */

const encryptionKeyPattern = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const keySeparator = ",";

/** The layout of an envelope: a version, the key that encrypted it, then the encrypted bytes. */
export const envelopeVersion = 1;
export const envelopeKeyIdBytes = 4;
const envelopePrefixBytes = 1 + envelopeKeyIdBytes;
// Base64 spends four characters on every three bytes, so the prefix is within the first eight.
const envelopePrefixCharacters = 8;
const hexRadix = 16;
const hexDigitsPerByte = 2;

export function isSshAccessEncryptionKey(value: string) {
	return encryptionKeyPattern.test(value);
}

/** Every key the deployment holds, in order. The first one encrypts; all of them read. */
export function listSshAccessEncryptionKeys(value: string | undefined) {
	if (!value) {
		return [];
	}
	return value
		.split(keySeparator)
		.map((key) => key.trim())
		.filter(Boolean);
}

/** Throws when the keys are set but any of them is not one. */
export function isSshAccessConfigured(value: string | undefined) {
	const keys = listSshAccessEncryptionKeys(value);
	if (keys.length === 0) {
		return false;
	}
	if (!keys.every(isSshAccessEncryptionKey)) {
		throw new Error(
			"SSH_ACCESS_ENCRYPTION_KEYS must be a comma-separated list of 32 bytes in base64.",
		);
	}
	if (new Set(keys).size !== keys.length) {
		throw new Error("SSH_ACCESS_ENCRYPTION_KEYS lists one key more than once.");
	}
	return true;
}

/**
 * Which key encrypted a stored value, read from the front of it without decrypting it. That is what
 * makes retirement a question the database can answer: count what still names the old key.
 * The identifier is a hint for choosing a key, never a reason to trust the value; the encryption
 * itself is what proves it.
 */
export function getEnvelopeKeyId(encryptedSecrets: string) {
	let bytes: string;
	try {
		bytes = atob(encryptedSecrets.slice(0, envelopePrefixCharacters));
	} catch {
		return null;
	}
	if (
		bytes.length < envelopePrefixBytes ||
		bytes.charCodeAt(0) !== envelopeVersion
	) {
		return null;
	}
	let id = "";
	for (let index = 1; index < envelopePrefixBytes; index += 1) {
		id += bytes
			.charCodeAt(index)
			.toString(hexRadix)
			.padStart(hexDigitsPerByte, "0");
	}
	return id;
}
