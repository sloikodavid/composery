import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkBoxPasswordStrength,
	checkPwnedBoxPassword
} from "./box-password-check";

describe("checkBoxPasswordStrength", () => {
	it("rejects empty, short, and common passwords", () => {
		expect(checkBoxPasswordStrength("").ok).toBe(false);
		expect(checkBoxPasswordStrength("short").message).toBe(
			"Use at least 12 characters."
		);
		expect(checkBoxPasswordStrength("password12345").message).toBe(
			"Use a less common password."
		);
	});

	it("accepts longer passphrases", () => {
		const result = checkBoxPasswordStrength("correct horse battery staple");

		expect(result.ok).toBe(true);
		expect(result.label).toBe("Strong");
	});
});

describe("checkPwnedBoxPassword", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("checks only the SHA-1 hash prefix and matches the suffix locally", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				[
					"00000000000000000000000000000000000:0",
					"1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471"
				].join("\r\n")
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkPwnedBoxPassword("password")).resolves.toBe(3_730_471);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.pwnedpasswords.com/range/5BAA6",
			expect.objectContaining({
				headers: {
					"Add-Padding": "true"
				}
			})
		);
	});

	it("returns zero when no suffix matches", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("00000000000000000000000000000000000:0"))
		);

		await expect(checkPwnedBoxPassword("not in this response")).resolves.toBe(
			0
		);
	});

	it("rejects failed breach lookups", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("Forbidden", { status: 403 }))
		);

		await expect(checkPwnedBoxPassword("password")).rejects.toThrow(
			"Pwned Passwords check failed."
		);
	});
});
