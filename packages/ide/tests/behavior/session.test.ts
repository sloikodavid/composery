import { describe, expect, test } from "vitest";

import {
	SESSION_LIFETIMES,
	createSessionToken,
	isSessionTokenValid,
	readSessionLifetime,
	sessionCookieOptions
} from "../../overlay/src/node/session.ts";

const NOW = Date.UTC(2026, 6, 27, 12);
const NONCE = "a".repeat(43);

describe("IDE sessions", () => {
	test("the default session lasts eight hours and expires on the server", () => {
		const args = { password: "correct horse battery staple" };
		const token = createSessionToken(args, NOW, NONCE);

		expect(isSessionTokenValid(token, args, NOW)).toBe(true);
		expect(
			isSessionTokenValid(
				token,
				args,
				NOW + SESSION_LIFETIMES["8h"].maxAgeSeconds * 1000 - 1
			)
		).toBe(true);
		expect(
			isSessionTokenValid(
				token,
				args,
				NOW + SESSION_LIFETIMES["8h"].maxAgeSeconds * 1000
			)
		).toBe(false);
	});

	test("tampering and password rotation both revoke a session", () => {
		const args = { "hashed-password": "$argon2id$old" };
		const token = createSessionToken(args, NOW, NONCE);
		const replacement = token.endsWith("A") ? "B" : "A";

		expect(
			isSessionTokenValid(`${token.slice(0, -1)}${replacement}`, args, NOW)
		).toBe(false);
		expect(
			isSessionTokenValid(token, { "hashed-password": "$argon2id$new" }, NOW)
		).toBe(false);
	});

	test("browser sessions are non-persistent but still have a signed 30-day cap", () => {
		const args = { password: "password" };
		const token = createSessionToken(args, NOW, NONCE, "browser");
		const options = sessionCookieOptions(
			{ path: "/ide/", sameSite: "lax", secure: true },
			"browser"
		);

		expect(options).toEqual({
			httpOnly: true,
			path: "/ide/",
			sameSite: "lax",
			secure: true
		});
		expect(
			isSessionTokenValid(
				token,
				args,
				NOW + SESSION_LIFETIMES["30d"].maxAgeSeconds * 1000
			)
		).toBe(false);
	});

	test("persistent policies put the same duration on the cookie", () => {
		for (const lifetime of ["8h", "1d", "7d", "30d"] as const) {
			expect(sessionCookieOptions({}, lifetime).maxAge).toBe(
				SESSION_LIFETIMES[lifetime].maxAgeSeconds * 1000
			);
		}
	});

	test("invalid configuration fails instead of silently changing security", () => {
		expect(readSessionLifetime(undefined)).toBe("8h");
		expect(() => readSessionLifetime("forever")).toThrow(
			/COMPOSERY_SESSION_LIFETIME must be one of/
		);
	});
});
