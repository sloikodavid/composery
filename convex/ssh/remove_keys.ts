"use node";

import { AuthorizedKeysFile } from "./authorized_keys";
import type { SshConnectionOptions } from "./connection";
import { SshError } from "./connection";
import type { SshFileObservation } from "./read_file";
import { writeSshFile } from "./write_file";

/**
 * Internal removal of occurrences from a caller's observation of this exact file.
 * The application must supply trusted connection/path data and authorize the user.
 * Removal does not require accepting a new key blob or option value. No key lookup
 * by fingerprint: duplicate occurrences retain their separate native meanings.
 */
export async function removeAuthorizedKeys(
	connection: SshConnectionOptions,
	path: string,
	observation: SshFileObservation,
	lines: readonly number[],
) {
	if (!lines.length || lines.length > 256)
		throw new SshError("invalid_request");
	// Copy all mutable request data before the first await.
	const expected = {
		...observation,
		bytes: Uint8Array.from(observation.bytes),
		attributes: { ...observation.attributes },
	};
	const edits = lines.map((line) => ({ kind: "remove" as const, line }));
	const file = new AuthorizedKeysFile(expected.bytes);
	const plan = file.plan(expected.bytes, edits);
	if (!plan.ok) throw new SshError("invalid_request");
	return writeSshFile(connection, path, expected, plan.candidate);
}
