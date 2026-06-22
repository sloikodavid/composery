import { Router } from "express";
import { promises as fs } from "fs";
import * as path from "path";
import { rootPath } from "../constants";
import {
	authenticated,
	getCookieOptions,
	redirect,
	replaceTemplates
} from "../http";
import { escapeHtml, hash, sanitizeString } from "../util";
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
		default:
			return undefined;
	}
};

const getRoot = async (
	req: Parameters<typeof replaceTemplates>[0]
): Promise<string> => {
	const content = await fs.readFile(
		path.join(rootPath, "src/browser/pages/reset-password.html"),
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

router.use(async (req, res, next) => {
	if (isEnvPasswordManaged(req)) {
		res.status(404).send("Not found");
		return;
	}

	if (!hasPassword(req)) {
		return redirect(req, res, "register", { error: undefined });
	}

	if (!(await authenticated(req))) {
		return redirect(req, res, "login", {
			to: "/reset-password",
			error: undefined
		});
	}

	next();
});

router.get("/", async (req, res) => {
	res.send(await getRoot(req));
});

router.post("/", async (req, res) => {
	const currentPassword = sanitizeString(req.body?.currentPassword);
	const newPassword = sanitizeString(req.body?.newPassword);
	const confirmPassword = sanitizeString(req.body?.confirmPassword);
	if (!currentPassword) {
		return redirect(req, res, "reset-password", { error: "missing-current" });
	}

	if (!(await validateExistingPassword(req, currentPassword))) {
		return redirect(req, res, "reset-password", { error: "incorrect-current" });
	}

	if (!newPassword) {
		return redirect(req, res, "reset-password", { error: "missing-new" });
	}

	if (newPassword !== confirmPassword) {
		return redirect(req, res, "reset-password", { error: "mismatch" });
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
