"use node";

import type { AuthorizedKey } from "./authorized_keys";
import {
	commandExitCodes,
	runSshCommand,
	type SshConnectionOptions,
	SshError,
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
 * Asks the target's own OpenSSH to parse one public key. It checks no option, daemon
 * policy, or certificate trust. A certificate's fingerprint is its underlying key's.
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
	const input = Buffer.from(
		`${key.type} ${key.base64}
`,
		"ascii",
	);
	const result = await runSshCommand(
		connection,
		"LC_ALL=C /usr/bin/ssh-keygen -l -E sha256 -f -",
		{ input, maxOutputBytes },
	);
	const inspection = toInspection({
		exitCode: result.exitCode ?? undefined,
		isTerminated: result.exitCode === null,
		stdout: result.stdout,
		stderr: result.stderr,
	});
	if (typeof inspection === "string") {
		throw new SshError(inspection);
	}
	return inspection;
}
