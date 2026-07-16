import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { readRepoFile } from "./support/patchSource.ts";

type PasswordCheck = {
	checkPwned(password: string, signal?: AbortSignal): Promise<number>;
	checkStrength(password: string): { message: string; ok: boolean };
};

function loadPasswordCheck(fetch: typeof globalThis.fetch) {
	const window: { composeryPasswordCheck?: PasswordCheck } = {};
	vm.runInContext(
		readRepoFile("packages/ide/overlay/src/browser/pages/password-check.js"),
		vm.createContext({
			AbortController,
			crypto: webcrypto,
			fetch,
			Set,
			TextEncoder,
			Uint8Array,
			window
		})
	);
	if (!window.composeryPasswordCheck) throw new Error("Password check missing");
	return window.composeryPasswordCheck;
}

describe("IDE password guidance", () => {
	afterEach(() => vi.restoreAllMocks());

	test("matches the former website strength guidance without blocking", () => {
		const check = loadPasswordCheck(vi.fn());
		expect(check.checkStrength("short")).toEqual({
			message: "Use at least 12 characters.",
			ok: false
		});
		expect(check.checkStrength("password12345")).toEqual({
			message: "Use a less common password.",
			ok: false
		});
		expect(check.checkStrength("correct horse battery staple")).toEqual({
			message: "Looks strong. We will check breaches before continuing.",
			ok: true
		});
	});

	test("sends only the SHA-1 prefix and matches the suffix locally", async () => {
		const fetch = vi.fn(async () =>
			Promise.resolve(
				new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n")
			)
		) as typeof globalThis.fetch;
		const check = loadPasswordCheck(fetch);

		await expect(check.checkPwned("password")).resolves.toBe(3_730_471);
		expect(fetch).toHaveBeenCalledWith(
			"https://api.pwnedpasswords.com/range/5BAA6",
			expect.objectContaining({ headers: { "Add-Padding": "true" } })
		);
	});

	test("uses the same advisory single-page flow for create and change", () => {
		for (const file of [
			"register-fields.html",
			"change-password-fields.html"
		]) {
			const source = readRepoFile(
				`packages/ide/overlay/src/browser/pages/${file}`
			);
			expect(source).toContain("data-password-input");
			expect(source).toContain("data-password-confirm");
			expect(source).toContain("data-password-submit");
			expect(source).toContain("data-password-status");
			expect(source).not.toContain("data-password-step");
			expect(source).not.toContain("hidden");
			expect(source).not.toContain("minlength");
			expect(source).not.toContain("maxlength");
		}
		for (const file of ["register.ts", "changePassword.ts"]) {
			expect(
				readRepoFile(`packages/ide/overlay/src/node/routes/${file}`)
			).not.toContain("passwordPolicy");
		}
		const client = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.js"
		);
		expect(
			readRepoFile(
				"packages/ide/overlay/src/browser/pages/change-password-fields.html"
			)
		).toContain('autocomplete="current-password"');
		expect(client).toContain('label = "Use anyway?"');
		expect(client).toContain('result === "found" && !alreadyBreached');
		expect(client).toContain('"Breach check unavailable. You can continue."');
	});

	test("loads breach checking only on password pages", () => {
		const renderer = readRepoFile(
			"packages/ide/overlay/src/node/routes/authPage.ts"
		);
		expect(renderer).toContain(
			'page === "register" || page === "change-password"'
		);
		expect(renderer).toContain("password-check.js");
	});

	test("keeps motion restrained and avoids artificial form navigation", () => {
		const register = readRepoFile(
			"packages/ide/overlay/src/browser/pages/register-fields.html"
		);
		const reset = readRepoFile(
			"packages/ide/overlay/src/browser/pages/change-password-fields.html"
		);
		const client = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.js"
		);
		const styles = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.css"
		);

		expect(register).not.toContain("auth-steps");
		expect(reset).not.toContain("auth-steps");
		expect(client).not.toContain("function showStep");
		expect(styles).toContain("@keyframes auth-page-enter");
		expect(styles).not.toContain("@keyframes auth-step-enter");
		expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
	});
});
