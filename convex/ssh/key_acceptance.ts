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

/** Probes public-key acceptance without signing in or sending the private key. */
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
