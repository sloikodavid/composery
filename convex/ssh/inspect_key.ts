"use node";

import type { ClientChannel } from "ssh2";
import type { AuthorizedKey } from "./authorized_keys";
import {
	protocolRequest,
	type SshConnectionOptions,
	SshError,
	withSshConnection,
} from "./connection";

export type PublicKeyInspection =
	| { status: "parsed"; bits: number; fingerprint: string; type: string }
	| { status: "rejected" };

/**
 * Ask the target's OpenSSH to parse exactly one public key. This does not check
 * authorized-key options, daemon policy, certificate trust, or private-key possession.
 * Certificate fingerprints identify the underlying key, not the certificate bytes.
 */
export async function inspectPublicKey(
	connection: SshConnectionOptions,
	key: AuthorizedKey,
): Promise<PublicKeyInspection> {
	// Never interpolate user input into a command. Exclude options, comments,
	// private-key envelopes, and extra lines before passing one public key on stdin.
	if (
		!/^[a-zA-Z0-9][a-zA-Z0-9@._+-]{0,127}$/.test(key.type) ||
		key.base64.length > 128 * 1024 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(key.base64)
	) {
		throw new SshError("invalid_request");
	}
	const input = Buffer.from(`${key.type} ${key.base64}\n`, "ascii");
	return withSshConnection(connection, async ({ client, signal, fail }) => {
		const channel = await protocolRequest<ClientChannel>(signal, (done) => {
			client.exec(
				"LC_ALL=C /usr/bin/ssh-keygen -l -E sha256 -f -",
				(error, stream) =>
					done(error ? new SshError("command_unavailable") : undefined, stream),
			);
		});
		return protocolRequest<PublicKeyInspection>(signal, (done) => {
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let outputBytes = 0;
			let exitCode: number | undefined;
			let terminated = false;
			const receive = (data: Buffer, keep: boolean) => {
				outputBytes += data.length;
				if (outputBytes > 4096) {
					fail(new SshError("output_limit"));
					return;
				}
				(keep ? stdout : stderr).push(Buffer.from(data));
			};
			channel.on("data", (data: Buffer) => receive(data, true));
			channel.stderr.on("data", (data: Buffer) => receive(data, false));
			channel.on("error", () => fail(new SshError("remote_error")));
			channel.stderr.on("error", () => fail(new SshError("remote_error")));
			channel.on("exit", (code: number | null) => {
				if (typeof code === "number") exitCode = code;
				else terminated = true;
			});
			channel.on("close", () => {
				const reject = (code: "command_unavailable" | "invalid_response") =>
					fail(new SshError(code));
				if (terminated || exitCode === undefined) {
					reject("invalid_response");
					return;
				}
				if (exitCode === 126 || exitCode === 127) {
					reject("command_unavailable");
					return;
				}
				if (
					exitCode === 255 &&
					Buffer.concat(stderr).toString("utf8").trim() ===
						"(stdin) is not a public key file."
				) {
					// Native rejection does not distinguish malformed keys from an
					// algorithm unsupported by this particular OpenSSH build.
					if (stdout.length) {
						reject("invalid_response");
						return;
					}
					done(undefined, { status: "rejected" });
					return;
				}
				if (exitCode !== 0) {
					reject("invalid_response");
					return;
				}
				const output = Buffer.concat(stdout).toString("utf8");
				const match =
					/^(\d+) (SHA256:[A-Za-z0-9+/]{43}) no comment \(([A-Z0-9-]+)\)\n$/.exec(
						output,
					);
				const bits = Number(match?.[1]);
				if (
					!match?.[2] ||
					!match[3] ||
					!Number.isSafeInteger(bits) ||
					bits <= 0
				) {
					reject("invalid_response");
					return;
				}
				done(undefined, {
					status: "parsed",
					bits,
					fingerprint: match[2],
					type: match[3],
				});
			});
			channel.end(input);
		});
	});
}
