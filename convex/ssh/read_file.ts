"use node";

import { isIP } from "node:net";
import { Client, type SFTPWrapper, type Stats } from "ssh2";

type ReadFailure =
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
	| "remote_error";

/** Only stable codes escape this boundary; server text and credentials do not. */
export class SshReadError extends Error {
	readonly code: ReadFailure;
	constructor(code: ReadFailure) {
		super(code);
		this.name = "SshReadError";
		this.code = code;
	}
}

export type SshFileRequest = Readonly<{
	/** Resolved from trusted allocation state, never a caller-supplied URL. */
	address: string;
	port: number;
	username: string;
	privateKey: string;
	/** SSH wire-format public key obtained through an independent trusted path. */
	hostKey: Uint8Array;
	path: string;
	maxBytes: number;
	timeoutMs: number;
	signal?: AbortSignal;
}>;

export type SshFileObservation = Readonly<{
	bytes: Uint8Array;
	startedAt: number;
	finishedAt: number;
	attributes: Readonly<{
		size: number;
		uid: number;
		gid: number;
		mode: number;
		mtime: number;
	}>;
}>;

function remoteError(error: unknown) {
	if (error instanceof SshReadError) return error;
	const code =
		error && typeof error === "object" && "code" in error ? error.code : null;
	return new SshReadError(
		code === 2
			? "file_missing"
			: code === 3
				? "permission_denied"
				: "remote_error",
	);
}

/** Each pending protocol request owns and removes its cancellation listener. */
function request<T>(
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
				if (error) reject(remoteError(error));
				else resolve(value);
			});
		} catch (error) {
			signal.removeEventListener("abort", abort);
			reject(remoteError(error));
		}
	});
}

function attributes(stats: Stats) {
	const { size, uid, gid, mode, mtime } = stats;
	if (
		![size, uid, gid, mode, mtime].every(
			(value) => Number.isSafeInteger(value) && value >= 0,
		)
	) {
		throw new SshReadError("remote_error");
	}
	if ((mode & 0o170000) !== 0o100000)
		throw new SshReadError("not_regular_file");
	return { size, uid, gid, mode, mtime };
}

async function read(
	sftp: SFTPWrapper,
	input: SshFileRequest,
	signal: AbortSignal,
) {
	// Refuse a known special file before open. The handle is checked again below.
	attributes(
		await request<Stats>(signal, (done) => sftp.lstat(input.path, done)),
	);
	const handle = await request<Buffer>(signal, (done) =>
		sftp.open(input.path, "r", done),
	);
	const before = attributes(
		await request<Stats>(signal, (done) => sftp.fstat(handle, done)),
	);
	if (before.size > input.maxBytes) throw new SshReadError("too_large");
	const chunks: Buffer[] = [];
	let size = 0;
	while (true) {
		// One extra byte detects growth beyond the limit without trusting stat.
		const chunk = Buffer.alloc(Math.min(32 * 1024, input.maxBytes - size + 1));
		const count = await request<number>(signal, (done) => {
			sftp.read(handle, chunk, 0, chunk.length, size, (error, bytesRead) =>
				done(error, bytesRead),
			);
		});
		if (!Number.isSafeInteger(count) || count < 0 || count > chunk.length)
			throw new SshReadError("remote_error");
		if (count === 0) break;
		size += count;
		if (size > input.maxBytes) throw new SshReadError("too_large");
		chunks.push(chunk.subarray(0, count));
	}
	const after = attributes(
		await request<Stats>(signal, (done) => sftp.fstat(handle, done)),
	);
	if (
		size !== before.size ||
		size !== after.size ||
		before.mtime !== after.mtime ||
		before.mode !== after.mode ||
		before.uid !== after.uid ||
		before.gid !== after.gid
	) {
		throw new SshReadError("changed_during_read");
	}
	await request<void>(signal, (done) =>
		sftp.close(handle, (error) => done(error ?? undefined, undefined)),
	);
	return {
		bytes: new Uint8Array(Buffer.concat(chunks, size)),
		attributes: after,
	};
}

/**
 * Read one bounded regular file over a new, pinned SSH connection. No retries.
 * Attributes detect some concurrent changes, not all: SFTP has no atomic snapshot
 * primitive. A path can change after open, or equal-size writes can evade mtime.
 * This observation is evidence of bytes read during the returned time interval.
 */
export async function readSshFile(
	options: SshFileRequest,
): Promise<SshFileObservation> {
	// Keep the target and limits fixed across awaits even if a caller mutates its object.
	const input = { ...options, hostKey: Uint8Array.from(options.hostKey) };
	if (
		!isIP(input.address) ||
		!Number.isInteger(input.port) ||
		input.port < 1 ||
		input.port > 65535 ||
		!input.username ||
		input.username.includes("\0") ||
		!input.privateKey ||
		!input.hostKey.length ||
		!input.path.startsWith("/") ||
		input.path.includes("\0") ||
		Buffer.from(input.path, "utf8").toString("utf8") !== input.path ||
		!Number.isSafeInteger(input.maxBytes) ||
		input.maxBytes < 1 ||
		input.maxBytes > 512 * 1024 ||
		!Number.isSafeInteger(input.timeoutMs) ||
		input.timeoutMs < 1 ||
		input.timeoutMs > 60_000
	) {
		throw new SshReadError("invalid_request");
	}
	const startedAt = Date.now();
	const pin = Buffer.from(input.hostKey);
	const client = new Client();
	const lifetime = new AbortController();
	const signal = lifetime.signal;
	const cancel = () => lifetime.abort(new SshReadError("aborted"));
	input.signal?.addEventListener("abort", cancel, { once: true });
	if (input.signal?.aborted) cancel();
	const timer = setTimeout(
		() => lifetime.abort(new SshReadError("deadline_exceeded")),
		input.timeoutMs,
	);
	let hostMismatch = false;
	client.on("error", (error: Error & { level?: string }) => {
		lifetime.abort(
			new SshReadError(
				hostMismatch
					? "host_key_mismatch"
					: error.level === "client-authentication"
						? "authentication_failed"
						: "connection_failed",
			),
		);
	});
	client.on("close", () =>
		lifetime.abort(new SshReadError("connection_closed")),
	);
	try {
		await request<void>(signal, (done) => {
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
		const sftp = await request<SFTPWrapper>(signal, (done) => {
			client.sftp((error, channel) => {
				done(error ? new SshReadError("sftp_unavailable") : undefined, channel);
			});
		});
		sftp.on("error", () => lifetime.abort(new SshReadError("remote_error")));
		sftp.on("close", () =>
			lifetime.abort(new SshReadError("connection_closed")),
		);
		const result = await read(sftp, input, signal);
		return { ...result, startedAt, finishedAt: Date.now() };
	} finally {
		clearTimeout(timer);
		input.signal?.removeEventListener("abort", cancel);
		// Destroy also releases remote handles after errors, cancellation, or stalls.
		client.destroy();
	}
}
