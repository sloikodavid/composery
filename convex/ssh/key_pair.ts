"use node";

import { generateKeyPairSync, randomBytes } from "node:crypto";

const keyType = "ssh-ed25519";
const ed25519KeyBytes = 32;
const lengthPrefixBytes = 4;
const checkBytes = 4;
const cipherBlockBytes = 8;
const privateKeyMagic = "openssh-key-v1\0";
const pemLinePattern = /.{1,70}/g;

export type SshKeyPair = Readonly<{
	publicKey: string;
	privateKey: string;
}>;

function toSshString(bytes: Uint8Array) {
	const encoded = Buffer.alloc(lengthPrefixBytes + bytes.length);
	encoded.writeUInt32BE(bytes.length, 0);
	encoded.set(bytes, lengthPrefixBytes);
	return encoded;
}

function toUint32(value: number) {
	const encoded = Buffer.alloc(lengthPrefixBytes);
	encoded.writeUInt32BE(value, 0);
	return encoded;
}

function toPadding(length: number) {
	const size =
		(cipherBlockBytes - (length % cipherBlockBytes)) % cipherBlockBytes;
	return Buffer.from(Array.from({ length: size }, (_, index) => index + 1));
}

function toPem(label: string, bytes: Buffer) {
	const lines = bytes.toString("base64").match(pemLinePattern) ?? [];
	return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** Re-encodes Ed25519 in OpenSSH format without losing leading-zero bytes. */
export function generateSshKeyPair(): SshKeyPair {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const publicJwk = publicKey.export({ format: "jwk" });
	const privateJwk = privateKey.export({ format: "jwk" });
	const publicBytes = Buffer.from(publicJwk.x ?? "", "base64url");
	const seedBytes = Buffer.from(privateJwk.d ?? "", "base64url");
	if (
		publicBytes.length !== ed25519KeyBytes ||
		seedBytes.length !== ed25519KeyBytes
	) {
		throw new Error("Node returned an Ed25519 key of the wrong length.");
	}
	const typeBytes = Buffer.from(keyType);
	const publicBlob = Buffer.concat([
		toSshString(typeBytes),
		toSshString(publicBytes),
	]);
	const check = randomBytes(checkBytes);
	const section = Buffer.concat([
		check,
		check,
		toSshString(typeBytes),
		toSshString(publicBytes),
		toSshString(Buffer.concat([seedBytes, publicBytes])),
		toSshString(Buffer.alloc(0)),
	]);
	const file = Buffer.concat([
		Buffer.from(privateKeyMagic, "binary"),
		toSshString(Buffer.from("none")),
		toSshString(Buffer.from("none")),
		toSshString(Buffer.alloc(0)),
		toUint32(1),
		toSshString(publicBlob),
		toSshString(Buffer.concat([section, toPadding(section.length)])),
	]);
	return {
		publicKey: `${keyType} ${publicBlob.toString("base64")}`,
		privateKey: toPem("OPENSSH PRIVATE KEY", file),
	};
}
