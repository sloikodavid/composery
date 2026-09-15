import { type ErrorCode, toConvexError } from "../errors";
import { SshError, type SshFailure } from "./errors";
import type { SshFileWriteResult } from "./write_file";

// biome-ignore-start lint/style/useNamingConvention: SSH failures and error codes use snake_case
/** Every way the server can refuse, stated as one public code. */
export const failureCodes: Record<SshFailure, ErrorCode> = {
	aborted: "server_unreachable",
	authentication_failed: "server_unreachable",
	changed_during_read: "file_changed",
	command_unavailable: "server_unsupported",
	connection_closed: "server_unreachable",
	connection_failed: "server_unreachable",
	deadline_exceeded: "server_unreachable",
	file_missing: "file_unwritable",
	host_key_mismatch: "server_unreachable",
	invalid_request: "edit_invalid",
	invalid_response: "server_unsupported",
	not_regular_file: "file_unwritable",
	output_limit: "server_unsupported",
	permission_denied: "file_unwritable",
	remote_error: "server_unreachable",
	sftp_unavailable: "server_unsupported",
	too_large: "file_unwritable",
};

/** Every outcome the write program reports, stated as one public code. */
export const writeCodes: Record<
	SshFileWriteResult["status"],
	ErrorCode | null
> = {
	busy: "file_changed",
	changed: "file_changed",
	command_unavailable: "server_unsupported",
	deadline_exceeded: "server_unreachable",
	file_missing: "file_unwritable",
	invalid_request: "edit_invalid",
	metadata_not_preserved: "file_unwritable",
	permission_denied: "file_unwritable",
	too_large: "file_unwritable",
	uncertain: "edit_uncertain",
	unchanged: null,
	unsupported_file: "file_unwritable",
	write_failed: "file_unwritable",
	written: null,
};
// biome-ignore-end lint/style/useNamingConvention: SSH failures and error codes use snake_case

/** Throws what a caller may see. Anything that is not an SSH failure is not ours to translate. */
export function toPublicSshError(error: unknown): never {
	if (error instanceof SshError) {
		throw toConvexError(failureCodes[error.code]);
	}
	throw error;
}
