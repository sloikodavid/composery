import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { readRepoFile } from "./support/patchSource.ts";

type PasswordCheck = {
	checkPwned(password: string, signal?: AbortSignal): Promise<number>;
	checkStrength(password: string): { message: string; ok: boolean };
};

function loadPasswordCheck(
	fetch: typeof globalThis.fetch,
	{ subtle = true }: { subtle?: boolean } = {}
) {
	const window: { composeryPasswordCheck?: PasswordCheck } = {};
	const context: Record<string, unknown> = {
		AbortController,
		DataView,
		fetch,
		Set,
		TextEncoder,
		Uint32Array,
		Uint8Array,
		window
	};
	if (subtle) context.crypto = webcrypto;
	vm.runInContext(
		readRepoFile("packages/ide/overlay/src/browser/pages/password-check.js"),
		vm.createContext(context)
	);
	if (!window.composeryPasswordCheck) throw new Error("Password check missing");
	return window.composeryPasswordCheck;
}

describe("IDE password guidance", () => {
	afterEach(() => vi.restoreAllMocks());

	test("keeps the former website strength rules with quiet copy", () => {
		const check = loadPasswordCheck(vi.fn());
		expect(check.checkStrength("short")).toEqual({
			message: "Use at least 12 characters.",
			ok: false
		});
		expect(check.checkStrength("password12345")).toEqual({
			message: "Use a less common password.",
			ok: false
		});
		expect(check.checkStrength("aaaazzzzqqqq")).toEqual({
			message: "Avoid repeated characters.",
			ok: false
		});
		// A strong password stays silent - only problems get a message.
		expect(check.checkStrength("correct horse battery staple")).toEqual({
			message: "",
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

	test("hashes without crypto.subtle (plain-HTTP boxes lack it)", async () => {
		const fetch = vi.fn(async () =>
			Promise.resolve(
				new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n")
			)
		) as typeof globalThis.fetch;
		const check = loadPasswordCheck(fetch, { subtle: false });

		await expect(check.checkPwned("password")).resolves.toBe(3_730_471);
		expect(fetch).toHaveBeenCalledWith(
			"https://api.pwnedpasswords.com/range/5BAA6",
			expect.objectContaining({ headers: { "Add-Padding": "true" } })
		);
	});

	test("fallback matches Node's SHA-1 across block boundaries", async () => {
		const password = "multi-block ".repeat(6);
		const hash = createHash("sha1")
			.update(password)
			.digest("hex")
			.toUpperCase();
		const fetch = vi.fn(async () =>
			Promise.resolve(new Response(`${hash.slice(5)}:42\n`))
		) as typeof globalThis.fetch;
		const check = loadPasswordCheck(fetch, { subtle: false });

		await expect(check.checkPwned(password)).resolves.toBe(42);
		expect(fetch).toHaveBeenCalledWith(
			`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
			expect.objectContaining({ headers: { "Add-Padding": "true" } })
		);
	});

	test("stages one input at a time around a single fixed status slot", () => {
		for (const file of [
			"login-fields.html",
			"register-fields.html",
			"change-password-fields.html"
		]) {
			const source = readRepoFile(
				`packages/ide/overlay/src/browser/pages/${file}`
			);
			expect(source).toContain("data-stage");
			expect(source).toContain('data-status aria-live="polite">{{ERROR}}');
			expect(source).not.toContain("minlength");
			expect(source).not.toContain("maxlength");
		}
		for (const file of [
			"register-fields.html",
			"change-password-fields.html"
		]) {
			const source = readRepoFile(
				`packages/ide/overlay/src/browser/pages/${file}`
			);
			expect(source).toContain("data-password-input");
			expect(source).toContain("data-password-confirm");
			expect(source).toContain("data-crumb");
		}
		for (const file of ["register.ts", "changePassword.ts"]) {
			expect(
				readRepoFile(`packages/ide/overlay/src/node/routes/${file}`)
			).not.toContain("passwordPolicy");
		}
		expect(
			readRepoFile(
				"packages/ide/overlay/src/browser/pages/change-password-fields.html"
			)
		).toContain('autocomplete="current-password"');
	});

	test("advises without ever blocking, quietly when it cannot check", () => {
		const client = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.js"
		);
		expect(client).toContain('label = "Use anyway?"');
		// A breach found by the confirming click only reveals its red state;
		// submitting anyway takes a second, informed click.
		expect(client).toContain('result === "found" && !alreadyBreached');
		// An unavailable check proceeds silently instead of nagging.
		expect(client).not.toContain("Breach check unavailable");
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

	test("keeps motion restrained and reserves space so nothing displaces", () => {
		const styles = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.css"
		);
		const globalStyles = readRepoFile(
			"packages/ide/overlay/src/browser/pages/global.css"
		);

		// Fade only - the website's page enter, no slide-in.
		expect(globalStyles).toContain("@keyframes page-fade-in");
		expect(styles).not.toContain("translateY(8px)");
		expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
		// The status line keeps its height while empty and never wraps; the old
		// display:none-while-empty layout shifted the form on every message.
		expect(styles).toMatch(/\.auth-status \{[^}]*min-height: 16px/s);
		expect(styles).toMatch(/\.auth-status \{[^}]*white-space: nowrap/s);
		expect(styles).not.toContain(":empty");
	});
});
