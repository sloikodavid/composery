const encryptionKeyPattern = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const keySeparator = ",";

/** Ordered rotation: all keys read, first key writes. */

export const envelopeVersion = 1;
export const envelopeKeyIdBytes = 4;
const envelopePrefixBytes = 1 + envelopeKeyIdBytes;
const envelopePrefixCharacters = 8;
const hexRadix = 16;
const hexDigitsPerByte = 2;

export function isSshAccessEncryptionKey(value: string) {
	return encryptionKeyPattern.test(value);
}

export function listSshAccessEncryptionKeys(value: string | undefined) {
	if (!value) {
		return [];
	}
	return value
		.split(keySeparator)
		.map((key) => key.trim())
		.filter(Boolean);
}

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

/** Reads the identifier without trusting it; decryption still authenticates the envelope. */
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
