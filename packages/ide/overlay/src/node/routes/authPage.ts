import { promises as fs } from "fs";
import * as path from "path";
import { rootPath } from "../constants";
import { replaceTemplates } from "../http";
import { escapeHtml } from "../util";

// Shared shell for the auth pages (register, reset-password): read the page,
// inject the optional error into {{ERROR}}, and run the standard template
// replacements. Keeps the error markup in one place so it cannot drift.
export const renderAuthPage = async (
	req: Parameters<typeof replaceTemplates>[0],
	page: string,
	error: string | undefined
): Promise<string> => {
	const content = await fs.readFile(
		path.join(rootPath, "src/browser/pages", page),
		"utf8"
	);
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
