import { Router } from "express";
import { promises as fs } from "fs";
import * as path from "path";
import { rootPath } from "../constants";
import { getCookieOptions, redirect, replaceTemplates } from "../http";
import { escapeHtml, hash, sanitizeString } from "../util";
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

const getRoot = async (
	req: Parameters<typeof replaceTemplates>[0]
): Promise<string> => {
	const content = await fs.readFile(
		path.join(rootPath, "src/browser/pages/register.html"),
		"utf8"
	);
	const error =
		typeof req.query.error === "string"
			? errorMessage(req.query.error)
			: undefined;
	return replaceTemplates(
		req,
		content.replace(
			/{{ERROR}}/,
			error
				? `<span class="error" role="alert">${escapeHtml(error)}</span>`
				: ""
		)
	);
};

export const router = Router();

router.use((req, res, next) => {
	if (isEnvPasswordManaged(req) || hasPassword(req)) {
		return redirect(req, res, "login", { error: undefined });
	}

	next();
});

router.get("/", async (req, res) => {
	res.send(await getRoot(req));
});

router.post("/", async (req, res) => {
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
