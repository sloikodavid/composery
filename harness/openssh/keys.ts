import type { AuthorizedKey } from "../../convex/ssh/authorized_keys";
import { generateSshKeyPair } from "../../convex/ssh/key_pair";

export function generateAuthorizedKey(): AuthorizedKey {
	const [type = "", base64 = ""] = generateSshKeyPair().publicKey.split(" ");
	return { type, base64 };
}
