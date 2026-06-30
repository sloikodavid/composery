import { ConvexError } from "convex/values";
import { argon2id } from "hash-wasm";

export async function hashBoxPassword(password: string) {
	if (!password) {
		throw new ConvexError("Box password is required.");
	}

	const salt = new Uint8Array(16);
	crypto.getRandomValues(salt);

	return await argon2id({
		password,
		salt,
		parallelism: 1,
		iterations: 2,
		memorySize: 19_456,
		hashLength: 32,
		outputType: "encoded"
	});
}
