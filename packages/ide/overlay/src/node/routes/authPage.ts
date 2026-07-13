import { promises as fs } from "fs";
import * as path from "path";
import { rootPath } from "../constants";
import { replaceTemplates } from "../http";
import { escapeHtml } from "../util";

export interface AuthPage {
	/** Basename of the `<page>-fields.html` fragment (fields + submit button). */
	page: "login" | "register" | "reset-password";
	title: string;
	formLabel: string;
	error?: string;
}

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
	return replaceTemplates(
		req,
		shell
			.replace(/{{TITLE}}/, () => escapeHtml(title))
			.replace(/{{FORM_LABEL}}/, () => escapeHtml(formLabel))
			.replace(/{{FIELDS}}/, () => fields)
			.replace(/{{ERROR}}/, () =>
				error
					? `<span class="error" role="alert">${escapeHtml(error)}</span>`
					: ""
			)
	);
};
