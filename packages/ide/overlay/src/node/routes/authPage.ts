import { promises as fs } from "fs";
import * as path from "path";
import { rootPath } from "../constants";
import { replaceTemplates } from "../http";
import { escapeHtml } from "../util";
import { isEnvPasswordManaged } from "./passwordConfig";

export interface AuthPage {
	/** Basename of the `<page>-fields.html` fragment (fields + submit button). */
	page: "change-password" | "cloud-error" | "login" | "register";
	title: string;
	formLabel: string;
	error?: string;
}

// Mirrors cloudAuth's config detection without importing it (cloudAuth
// imports renderAuthPage, so that would be a require cycle).
const isCloudBox = !!process.env.COMPOSERY_CLOUD_BOX_ID?.trim();

// Every auth page is the same shell (head, CSP, logo, hidden inputs, error
// slot, auth.js) around a per-page fields fragment. The shell, the error
// markup, and the template pass live here so the routes cannot drift.
export const renderAuthPage = async (
	req: Parameters<typeof replaceTemplates>[0],
	{ page, title, formLabel, error }: AuthPage
): Promise<string> => {
	const pages = path.join(rootPath, "src/browser/pages");
	const [shell, fields] = await Promise.all([
		fs.readFile(path.join(pages, "auth.html"), "utf8"),
		fs.readFile(path.join(pages, `${page}-fields.html`), "utf8")
	]);
	// /change-password 404s only on env-managed self-hosted boxes; everywhere
	// else the login page links to it (on cloud boxes it enters the cloud
	// grant flow, so it doubles as forgotten-password recovery).
	const changePasswordLink =
		isCloudBox || !isEnvPasswordManaged(req)
			? '<a class="auth-link" href="{{BASE}}/change-password">Change password</a>'
			: "";
	return replaceTemplates(
		req,
		shell
			.replace(/{{TITLE}}/, () => escapeHtml(title))
			.replace(/{{FORM_LABEL}}/, () => escapeHtml(formLabel))
			.replace(/{{FIELDS}}/, () => fields)
			.replace(/{{CHANGE_PASSWORD_LINK}}/, () => changePasswordLink)
			.replace(/{{PASSWORD_CHECK_SCRIPT}}/, () =>
				page === "register" || page === "change-password"
					? '<script src="{{COMPOSERY_STATIC_BASE}}/src/browser/pages/password-check.js"></script>'
					: ""
			)
			.replace(/{{ERROR}}/, () =>
				error
					? `<span class="error" role="alert">${escapeHtml(error)}</span>`
					: ""
			)
	);
};
