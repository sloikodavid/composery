"use node";

import type { ClientChannel } from "ssh2";
import type { AuthorizedKey } from "./authorized_keys";
import {
	callSsh,
	commandExitCodes,
	type SshConnectionOptions,
	SshError,
	withSshConnection,
} from "./connection";

// 128 KiB.
const maxKeyBase64Length = 131_072;
const maxOutputBytes = 4096;
const keygenErrorExitCode = 255;
const keyTypePattern = /^[a-zA-Z0-9][a-zA-Z0-9@._+-]{0,127}$/;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
const fingerprintPattern =
	/^(\d+) (SHA256:[A-Za-z0-9+/]{43}) no comment \(([A-Z0-9-]+)\)\n$/;
const rejectedKeyMessage = "(stdin) is not a public key file.";

export type SshPublicKeyInspection =
	| { status: "parsed"; bits: number; fingerprint: string; type: string }
	| { status: "rejected" };

type KeygenResult = {
	exitCode: number | undefined;
	isTerminated: boolean;
	stdout: string;
	stderr: string;
};

function toInspection(
	result: KeygenResult,
): SshPublicKeyInspection | "command_unavailable" | "invalid_response" {
	const { exitCode, isTerminated, stdout, stderr } = result;
	if (isTerminated || exitCode === undefined) {
		return "invalid_response";
	}
	if (commandExitCodes.has(exitCode)) {
		return "command_unavailable";
	}
	// Native rejection does not distinguish a malformed key from an algorithm
	// that this OpenSSH build does not support.
	if (
		exitCode === keygenErrorExitCode &&
		stderr.trim() === rejectedKeyMessage
	) {
		return stdout.length === 0 ? { status: "rejected" } : "invalid_response";
	}
	const match = exitCode === 0 ? fingerprintPattern.exec(stdout) : null;
	const bits = Number(match?.[1]);
	if (
		match?.[2] === undefined ||
		match[3] === undefined ||
		!Number.isSafeInteger(bits) ||
		bits <= 0
	) {
		return "invalid_response";
	}
	return { status: "parsed", bits, fingerprint: match[2], type: match[3] };
}

/**
 * Ask the target's OpenSSH to parse exactly one public key. This does not check
 * authorized-key options, daemon policy, certificate trust, or private-key possession.
 * Certificate fingerprints identify the underlying key, not the certificate bytes.
 */
export async function inspectSshPublicKey(
	connection: SshConnectionOptions,
	key: AuthorizedKey,
): Promise<SshPublicKeyInspection> {
	// Never interpolate user input into a command. Exclude options, comments,
	// private-key envelopes, and extra lines before passing one public key on stdin.
	if (
		!keyTypePattern.test(key.type) ||
		key.base64.length > maxKeyBase64Length ||
		!base64Pattern.test(key.base64)
	) {
		throw new SshError("invalid_request");
	}
	const input = Buffer.from(`${key.type} ${key.base64}\n`, "ascii");
	return await withSshConnection(
		connection,
		async ({ client, signal, fail }) => {
			const channel = await callSsh<ClientChannel>(signal, (done) => {
				client.exec(
					"LC_ALL=C /usr/bin/ssh-keygen -l -E sha256 -f -",
					(error, stream) =>
						done(
							error ? new SshError("command_unavailable") : undefined,
							stream,
						),
				);
			});
			return await callSsh<SshPublicKeyInspection>(signal, (done) => {
				const stdout: Buffer[] = [];
				const stderr: Buffer[] = [];
				let outputBytes = 0;
				let exitCode: number | undefined;
				let isTerminated = false;
				const receive = (data: Buffer, isStdout: boolean) => {
					outputBytes += data.length;
					if (outputBytes > maxOutputBytes) {
						fail(new SshError("output_limit"));
						return;
					}
					(isStdout ? stdout : stderr).push(Buffer.from(data));
				};
				channel.on("data", (data: Buffer) => receive(data, true));
				channel.stderr.on("data", (data: Buffer) => receive(data, false));
				channel.on("error", () => fail(new SshError("remote_error")));
				channel.stderr.on("error", () => fail(new SshError("remote_error")));
				channel.on("exit", (code: number | null) => {
					if (typeof code === "number") {
						exitCode = code;
					} else {
						isTerminated = true;
					}
				});
				channel.on("close", () => {
					const inspection = toInspection({
						exitCode,
						isTerminated,
						stdout: Buffer.concat(stdout).toString("utf8"),
						stderr: Buffer.concat(stderr).toString("utf8"),
					});
					if (typeof inspection === "string") {
						fail(new SshError(inspection));
					} else {
						done(undefined, inspection);
					}
				});
				channel.end(input);
			});
		},
	);
}
