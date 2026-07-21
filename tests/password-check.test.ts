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
			message: "Too short",
			ok: false
		});
		expect(check.checkStrength("password12345")).toEqual({
			message: "Too common",
			ok: false
		});
		expect(check.checkStrength("aaaazzzzqqqq")).toEqual({
			message: "Too repetitive",
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
		expect(fetch).toHaveBeenCalledWith("/_composery/pwned/5BAA6", {
			signal: undefined
		});
	});

	test("hashes without crypto.subtle (plain-HTTP boxes lack it)", async () => {
		const fetch = vi.fn(async () =>
			Promise.resolve(
				new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n")
			)
		) as typeof globalThis.fetch;
		const check = loadPasswordCheck(fetch, { subtle: false });

		await expect(check.checkPwned("password")).resolves.toBe(3_730_471);
		expect(fetch).toHaveBeenCalledWith("/_composery/pwned/5BAA6", {
			signal: undefined
		});
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
			`/_composery/pwned/${hash.slice(0, 5)}`,
			{ signal: undefined }
		);
	});

	test("the client only ever talks to its own origin for the check", () => {
		const client = readRepoFile(
			"packages/ide/overlay/src/browser/pages/password-check.js"
		);
		// The core fix: the browser fetches the box's same-origin relay, never a
		// third-party API cross-origin (which hung behind strict networks).
		expect(client).toContain("/_composery/pwned/");
		expect(client).not.toContain("api.pwnedpasswords.com");
	});

	test("the box relays the range request server-side, with padding", () => {
		const pwned = readRepoFile("packages/ide/overlay/src/node/routes/pwned.ts");
		const authPatch = readRepoFile("packages/ide/patches/auth.diff");
		// A dedicated router in Composery's machine-endpoint namespace, mounted
		// unconditionally so both password pages reach it. It validates the prefix
		// and does the padded upstream fetch under a timeout - the box, not the
		// browser, reaches the API.
		expect(pwned).toContain('router.get("/:prefix"');
		expect(pwned).toContain("api.pwnedpasswords.com/range/");
		expect(pwned).toContain('"Add-Padding": "true"');
		expect(pwned).toContain("AbortSignal.timeout");
		expect(pwned).toContain("/^[A-F0-9]{5}$/");
		expect(authPatch).toContain(
			'app.router.use("/_composery/pwned", pwnedRoute.router)'
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

	test("keeps the two-click breach friction, bounded so a box never hangs", () => {
		const client = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.js"
		);
		expect(client).toContain("checkPwned");
		expect(client).toContain('status: count > 0 ? "found" : "clear"');
		// A breach found by the confirming click only reveals its red state;
		// using the password anyway takes a second, informed click. Weak (amber)
		// and breached (red) carry distinct labels so they cannot be confused.
		expect(client).toContain('label = "Use anyway?"');
		expect(client).toContain('label = "Use it anyway"');
		expect(client).toContain('result === "found" && !alreadyBreached');
		// The check is a same-origin call the box bounds itself; the abort here is
		// only a last-resort ceiling, and a failed check resolves to "unavailable"
		// (proceed unchecked) instead of leaving the button spinning.
		expect(client).toContain("controller.abort()");
		expect(client).toContain('status: "unavailable"');
	});

	test("submits reliably: active-only required, and never re-enters submit", () => {
		const client = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.js"
		);
		// A required input inside a display:none stage is not focusable, so the
		// browser silently refuses to submit the whole form (the submit event
		// never fires and the button looks dead). Only the visible stage carries
		// the constraint.
		expect(client).toContain('toggleAttribute("required", index === current)');
		// requestSubmit() from inside the submit-event dispatch is a spec no-op;
		// the final POST goes out via a direct, deferred form.submit() instead.
		expect(client).toContain("form.submit()");
		expect(client).not.toContain("requestSubmit");
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
		// The label row is locked, not merely reserved. Baseline alignment made it
		// 20px or 21px depending on whether a message was showing (an empty status
		// box has no text baseline), and every element below inherited that 1px
		// jump - measured live at one frame's resolution.
		expect(styles).toMatch(/\.auth-head \{[^}]*height: 20px/s);
		expect(styles).not.toMatch(/\.auth-head \{[^}]*align-items: baseline/s);
		// No blue/grey flash over pressed controls in app WebViews.
		expect(globalStyles).toContain("-webkit-tap-highlight-color: transparent");
	});

	test("the confirming step reads as deliberate, not as a restart", () => {
		const client = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.js"
		);
		const styles = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.css"
		);
		// Once the entries agree the finishing button turns success-green.
		expect(client).toContain('variant = "success"');
		expect(styles).toContain(".submit-button.success");
	});

	test("a wrong current password fails at its own step, not after three", () => {
		const route = readRepoFile(
			"packages/ide/overlay/src/node/routes/changePassword.ts"
		);
		const fields = readRepoFile(
			"packages/ide/overlay/src/browser/pages/change-password-fields.html"
		);
		const client = readRepoFile(
			"packages/ide/overlay/src/browser/pages/auth.js"
		);

		expect(route).toContain('router.post("/verify"');
		// Shares the submit limiter, so guessing here is not a way around login's.
		expect(route).toContain("limiter.canTry()");
		expect(route).toContain("limiter.removeToken()");
		// An explicit result body, because unrelated middleware also answers 401.
		expect(route).toContain("valid: false");
		expect(fields).toContain('data-verify="{{BASE}}/change-password/verify"');
		expect(client).toContain('typeof body.valid !== "boolean"');
	});
});
