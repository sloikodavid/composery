import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { readRepoFile, repoRoot } from "./support/patchSource.ts";

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

describe("auth page navigation", () => {
	const pagesDir = "packages/ide/overlay/src/browser/pages";
	const authPage = readRepoFile(`${pagesDir}/../../node/routes/authPage.ts`);

	test("every page but login offers a way back to sign in", () => {
		const fragments = readdirSync(resolve(repoRoot, pagesDir)).filter((name) =>
			name.endsWith("-fields.html")
		);
		expect(fragments).toContain("login-fields.html");
		for (const fragment of fragments) {
			const source = readRepoFile(`${pagesDir}/${fragment}`);
			// login is where the link points, so it carries the reverse edge.
			const expected =
				fragment === "login-fields.html"
					? "{{CHANGE_PASSWORD_LINK}}"
					: "{{SIGN_IN_LINK}}";
			expect(source, fragment).toContain(expected);
		}
	});

	test("the sign-in link is gated on a password existing", () => {
		// First-run registration has no password yet, so a sign-in link there
		// would lead to a page that cannot let anyone through.
		expect(authPage).toContain('page !== "login" && hasPassword(req)');
		expect(authPage).toContain('href="{{BASE}}/login">Sign in');
	});
});

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

	test("a grant cannot write a password the environment already outranks", () => {
		// Cloud box owners control their host, so COMPOSERY_PASSWORD on a cloud
		// box is reachable. It wins at every restart, so the grant flow has to
		// say so rather than store a password that silently stops working.
		const grantBypass = register.indexOf(
			"cloudConfig && hasCloudSetupGrant(req)"
		);
		const envGuard = register.indexOf('error: "env-managed"');
		expect(envGuard).toBeGreaterThan(grantBypass);
		// ...and inside the grant branch, before the handler can write.
		expect(envGuard).toBeLessThan(register.indexOf('router.get("/"'));
		// The login page has to be able to render the code this sends it.
		expect(readRepoFile("packages/ide/patches/auth.diff")).toContain(
			'+    case "env-managed":'
		);
	});
});

describe("change-password route", () => {
	test("rejects cross-origin POSTs", () => {
		expect(changePassword).toContain('router.post("/", ensureOrigin,');
	});

	test("cloud boxes change their password on the same terms as self-hosted", () => {
		// Holding the box password must never require a Composery website
		// account: someone handed the password can rotate it. The grant flow
		// stays the recovery path for a password you cannot produce, offered as
		// a link rather than forced on everyone who wants to change one.
		expect(changePassword).not.toContain(
			'redirect(req, res, "_composery/cloud/authorize"'
		);
		expect(
			readRepoFile("packages/ide/overlay/src/node/routes/authPage.ts")
		).toContain('href="{{BASE}}/_composery/cloud/authorize">Forgot password?');
	});

	test("records the change with the website before writing it locally", () => {
		// Convex is the source of truth across rebuilds (bootstrapBox re-renders
		// the env file from it), so a local-only change would be restored on the
		// next bootstrap. Failing that call must abort the write, not follow it.
		const sync = changePassword.indexOf("changeCloudPassword(");
		const write = changePassword.indexOf("writeHashedPassword(req");
		expect(sync).toBeGreaterThanOrEqual(0);
		expect(write).toBeGreaterThan(sync);
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
