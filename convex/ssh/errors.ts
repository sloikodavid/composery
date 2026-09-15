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
