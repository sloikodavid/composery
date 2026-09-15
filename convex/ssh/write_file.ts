"use node";

import type { ClientChannel } from "ssh2";
import {
	callSsh,
	commandExitCodes,
	type SshConnectionOptions,
	toSshProgramCommand,
	withSshConnection,
} from "./connection";
import { SshError } from "./errors";
import { maxSshFileBytes, type SshFileObservation } from "./read_file";
import { writeFileScript } from "./scripts/write_file";

const maxPathBytes = 4096;
const maxOutputBytes = 256;

const writeStatuses = [
	"written",
	"unchanged",
	"changed",
	"busy",
	"uncertain",
	"file_missing",
	"permission_denied",
	"unsupported_file",
	"too_large",
	"invalid_request",
	"deadline_exceeded",
	"write_failed",
	"metadata_not_preserved",
	"command_unavailable",
] as const;
export type SshFileWriteResult = {
	status: (typeof writeStatuses)[number];
	startedAt: number;
	finishedAt: number;
};

/**
 * Replaces one file only when its observed bytes and metadata still match. The
 * caller binds the observation to this server and path, and validates the candidate.
 * A lost response after dispatch is uncertain: never retry an edit automatically.
 * Needs /usr/bin/python3. A crash can leave a private staging file behind.
 */
export async function writeSshFile(
	connection: SshConnectionOptions,
	path: string,
	expected: SshFileObservation,
	candidate: Uint8Array,
): Promise<SshFileWriteResult> {
	if (
		!path.startsWith("/") ||
		path.includes("\0") ||
		path
			.slice(1)
			.split("/")
			.some((part) => !part || part === "." || part === "..") ||
		Buffer.from(path, "utf8").toString("utf8") !== path ||
		Buffer.byteLength(path) > maxPathBytes ||
		expected.bytes.length > maxSshFileBytes ||
		candidate.length > maxSshFileBytes ||
		expected.attributes.size !== expected.bytes.length ||
		!Object.values(expected.attributes).every(
			(value) => Number.isSafeInteger(value) && value >= 0,
		)
	) {
		throw new SshError("invalid_request");
	}
	const input = Buffer.from(
		JSON.stringify({
			path,
			expected: Buffer.from(expected.bytes).toString("base64"),
			candidate: Buffer.from(candidate).toString("base64"),
			attributes: expected.attributes,
		}),
	);
	const command = toSshProgramCommand(writeFileScript);
	const startedAt = Date.now();
	let dispatched = false;
	try {
		const status = await withSshConnection(
			connection,
			async ({ client, signal, fail }) => {
				const channel = await callSsh<ClientChannel>(signal, (done) => {
					client.exec(command, (error, stream) =>
						done(error ?? undefined, stream),
					);
				});
				return callSsh<SshFileWriteResult["status"]>(signal, (done) => {
					const output: Buffer[] = [];
					let size = 0;
					let exitCode: number | null | undefined;
					channel.on("data", (chunk: Buffer) => {
						size += chunk.length;
						if (size > maxOutputBytes) {
							fail(new SshError("output_limit"));
						} else {
							output.push(Buffer.from(chunk));
						}
					});
					channel.stderr.on("data", (chunk: Buffer) => {
						size += chunk.length;
						if (size > maxOutputBytes) {
							fail(new SshError("output_limit"));
						}
					});
					channel.on("error", () => fail(new SshError("remote_error")));
					channel.stderr.on("error", () => fail(new SshError("remote_error")));
					channel.on("exit", (code: number | null) => {
						exitCode = code;
					});
					channel.on("close", () => {
						const text = Buffer.concat(output).toString("utf8");
						if (
							typeof exitCode === "number" &&
							commandExitCodes.has(exitCode) &&
							!text
						) {
							done(undefined, "command_unavailable");
							return;
						}
						const result = writeStatuses.find((value) => text === `${value}\n`);
						if (exitCode !== 0 || !result) {
							fail(new SshError("invalid_response"));
						} else {
							done(undefined, result);
						}
					});
					dispatched = true;
					channel.end(input);
				});
			},
		);
		return { status, startedAt, finishedAt: Date.now() };
	} catch (error) {
		if (!dispatched) {
			throw error;
		}
		return { status: "uncertain", startedAt, finishedAt: Date.now() };
	}
}
