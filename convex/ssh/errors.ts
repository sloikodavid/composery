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

/** Only stable codes escape this boundary; server text and secrets do not. */
export class SshError extends Error {
	readonly code: SshFailure;
	constructor(code: SshFailure) {
		super(code);
		this.name = "SshError";
		this.code = code;
	}
}

/**
 * One error for everything that can stop Composery from reaching a server with its own key.
 * The worker records the code, so a member sees which part is unavailable.
 */
export class SshAccessError extends Error {
	readonly code:
		| "allocation_unavailable"
		| "bootstrap_expired"
		| "bootstrap_url_insecure"
		| "encryption_key_invalid"
		| "encryption_key_missing"
		| "host_key_missing"
		| "secrets_unreadable";

	constructor(code: SshAccessError["code"]) {
		super(code);
		this.name = "SshAccessError";
		this.code = code;
	}
}
