import { argon2Verify } from "hash-wasm";
import { describe, expect, it } from "vitest";
import { hashBoxPassword } from "./boxPassword";

describe("hashBoxPassword", () => {
	it("rejects an empty password", async () => {
		await expect(hashBoxPassword("")).rejects.toThrow(
			"Box password is required."
		);
	});

	it("produces an argon2id-encoded hash that verifies against the password", async () => {
		const hash = await hashBoxPassword("correct horse battery staple");
		expect(hash.startsWith("$argon2id$")).toBe(true);

		expect(
			await argon2Verify({
				password: "correct horse battery staple",
				hash
			})
		).toBe(true);
		expect(await argon2Verify({ password: "wrong password", hash })).toBe(
			false
		);
	});

	it("salts each hash so the same password never hashes identically", async () => {
		const [a, b] = await Promise.all([
			hashBoxPassword("same-password"),
			hashBoxPassword("same-password")
		]);
		expect(a).not.toBe(b);
	});
});
