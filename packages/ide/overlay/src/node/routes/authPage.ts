import { promises as fs } from "fs";
import * as path from "path";
import { rootPath } from "../constants";
import { replaceTemplates } from "../http";
import { escapeHtml } from "../util";
import { hasPassword, isEnvPasswordManaged } from "./passwordConfig";

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
	const [shell, fields, logo] = await Promise.all([
		fs.readFile(path.join(pages, "auth.html"), "utf8"),
		fs.readFile(path.join(pages, `${page}-fields.html`), "utf8"),
		fs.readFile(
			path.join(rootPath, "src/browser/media/composery-logo.svg"),
			"utf8"
		)
	]);
	// /change-password takes the current password on every deployment, so the
	// link follows one rule: shown unless the environment owns the password.
	const changePasswordLink = isEnvPasswordManaged(req)
		? ""
		: '<a class="link auth-link" href="{{BASE}}/change-password">Change password</a>';
	// Only cloud boxes can recover a password you cannot produce, by proving
	// box ownership through the website.
	const forgotPasswordLink =
		isCloudBox && page === "change-password"
			? '<a class="link auth-link" href="{{BASE}}/_composery/cloud/authorize">Forgot password?</a>'
			: "";
	// The way back from every other page. Gated on a password existing, so
	// first-run registration does not offer a sign-in that cannot succeed.
	const signInLink =
		page !== "login" && hasPassword(req)
			? '<a class="link auth-link" href="{{BASE}}/login">Sign in</a>'
			: "";
	return replaceTemplates(
		req,
		shell
			.replace(/{{TITLE}}/, () => escapeHtml(title))
			.replace(/{{FORM_LABEL}}/, () => escapeHtml(formLabel))
			.replace(/{{FIELDS}}/, () => fields)
			// The logo is inlined rather than linked as an <img> so its currentColor
			// resolves against this page. The generated file carries a <style> that
			// hard-codes the colour off prefers-color-scheme, which is how it stays
			// self-contained as a standalone asset (favicons, the brand page); inlined
			// that rule would both override the page and be refused by the CSP, so it
			// goes. See packages/shared/scripts/logo.mjs for the one definition of both.
			.replace(/{{LOGO}}/, () =>
				logo
					.replace(/<style>[\s\S]*?<\/style>/, "")
					.replace(/^<svg /, '<svg class="auth-logo" aria-hidden="true" ')
					.trim()
			)
			.replace(/{{CHANGE_PASSWORD_LINK}}/, () => changePasswordLink)
			.replace(/{{FORGOT_PASSWORD_LINK}}/, () => forgotPasswordLink)
			.replace(/{{SIGN_IN_LINK}}/, () => signInLink)
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
