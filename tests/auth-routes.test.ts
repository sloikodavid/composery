import { describe, expect, test } from "vitest";

import { readRepoFile } from "./support/patchSource.ts";

// Overlay route files compile with code-server's tsconfig, so they cannot be
// imported here (see tests/support and the overlay typecheck script); their
// behavior is exercised by the smoke. These tests pin the security wiring of
// the register / reset-password flows at the source level so a refactor
// cannot silently drop it.

const register = readRepoFile(
	"packages/ide/overlay/src/node/routes/register.ts"
);
const resetPassword = readRepoFile(
	"packages/ide/overlay/src/node/routes/resetPassword.ts"
);

describe("register route", () => {
	test("rejects cross-origin POSTs (drive-by workspace claim)", () => {
		expect(register).toContain('router.post("/", ensureOrigin,');
	});

	test("refuses to run once a password is managed or configured", () => {
		const guard = register.indexOf(
			"isEnvPasswordManaged(req) || hasPassword(req)"
		);
		const post = register.indexOf('router.post("/"');
		expect(guard).toBeGreaterThanOrEqual(0);
		expect(post).toBeGreaterThan(guard);
	});
});

describe("reset-password route", () => {
	test("rejects cross-origin POSTs", () => {
		expect(resetPassword).toContain('router.post("/", ensureOrigin,');
	});

	test("rate limits before validating the current password", () => {
		expect(resetPassword).toContain('import { RateLimiter } from "./login"');

		const canTry = resetPassword.indexOf("limiter.canTry()");
		const validate = resetPassword.indexOf(
			"validateExistingPassword(req, currentPassword)"
		);
		expect(canTry).toBeGreaterThanOrEqual(0);
		expect(validate).toBeGreaterThan(canTry);
	});

	test("failed current-password checks consume a rate-limit token", () => {
		const validate = resetPassword.indexOf(
			"validateExistingPassword(req, currentPassword)"
		);
		const removeToken = resetPassword.indexOf("limiter.removeToken()");
		const incorrectRedirect = resetPassword.indexOf(
			'{ error: "incorrect-current" }'
		);
		expect(removeToken).toBeGreaterThan(validate);
		expect(incorrectRedirect).toBeGreaterThan(removeToken);
	});

	test("requires an authenticated session before serving the form", () => {
		const auth = resetPassword.indexOf("await authenticated(req)");
		const get = resetPassword.indexOf('router.get("/"');
		expect(auth).toBeGreaterThanOrEqual(0);
		expect(get).toBeGreaterThan(auth);
	});
});
