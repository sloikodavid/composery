import { describe, expect, test } from "vitest";

import { readRepoFile } from "./support/patchSource.ts";

// Overlay route files compile with the upstream IDE tsconfig, so they cannot be
// imported here (see tests/support and the overlay typecheck script); their
// behavior is exercised by the smoke. These tests pin the security wiring of
// the register / change-password flows at the source level so a refactor
// cannot silently drop it.

const register = readRepoFile(
	"packages/ide/overlay/src/node/routes/register.ts"
);
const changePassword = readRepoFile(
	"packages/ide/overlay/src/node/routes/changePassword.ts"
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

	test("only a cloud setup grant may bypass the configured-password guard", () => {
		const grantBypass = register.indexOf(
			"cloudConfig && hasCloudSetupGrant(req)"
		);
		const guard = register.indexOf(
			"isEnvPasswordManaged(req) || hasPassword(req)"
		);
		expect(grantBypass).toBeGreaterThanOrEqual(0);
		expect(grantBypass).toBeLessThan(guard);
		// Overwriting an existing password is the cloud change/recovery flow;
		// self-hosted registration must never overwrite.
		expect(register).toContain("allowExisting: !!cloudConfig");
	});
});

describe("change-password route", () => {
	test("rejects cross-origin POSTs", () => {
		expect(changePassword).toContain('router.post("/", ensureOrigin,');
	});

	test("cloud boxes divert into the grant flow before any handler", () => {
		const cloudRedirect = changePassword.indexOf(
			'redirect(req, res, "_composery/cloud/authorize"'
		);
		const get = changePassword.indexOf('router.get("/"');
		expect(cloudRedirect).toBeGreaterThanOrEqual(0);
		expect(get).toBeGreaterThan(cloudRedirect);
	});

	test("rate limits before validating the current password", () => {
		expect(changePassword).toContain('import { RateLimiter } from "./login"');

		const canTry = changePassword.indexOf("limiter.canTry()");
		const validate = changePassword.indexOf(
			"validateExistingPassword(req, currentPassword)"
		);
		expect(canTry).toBeGreaterThanOrEqual(0);
		expect(validate).toBeGreaterThan(canTry);
	});

	test("failed current-password checks consume a rate-limit token", () => {
		const validate = changePassword.indexOf(
			"validateExistingPassword(req, currentPassword)"
		);
		const removeToken = changePassword.indexOf("limiter.removeToken()");
		const incorrectRedirect = changePassword.indexOf(
			'error: "incorrect-current"'
		);
		expect(removeToken).toBeGreaterThan(validate);
		expect(incorrectRedirect).toBeGreaterThan(removeToken);
	});

	test("self-hosted writes require the validated current password first", () => {
		const validate = changePassword.indexOf(
			"validateExistingPassword(req, currentPassword)"
		);
		const write = changePassword.indexOf("writeHashedPassword(req,");
		expect(validate).toBeGreaterThanOrEqual(0);
		expect(write).toBeGreaterThan(validate);
	});
});
