export type SshFailure =
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

export class SshError extends Error {
	readonly code: SshFailure;
	constructor(code: SshFailure) {
		super(code);
		this.name = "SshError";
		this.code = code;
	}
}

/** Why Composery cannot use its own management access, before a server is reached. */
export type SshAccessFailure =
	| "allocation_deleting"
	| "allocation_unaddressed"
	| "bootstrap_expired"
	| "bootstrap_url_insecure"
	| "encryption_key_invalid"
	| "encryption_key_missing"
	| "encryption_key_unknown"
	| "host_key_missing"
	| "secrets_unreadable";

export class SshAccessError extends Error {
	readonly code: SshAccessFailure;

	constructor(code: SshAccessFailure) {
		super(code);
		this.name = "SshAccessError";
		this.code = code;
	}
}
