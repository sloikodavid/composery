"use node";

import type { SFTPWrapper, Stats } from "ssh2";
import {
	callSsh,
	type SshConnectionOptions,
	SshError,
	type SshFailure,
	withSshConnection,
} from "./connection";

/** Remote SSH file operations read and write at most this many bytes. */
// 512 KiB.
export const maxSshFileBytes = 524_288;
// 32 KiB.
const readChunkBytes = 32_768;
const fileTypeMask = 0o17_0000;
const regularFileType = 0o10_0000;

// SFTP status codes from draft-ietf-secsh-filexfer-02.
const sftpNoSuchFile = 2;
const sftpPermissionDenied = 3;
const sftpStatusFailures = new Map<unknown, SshFailure>([
	[sftpNoSuchFile, "file_missing"],
	[sftpPermissionDenied, "permission_denied"],
]);

export type SshReadOptions = SshConnectionOptions &
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

function toSshError(error: unknown) {
	if (error instanceof SshError) {
		return error;
	}
	const code =
		error && typeof error === "object" && "code" in error ? error.code : null;
	return new SshError(sftpStatusFailures.get(code) ?? "remote_error");
}

function callSftp<T>(
	signal: AbortSignal,
	start: (done: (error: Error | undefined, value: T) => void) => void,
) {
	return callSsh<T>(signal, (done) =>
		start((error, value) => done(error ? toSshError(error) : undefined, value)),
	);
}

function toFileAttributes(stats: Stats) {
	const { size, uid, gid, mode, mtime } = stats;
	if (
		![size, uid, gid, mode, mtime].every(
			(value) => Number.isSafeInteger(value) && value >= 0,
		)
	) {
		throw new SshError("remote_error");
	}
	if ((mode & fileTypeMask) !== regularFileType) {
		throw new SshError("not_regular_file");
	}
	return { size, uid, gid, mode, mtime };
}

async function read(
	sftp: SFTPWrapper,
	input: SshReadOptions,
	signal: AbortSignal,
) {
	// Refuse a known special file before open. The handle is checked again below.
	toFileAttributes(
		await callSftp<Stats>(signal, (done) => sftp.lstat(input.path, done)),
	);
	const handle = await callSftp<Buffer>(signal, (done) =>
		sftp.open(input.path, "r", done),
	);
	const before = toFileAttributes(
		await callSftp<Stats>(signal, (done) => sftp.fstat(handle, done)),
	);
	if (before.size > input.maxBytes) {
		throw new SshError("too_large");
	}
	const chunks: Buffer[] = [];
	let size = 0;
	for (;;) {
		// One extra byte detects growth beyond the limit without trusting stat.
		const chunk = Buffer.alloc(
			Math.min(readChunkBytes, input.maxBytes - size + 1),
		);
		const count = await callSftp<number>(signal, (done) => {
			sftp.read(handle, chunk, 0, chunk.length, size, (error, bytesRead) =>
				done(error, bytesRead),
			);
		});
		if (!Number.isSafeInteger(count) || count < 0 || count > chunk.length) {
			throw new SshError("remote_error");
		}
		if (count === 0) {
			break;
		}
		size += count;
		if (size > input.maxBytes) {
			throw new SshError("too_large");
		}
		chunks.push(chunk.subarray(0, count));
	}
	const after = toFileAttributes(
		await callSftp<Stats>(signal, (done) => sftp.fstat(handle, done)),
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
	await callSftp<void>(signal, (done) =>
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
	options: SshReadOptions,
): Promise<SshFileObservation> {
	const input = { ...options };
	if (
		!input.path.startsWith("/") ||
		input.path.includes("\0") ||
		Buffer.from(input.path, "utf8").toString("utf8") !== input.path ||
		!Number.isSafeInteger(input.maxBytes) ||
		input.maxBytes < 1 ||
		input.maxBytes > maxSshFileBytes
	) {
		throw new SshError("invalid_request");
	}
	const startedAt = Date.now();
	return await withSshConnection(input, async ({ client, signal, fail }) => {
		const sftp = await callSsh<SFTPWrapper>(signal, (done) => {
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
