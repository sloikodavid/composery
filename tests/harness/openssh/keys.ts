import type { AuthorizedKey } from "../../../convex/ssh/authorized_keys";
import { generateSshKeyPair } from "../../../convex/ssh/key_pair";

/** A new public key in the two fields an authorized key entry holds. */
export function generateAuthorizedKey(): AuthorizedKey {
	const [type = "", base64 = ""] = generateSshKeyPair().publicKey.split(" ");
	return { type, base64 };
}
