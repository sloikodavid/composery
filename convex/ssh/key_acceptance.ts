"use node";

import ssh2, {
	type AgentAuthMethod,
	type ParsedKey,
	type SignCallback,
} from "ssh2";
import { callSsh, type SshTarget, withSshClient } from "./connection";
import { SshError } from "./errors";

const { BaseAgent, utils } = ssh2;

export type SshKeyAcceptance = "accepted" | "refused";

/** Offers one public key and reports when the server asks for its signature, which it never gives. */
class AcceptanceAgent extends BaseAgent<ParsedKey> {
	readonly #key: ParsedKey;
	readonly #onAccepted: () => void;

	constructor(key: ParsedKey, onAccepted: () => void) {
		super();
		this.#key = key;
		this.#onAccepted = onAccepted;
	}

	getIdentities(cb: (error?: Error | null, keys?: ParsedKey[]) => void) {
		cb(null, [this.#key]);
	}

	sign(
		_key: ParsedKey,
		_data: Buffer,
		optionsOrCallback: unknown,
		callback?: SignCallback,
	) {
		this.#onAccepted();
		const done =
			typeof optionsOrCallback === "function"
				? (optionsOrCallback as SignCallback)
				: callback;
		done?.(new Error("Composery never signs when it asks about a key."));
	}
}

/**
 * Asks the running SSH server whether it would let this public key sign in to the target's account.
 * The protocol lets a client ask with the public key alone: the server either refuses it or asks for
 * a signature, and the question stops there, so no private key is needed and no session opens. The
 * server answers from Composery's own address, so a key restricted to other addresses reads as
 * refused here and still works for its owner.
 */
export async function discoverSshKeyAcceptance(
	target: SshTarget,
	publicKey: Readonly<{ type: string; base64: string }>,
): Promise<SshKeyAcceptance> {
	const parsed = utils.parseKey(`${publicKey.type} ${publicKey.base64}`);
	if (parsed instanceof Error || Array.isArray(parsed)) {
		throw new SshError("invalid_request");
	}
	try {
		return await withSshClient(target, async ({ client, signal, connect }) =>
			callSsh<SshKeyAcceptance>(signal, (done) => {
				client.once("ready", () =>
					done(new SshError("invalid_response"), "refused"),
				);
				const query: AgentAuthMethod = {
					type: "agent",
					username: target.username,
					agent: new AcceptanceAgent(parsed, () => done(undefined, "accepted")),
				};
				connect({ authHandler: [query] });
			}),
		);
	} catch (error) {
		if (error instanceof SshError && error.code === "authentication_failed") {
			return "refused";
		}
		throw error;
	}
}
