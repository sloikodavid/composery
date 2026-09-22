"use node";

import {
	commandExitCodes,
	runSshCommand,
	type SshConnection,
	toSshProgramCommand,
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

/** Replaces only the observed file; lost responses are uncertain and callers must not retry automatically. */
export async function writeSshFile(
	connection: SshConnection,
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
		const result = await runSshCommand(connection, command, {
			input,
			maxOutputBytes,
			onDispatch: () => {
				dispatched = true;
			},
		});
		if (
			typeof result.exitCode === "number" &&
			commandExitCodes.has(result.exitCode) &&
			!result.stdout
		) {
			return {
				status: "command_unavailable",
				startedAt,
				finishedAt: Date.now(),
			};
		}
		const status = writeStatuses.find(
			(value) => result.stdout === `${value}\n`,
		);
		if (result.exitCode !== 0 || status === undefined) {
			throw new SshError("invalid_response");
		}

		return { status, startedAt, finishedAt: Date.now() };
	} catch (error) {
		if (!dispatched) {
			throw error;
		}
		return { status: "uncertain", startedAt, finishedAt: Date.now() };
	}
}
