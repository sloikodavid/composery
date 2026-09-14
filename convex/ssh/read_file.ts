"use node";

import type { SFTPWrapper, Stats } from "ssh2";
import {
	protocolRequest,
	type SshConnectionOptions,
	SshError,
	withSshConnection,
} from "./connection";

export type SshFileRequest = SshConnectionOptions &
	Readonly<{ path: string; maxBytes: number }>;

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
	if (error instanceof SshError) return error;
	const code =
		error && typeof error === "object" && "code" in error ? error.code : null;
	return new SshError(
		code === 2
			? "file_missing"
			: code === 3
				? "permission_denied"
				: "remote_error",
	);
}

function fileRequest<T>(
	signal: AbortSignal,
	start: (done: (error: Error | undefined, value: T) => void) => void,
) {
	return protocolRequest<T>(signal, (done) =>
		start((error, value) =>
			done(error ? remoteError(error) : undefined, value),
		),
	);
}

function attributes(stats: Stats) {
	const { size, uid, gid, mode, mtime } = stats;
	if (
		![size, uid, gid, mode, mtime].every(
			(value) => Number.isSafeInteger(value) && value >= 0,
		)
	) {
		throw new SshError("remote_error");
	}
	if ((mode & 0o170000) !== 0o100000) throw new SshError("not_regular_file");
	return { size, uid, gid, mode, mtime };
}

async function read(
	sftp: SFTPWrapper,
	input: SshFileRequest,
	signal: AbortSignal,
) {
	// Refuse a known special file before open. The handle is checked again below.
	attributes(
		await fileRequest<Stats>(signal, (done) => sftp.lstat(input.path, done)),
	);
	const handle = await fileRequest<Buffer>(signal, (done) =>
		sftp.open(input.path, "r", done),
	);
	const before = attributes(
		await fileRequest<Stats>(signal, (done) => sftp.fstat(handle, done)),
	);
	if (before.size > input.maxBytes) throw new SshError("too_large");
	const chunks: Buffer[] = [];
	let size = 0;
	while (true) {
		// One extra byte detects growth beyond the limit without trusting stat.
		const chunk = Buffer.alloc(Math.min(32 * 1024, input.maxBytes - size + 1));
		const count = await fileRequest<number>(signal, (done) => {
			sftp.read(handle, chunk, 0, chunk.length, size, (error, bytesRead) =>
				done(error, bytesRead),
			);
		});
		if (!Number.isSafeInteger(count) || count < 0 || count > chunk.length)
			throw new SshError("remote_error");
		if (count === 0) break;
		size += count;
		if (size > input.maxBytes) throw new SshError("too_large");
		chunks.push(chunk.subarray(0, count));
	}
	const after = attributes(
		await fileRequest<Stats>(signal, (done) => sftp.fstat(handle, done)),
	);
	if (
		size !== before.size ||
		size !== after.size ||
		before.mtime !== after.mtime ||
		before.mode !== after.mode ||
		before.uid !== after.uid ||
		before.gid !== after.gid
	) {
		throw new SshError("changed_during_read");
	}
	await fileRequest<void>(signal, (done) =>
		sftp.close(handle, (error) => done(error ?? undefined, undefined)),
	);
	return {
		bytes: new Uint8Array(Buffer.concat(chunks, size)),
		attributes: after,
	};
}

/**
 * Read one bounded regular file. No retries or atomic-snapshot claim: a path can
 * change after open, and equal-size writes can evade SFTP's timestamp precision.
 */
export async function readSshFile(
	options: SshFileRequest,
): Promise<SshFileObservation> {
	const input = { ...options };
	if (
		!input.path.startsWith("/") ||
		input.path.includes("\0") ||
		Buffer.from(input.path, "utf8").toString("utf8") !== input.path ||
		!Number.isSafeInteger(input.maxBytes) ||
		input.maxBytes < 1 ||
		input.maxBytes > 512 * 1024
	) {
		throw new SshError("invalid_request");
	}
	const startedAt = Date.now();
	return withSshConnection(input, async ({ client, signal, fail }) => {
		const sftp = await protocolRequest<SFTPWrapper>(signal, (done) => {
			client.sftp((error, channel) =>
				done(error ? new SshError("sftp_unavailable") : undefined, channel),
			);
		});
		sftp.on("error", () => fail(new SshError("remote_error")));
		sftp.on("close", () => fail(new SshError("connection_closed")));
		const result = await read(sftp, input, signal);
		return { ...result, startedAt, finishedAt: Date.now() };
	});
}
