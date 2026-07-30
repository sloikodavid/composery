import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { readRepoFile, repoRoot } from "../../../../tests/support/repo.ts";
import { addedLines } from "../support/patch.ts";

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
		expect(authPage).toContain('page !== "login" && hasPassword(req.args)');
		expect(authPage).toContain('href="{{BASE}}/login">Sign in');
	});

	test("all owned auth navigation remains relative to the unknown public mount", () => {
		const routeDir = "packages/ide/overlay/src/node/routes";
		const routeFiles = (dir: string): string[] =>
			readdirSync(resolve(repoRoot, dir)).flatMap((name) => {
				const path = `${dir}/${name}`;
				return statSync(resolve(repoRoot, path)).isDirectory()
					? routeFiles(path)
					: name.endsWith(".ts")
						? [path]
						: [];
			});

		const absoluteRedirects = routeFiles(routeDir).flatMap((path) => {
			const source = readRepoFile(path);
			return [
				...source.matchAll(
					/(?:\bres\.redirect\(|\bredirect\(\s*req,\s*res,)\s*["'`]\/(?!\/)/g
				)
			].map((match) => `${path}:${match.index}`);
		});
		const absoluteLinks = readdirSync(resolve(repoRoot, pagesDir))
			.filter((name) => name.endsWith(".html"))
			.flatMap((name) => {
				const source = readRepoFile(`${pagesDir}/${name}`);
				return [...source.matchAll(/\b(?:action|href)=["']\/(?!\/)/g)].map(
					(match) => `${name}:${match.index}`
				);
			});

		expect(absoluteRedirects).toEqual([]);
		expect(absoluteLinks).toEqual([]);
	});
});

describe("register route", () => {
	test("rejects cross-origin POSTs (drive-by workspace claim)", () => {
		expect(register).toContain('router.post("/", ensureOrigin,');
	});

	test("refuses to run once a password is managed or configured", () => {
		const guard = register.indexOf(
			"isEnvPasswordManaged(req.args) || hasPassword(req.args)"
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
			"isEnvPasswordManaged(req.args) || hasPassword(req.args)"
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
		// That the login page can render the code this sends it is no longer a
		// fact about this route: `every code that is sent can be rendered by the
		// page it is sent to` proves it for every redirect in the tree.
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
		).toContain(
			'href="{{BASE}}/_composery/cloud/authorize?type=password">Forgot password?'
		);
	});

	test("records the change with the website before writing it locally", () => {
		// Convex is the source of truth across rebuilds (bootstrapBox re-renders
		// the env file from it), so a local-only change would be restored on the
		// next bootstrap. Failing that call must abort the write, not follow it.
		const sync = changePassword.indexOf("changeCloudPassword(");
		const write = changePassword.indexOf("writeHashedPassword(req.args");
		expect(sync).toBeGreaterThanOrEqual(0);
		expect(write).toBeGreaterThan(sync);
	});

	test("guessing here spends login's own per-source budget", () => {
		// /change-password/verify answers the same question as /login, so a
		// limiter of its own would just be a way around login's. One shared
		// instance, keyed the same way, is what makes that impossible.
		const login = addedLines(readRepoFile("packages/ide/patches/auth.diff"));
		for (const source of [changePassword, login]) {
			expect(source).toContain(
				'loginRateLimit, loginSource } from "./loginRateLimit"'
			);
			expect(source).toContain("loginRateLimit.canTry(source)");
			expect(source).toContain("loginRateLimit.recordFailure(source)");
		}
		// ...only one instance exists to share...
		expect(
			readRepoFile("packages/ide/overlay/src/node/routes/loginRateLimit.ts")
		).toContain("export const loginRateLimit = new LoginRateLimit()");
		expect(changePassword).not.toMatch(/new\s+\w*(?:RateLimit|Limiter)/);
		// ...and both places that will answer "is this the password?" spend it:
		// the /verify step the page calls, and the submit that follows.
		for (const call of ["canTry(source)", "recordFailure(source)"]) {
			expect(
				changePassword.split(`loginRateLimit.${call}`).length - 1,
				call
			).toBe(2);
		}

		const canTry = changePassword.indexOf("loginRateLimit.canTry(source)");
		const validate = changePassword.indexOf(
			"isPasswordValid(req.args, currentPassword)"
		);
		expect(canTry).toBeGreaterThanOrEqual(0);
		expect(validate).toBeGreaterThan(canTry);
	});

	test("failed current-password checks consume a rate-limit token", () => {
		const validate = changePassword.indexOf(
			"isPasswordValid(req.args, currentPassword)"
		);
		const removeToken = changePassword.indexOf(
			"loginRateLimit.recordFailure(source)"
		);
		const incorrectRedirect = changePassword.indexOf(
			'error: "incorrect-current"'
		);
		expect(removeToken).toBeGreaterThan(validate);
		expect(incorrectRedirect).toBeGreaterThan(removeToken);
	});

	test("self-hosted writes require the validated current password first", () => {
		const validate = changePassword.indexOf(
			"isPasswordValid(req.args, currentPassword)"
		);
		const write = changePassword.indexOf("writeHashedPassword(req.args,");
		expect(validate).toBeGreaterThanOrEqual(0);
		expect(write).toBeGreaterThan(validate);
	});

	test("a cloud box changes its password here, not only through the website", () => {
		// The website renders COMPOSERY_HASHED_PASSWORD into every cloud box's
		// env file, so a rule of "the environment owns the password" locked the
		// change and recovery flows out of every box that had one. It does not:
		// the change is recorded in Convex first, and the reconcile carries it
		// back into that same variable.
		const passwordConfig = readRepoFile(
			"packages/ide/overlay/src/node/routes/passwordConfig.ts"
		);
		expect(passwordConfig).toContain(
			"!!args.usingEnvPassword || !!(args.usingEnvHashedPassword && !cloudConfig)"
		);
		// One predicate, so the page link, the route guard and the workbench
		// command cannot disagree about whether the password can be changed.
		expect(
			addedLines(readRepoFile("packages/ide/patches/auth.diff"))
		).toContain(
			'"change-password": args.auth === AuthType.Password && !isEnvPasswordManaged(args),'
		);
	});

	test("a password the box changed itself is reconciled into its env file", () => {
		// The env file the website renders is where a cloud box reads its
		// password from, and it still holds the old hash after a local change.
		// Recording the new one in Convex alone leaves a password that works
		// until the next restart and then silently reverts.
		const auth = readRepoFile("packages/web/convex/boxes/auth.ts");
		const start = auth.indexOf("export const applyPasswordChange");
		const apply = auth.slice(start, auth.indexOf("\nexport const", start + 1));
		expect(apply).toContain("internal.boxes.auth.reconcilePassword");
		// ...and the reconcile has to re-render the env file from the new hash,
		// not merely restart the box on the old one.
		const ssh = readRepoFile("packages/web/convex/boxes/infra/ssh.ts");
		const rewrite = ssh.slice(
			ssh.indexOf("export const rewritePasswordAndRestart")
		);
		expect(rewrite.slice(0, rewrite.indexOf("await runSsh"))).toContain(
			"runtimeAuthHash: args.runtimeAuthHash"
		);
	});
});

describe("signed sessions", () => {
	const sessions = readRepoFile("packages/ide/patches/sessions.diff");
	const cloudAuth = readRepoFile(
		"packages/ide/overlay/src/node/routes/cloudAuth.ts"
	);

	test("password and Composery sign-in issue the same local capability", () => {
		// The same call with the same options at every entry point. Composery
		// sign-in used to mint its cookie with a scope of its own, which the
		// browser kept as a second cookie that Sign Out could not clear.
		const login = addedLines(readRepoFile("packages/ide/patches/auth.diff"));
		for (const source of [login, register, changePassword, cloudAuth]) {
			expect(source).toContain(
				"setSessionCookie(req, res, getCookieOptions(req))"
			);
		}
	});

	test("the session cookie reaches every route this server authenticates", () => {
		// /proxy and /absproxy are mounted above the workbench, so a cookie
		// scoped to the workbench mount was never sent to them and the port
		// proxy answered every browser request with a redirect to sign in.
		expect(addedLines(sessions)).toContain('    path: "/",');
		// Nothing about the scope may come from the caller: a client that picks
		// the Domain widens its own session to a parent domain.
		const http = sessions.slice(sessions.indexOf("getCookieOptions"));
		expect(http).not.toContain("+    domain:");
		expect(sessions).toContain("-    req.query.base || req.body?.base");
		expect(
			readRepoFile("packages/ide/overlay/src/browser/pages/auth.html")
		).not.toContain('name="href"');
	});

	test("authentication validates signed session tokens", () => {
		expect(addedLines(sessions)).toContain(
			"return isSessionTokenValid(sanitizeString(req.cookies[req.cookieSessionName]), req.args)"
		);
	});

	test("Composery session and password capabilities cannot be interchanged", () => {
		expect(cloudAuth).toContain("body.type !== transaction.type");
		expect(cloudAuth).toContain('transaction.type === "session"');
		expect(readRepoFile("packages/web/convex/boxes/auth.ts")).toContain(
			"code.type !== args.type"
		);
	});
});

describe("disabled authentication", () => {
	const disableAuth = readRepoFile("packages/ide/patches/auth.diff");
	const cloudAuth = readRepoFile(
		"packages/ide/overlay/src/node/routes/cloudAuth.ts"
	);

	test("only an explicit 1/true unprotects the instance", () => {
		// Every other value, typos included, has to leave sign-in required: a
		// misread switch must never be the thing that opens the box.
		expect(disableAuth).toContain(
			"process.env.COMPOSERY_DISABLE_AUTH?.match(/^(1|true)$/)"
		);
	});

	test("the switch selects the auth type every gate already reads", () => {
		// authenticated() short-circuits on AuthType.None, so selecting it is
		// what opens the workbench, both proxies and the websockets together.
		// A surface gated on the env var directly would drift out of step.
		expect(disableAuth).toContain("args.auth = AuthType.None");
		const elsewhere = readRepoFile("packages/ide/patches/series")
			.split(/\r?\n/)
			.filter((patch) => patch && patch !== "auth.diff")
			.flatMap((patch) =>
				addedLines(readRepoFile(`packages/ide/patches/${patch}`)).split("\n")
			);
		expect(
			elsewhere.filter((line) => line.includes("COMPOSERY_DISABLE_AUTH"))
		).toEqual([]);
	});

	test("the disabled state is a warning, not a log line", () => {
		// Silent success is the failure mode here: an operator who does not
		// notice keeps a root-capable terminal open to whoever finds it.
		expect(disableAuth).toContain(
			'-    logger.info("  - Authentication is disabled")'
		);
		expect(disableAuth).toContain("+    logger.warn(");
	});

	test("a configured password says it is being ignored", () => {
		expect(disableAuth).toContain('args.password || args["hashed-password"]');
	});

	test("the cloud grant flow stops when sign-in does", () => {
		// Its only job is setting the box password; with sign-in off it would
		// pass the ownership check, report success, and gate nothing.
		expect(cloudAuth).toContain("req.args.auth !== AuthType.Password");
	});
});
