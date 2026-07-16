import { Router } from "express";
import { ensureOrigin, getCookieOptions, redirect } from "../http";
import { hash, sanitizeString } from "../util";
import { renderAuthPage } from "./authPage";
import { cloudConfig } from "./cloudAuth";
import { RateLimiter } from "./login";
import {
	hasPassword,
	isEnvPasswordManaged,
	validateExistingPassword,
	writeHashedPassword
} from "./passwordConfig";

const errorMessage = (error: unknown): string | undefined => {
	switch (error) {
		case "missing-current":
			return "Enter your current password";
		case "incorrect-current":
			return "Current password is incorrect";
		case "missing-new":
			return "Enter a new password";
		case "mismatch":
			return "Passwords do not match";
		case "rate-limit":
			return "Too many attempts. Try again later.";
		default:
			return undefined;
	}
};

export const router = Router();

// Reuses login's limiter shape (2/min + 12/hr, shared across sources): the
// current-password check below is the same guessing oracle as /login, so it
// must not be a way around login's rate limit.
const limiter = new RateLimiter();

router.use(async (req, res, next) => {
	// On cloud boxes the password changes through the cloud grant flow:
	// authorize proves box ownership, then /register sets the new password.
	// No current password needed, so this also recovers a forgotten one.
	if (cloudConfig) {
		return redirect(req, res, "_composery/cloud/authorize", {
			error: undefined
		});
	}

	if (isEnvPasswordManaged(req)) {
		res.status(404).send("Not found");
		return;
	}

	if (!hasPassword(req)) {
		return redirect(req, res, "register", { error: undefined });
	}

	// No session required: proving the current password below is a stronger
	// credential than the session cookie it would mint anyway.
	next();
});

router.get("/", async (req, res) => {
	const error =
		typeof req.query.error === "string"
			? errorMessage(req.query.error)
			: undefined;
	res.send(
		await renderAuthPage(req, {
			page: "change-password",
			title: "Change password",
			formLabel: "Change password",
			error
		})
	);
});

router.post("/", ensureOrigin, async (req, res) => {
	const currentPassword = sanitizeString(req.body?.currentPassword);
	const newPassword = sanitizeString(req.body?.newPassword);
	const confirmPassword = sanitizeString(req.body?.confirmPassword);
	if (!limiter.canTry()) {
		return redirect(req, res, "change-password", { error: "rate-limit" });
	}

	if (!currentPassword) {
		return redirect(req, res, "change-password", { error: "missing-current" });
	}

	if (!(await validateExistingPassword(req, currentPassword))) {
		// Only failures consume a token, mirroring login.
		limiter.removeToken();
		return redirect(req, res, "change-password", { error: "incorrect-current" });
	}

	if (!newPassword) {
		return redirect(req, res, "change-password", { error: "missing-new" });
	}

	if (newPassword !== confirmPassword) {
		return redirect(req, res, "change-password", { error: "mismatch" });
	}
	const hashedPassword = await hash(newPassword);
	await writeHashedPassword(req, hashedPassword, { allowExisting: true });
	res.cookie(req.cookieSessionName, hashedPassword, getCookieOptions(req));
	return redirect(req, res, "/", {
		base: undefined,
		href: undefined,
		error: undefined
	});
});
