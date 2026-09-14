"use node";

import { isIP } from "node:net";
import { Client } from "ssh2";

type SshFailure =
	| "invalid_request"
	| "host_key_mismatch"
	| "authentication_failed"
	| "connection_failed"
	| "connection_closed"
	| "deadline_exceeded"
	| "aborted"
	| "sftp_unavailable"
	| "file_missing"
	| "permission_denied"
	| "not_regular_file"
	| "too_large"
	| "changed_during_read"
	| "remote_error"
	| "command_unavailable"
	| "output_limit"
	| "invalid_response";

/** Only stable codes escape this boundary; server text and credentials do not. */
export class SshError extends Error {
	readonly code: SshFailure;
	constructor(code: SshFailure) {
		super(code);
		this.name = "SshError";
		this.code = code;
	}
}

export type SshConnectionOptions = Readonly<{
	/** Resolve from trusted allocation state, never a caller-supplied URL. */
	address: string;
	port: number;
	username: string;
	privateKey: string;
	/** SSH wire-format public key from an independent trusted path. */
	hostKey: Uint8Array;
	timeoutMs: number;
	signal?: AbortSignal;
}>;

/** Each pending protocol request owns and removes its cancellation listener. */
export function protocolRequest<T>(
	signal: AbortSignal,
	start: (done: (error: Error | undefined, value: T) => void) => void,
): Promise<T> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		try {
			start((error, value) => {
				signal.removeEventListener("abort", abort);
				if (signal.aborted) {
					reject(signal.reason);
					return;
				}
				if (error)
					reject(
						error instanceof SshError ? error : new SshError("remote_error"),
					);
				else resolve(value);
			});
		} catch (error) {
			signal.removeEventListener("abort", abort);
			reject(error instanceof SshError ? error : new SshError("remote_error"));
		}
	});
}

/** Own one connection and its deadline. Operations must await all protocol work. */
export async function withSshConnection<T>(
	options: SshConnectionOptions,
	operation: (scope: {
		client: Client;
		signal: AbortSignal;
		fail: (error: SshError) => void;
	}) => Promise<T>,
): Promise<T> {
	const input = { ...options, hostKey: Uint8Array.from(options.hostKey) };
	if (
		!isIP(input.address) ||
		!Number.isInteger(input.port) ||
		input.port < 1 ||
		input.port > 65535 ||
		!input.username ||
		input.username.includes("\0") ||
		Buffer.from(input.username, "utf8").toString("utf8") !== input.username ||
		!input.privateKey ||
		!input.hostKey.length ||
		!Number.isSafeInteger(input.timeoutMs) ||
		input.timeoutMs < 1 ||
		input.timeoutMs > 60_000
	) {
		throw new SshError("invalid_request");
	}
	const pin = Buffer.from(input.hostKey);
	const client = new Client();
	const lifetime = new AbortController();
	const signal = lifetime.signal;
	const cancel = () => lifetime.abort(new SshError("aborted"));
	input.signal?.addEventListener("abort", cancel, { once: true });
	if (input.signal?.aborted) cancel();
	const timer = setTimeout(
		() => lifetime.abort(new SshError("deadline_exceeded")),
		input.timeoutMs,
	);
	let hostMismatch = false;
	client.on("error", (error: Error & { level?: string }) => {
		lifetime.abort(
			new SshError(
				hostMismatch
					? "host_key_mismatch"
					: error.level === "client-authentication"
						? "authentication_failed"
						: "connection_failed",
			),
		);
	});
	client.on("close", () => lifetime.abort(new SshError("connection_closed")));
	try {
		await protocolRequest<void>(signal, (done) => {
			client.once("ready", () => done(undefined, undefined));
			client.connect({
				host: input.address,
				port: input.port,
				username: input.username,
				privateKey: input.privateKey,
				readyTimeout: input.timeoutMs,
				authHandler: ["publickey"],
				hostVerifier: (key: Buffer) => {
					const accepted = pin.equals(key);
					hostMismatch ||= !accepted;
					return accepted;
				},
			});
		});
		return await operation({
			client,
			signal,
			fail: (error) => lifetime.abort(error),
		});
	} finally {
		clearTimeout(timer);
		input.signal?.removeEventListener("abort", cancel);
		// Destroy also releases remote handles after errors, cancellation, or stalls.
		client.destroy();
	}
}
