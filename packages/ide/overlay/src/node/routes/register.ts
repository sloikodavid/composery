import { Router } from "express";
import { ensureOrigin, getCookieOptions, redirect } from "../http";
import { hash, sanitizeString } from "../util";
import { renderAuthPage } from "./authPage";
import {
	clearCloudSetupGrant,
	cloudConfig,
	hasCloudSetupGrant,
	installCloudPassword
} from "./cloudAuth";
import {
	hasPassword,
	isEnvPasswordManaged,
	writeHashedPassword
} from "./passwordConfig";

const errorMessage = (error: unknown): string | undefined => {
	switch (error) {
		case "missing":
			return "Enter a password";
		case "mismatch":
			return "Passwords do not match";
		case "configured":
			return "Password was already configured. Sign in instead.";
		case "unavailable":
			return "Password setup is temporarily unavailable";
		default:
			return undefined;
	}
};

export const router = Router();

router.use((req, res, next) => {
	// A cloud setup grant proves box ownership, so it may set the password
	// even when one exists: that is the cloud change/recovery flow.
	if (cloudConfig && hasCloudSetupGrant(req)) {
		// Cloud box owners control their own host, so they can set
		// COMPOSERY_PASSWORD on a cloud box. It outranks whatever the grant
		// would write here and takes back over at the next restart, so say so
		// rather than store a password that silently stops working.
		if (isEnvPasswordManaged(req)) {
			return redirect(req, res, "login", { error: "env-managed" });
		}
		return next();
	}
	if (isEnvPasswordManaged(req) || hasPassword(req)) {
		return redirect(req, res, "login", { error: undefined });
	}
	if (cloudConfig) {
		return redirect(req, res, "_composery/cloud/authorize", {
			error: undefined
		});
	}

	next();
});

router.get("/", async (req, res) => {
	const error =
		typeof req.query.error === "string"
			? errorMessage(req.query.error)
			: undefined;
	const title = hasPassword(req) ? "Change password" : "Create password";
	res.send(
		await renderAuthPage(req, {
			page: "register",
			title,
			formLabel: title,
			error
		})
	);
});

// ensureOrigin: without it a malicious page can form-POST a drive-by
// registration at an unclaimed workspace (worst on localhost binds).
router.post("/", ensureOrigin, async (req, res) => {
	const password = sanitizeString(req.body?.password);
	const confirmPassword = sanitizeString(req.body?.confirmPassword);
	if (!password) {
		return redirect(req, res, "register", { error: "missing" });
	}

	if (password !== confirmPassword) {
		return redirect(req, res, "register", { error: "mismatch" });
	}
	const to = (typeof req.query.to === "string" && req.query.to) || "/";
	const hashedPassword = await hash(password);
	if (cloudConfig) {
		try {
			await installCloudPassword(req, hashedPassword);
		} catch {
			clearCloudSetupGrant(res);
			return redirect(req, res, "_composery/cloud/authorize", {
				error: "unavailable"
			});
		}
	}
	// The cloud setup grant authorizes overwriting an existing password (the
	// change/recovery flow); self-hosted first-run registration must not.
	const didWritePassword = await writeHashedPassword(req, hashedPassword, {
		allowExisting: !!cloudConfig
	});
	if (!didWritePassword) {
		return redirect(req, res, "login", { to, error: "configured" });
	}

	res.cookie(req.cookieSessionName, hashedPassword, getCookieOptions(req));
	if (cloudConfig) clearCloudSetupGrant(res);
	return redirect(req, res, to, { to: undefined, error: undefined });
});
