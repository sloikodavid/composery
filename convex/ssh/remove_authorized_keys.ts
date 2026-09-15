"use node";

import { AuthorizedKeysFile } from "./authorized_keys";
import type { SshConnectionOptions } from "./connection";
import { SshError } from "./connection";
import type { SshFileObservation } from "./read_file";
import { writeSshFile } from "./write_file";

const maxRemovedLines = 256;

/**
 * Removes occurrences from the caller's observation of this exact file. Lines, not
 * fingerprints: duplicate occurrences keep their separate native meanings.
 */
export async function removeAuthorizedKeys(
	connection: SshConnectionOptions,
	path: string,
	observation: SshFileObservation,
	lines: readonly number[],
) {
	if (lines.length === 0 || lines.length > maxRemovedLines) {
		throw new SshError("invalid_request");
	}
	// Copy all mutable request data before the first await.
	const expected = {
		...observation,
		bytes: Uint8Array.from(observation.bytes),
		attributes: { ...observation.attributes },
	};
	const edits = lines.map((line) => ({ kind: "remove" as const, line }));
	const file = new AuthorizedKeysFile(expected.bytes);
	const plan = file.plan(expected.bytes, edits);
	if (!plan.ok) {
		throw new SshError("invalid_request");
	}
	return await writeSshFile(connection, path, expected, plan.candidate);
}
