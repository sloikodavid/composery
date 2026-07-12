import { Router } from "express";
import { ensureOrigin, getCookieOptions, redirect } from "../http";
import { hash, sanitizeString } from "../util";
import { renderAuthPage } from "./authPage";
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
		default:
			return undefined;
	}
};

export const router = Router();

router.use((req, res, next) => {
	if (isEnvPasswordManaged(req) || hasPassword(req)) {
		return redirect(req, res, "login", { error: undefined });
	}

	next();
});

router.get("/", async (req, res) => {
	const error =
		typeof req.query.error === "string"
			? errorMessage(req.query.error)
			: undefined;
	res.send(await renderAuthPage(req, "register.html", error));
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
	const didWritePassword = await writeHashedPassword(req, hashedPassword);
	if (!didWritePassword) {
		return redirect(req, res, "login", { to, error: "configured" });
	}

	res.cookie(req.cookieSessionName, hashedPassword, getCookieOptions(req));
	return redirect(req, res, to, { to: undefined, error: undefined });
});
