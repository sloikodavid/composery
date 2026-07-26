import { Router } from "express";
import { ensureOrigin, getCookieOptions, redirect } from "../http";
import { hash, sanitizeString } from "../util";
import { renderAuthPage } from "./authPage";
import { changeCloudPassword, cloudConfig } from "./cloudAuth";
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
		case "unavailable":
			return "Could not reach Composery to record the change. Try again.";
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
	// Cloud boxes change their password here too, on the same terms as
	// self-hosted: prove the current one. The grant flow stays the recovery
	// path for a password you cannot produce, reached from the link this page
	// renders, so holding the box password never requires a website account.
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

// Answers the current-password step where the user is standing, instead of
// taking three stages of input and only rejecting at the final POST. Shares the
// limiter with the submit below, so proving a guess here costs the same token
// and this cannot become a way around login's rate limit.
// Answers with an explicit result body rather than a bare status: unrelated
// middleware also answers 401/404, and a client keying "wrong password" off a
// status alone would reject on any of them. Only { valid: false } from here is
// a rejection.
router.post("/verify", ensureOrigin, async (req, res) => {
	const currentPassword = sanitizeString(req.body?.currentPassword);
	res.setHeader("Cache-Control", "no-store");
	if (!limiter.canTry()) {
		return res.json({ valid: false, reason: "rate-limit" });
	}
	if (!currentPassword) {
		return res.json({ valid: false, reason: "missing" });
	}
	if (!(await validateExistingPassword(req, currentPassword))) {
		// Only failures consume a token, mirroring login.
		limiter.removeToken();
		return res.json({ valid: false, reason: "incorrect" });
	}
	return res.json({ valid: true });
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
	// Tell the website before writing locally. If it refuses, the box keeps the
	// password Convex still believes in, instead of holding one the next
	// bootstrap would silently restore over.
	if (cloudConfig) {
		const currentHash = req.args["hashed-password"];
		try {
			await changeCloudPassword(currentHash ?? "", hashedPassword);
		} catch {
			return redirect(req, res, "change-password", { error: "unavailable" });
		}
	}
	await writeHashedPassword(req, hashedPassword, { allowExisting: true });
	res.cookie(req.cookieSessionName, hashedPassword, getCookieOptions(req));
	return redirect(req, res, "", {
		base: undefined,
		href: undefined,
		error: undefined
	});
});
