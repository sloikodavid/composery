import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { API_OPERATION, openapi, SPEC_ID } from "./openapi";
import { docsContentRoute, docsImageRoute, docsRoute } from "./shared";

export const source = loader({
	baseUrl: docsRoute,
	source: docs.toFumadocsSource(),
	plugins: [lucideIconsPlugin()]
});

export function getPageImage(page: (typeof source)["$inferPage"]) {
	const segments = [...page.slugs, "image.png"];

	return {
		segments,
		url: `${docsImageRoute}/${segments.join("/")}`
	};
}

export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]) {
	const segments = [...page.slugs, "content.md"];

	return {
		segments,
		url: `${docsContentRoute}/${segments.join("/")}`
	};
}

export async function getLLMText(page: (typeof source)["$inferPage"]) {
	let processed = await page.data.getText("processed");

	// The endpoint reference is a rendered component, so a plain-Markdown reader
	// would get a tag where the endpoint should be. Those readers are machines;
	// hand them the spec that component renders.
	if (API_OPERATION.test(processed)) {
		const { bundled } = await openapi.getSchema(SPEC_ID);
		processed = processed.replace(
			API_OPERATION,
			`\`\`\`json\n${JSON.stringify(bundled, null, 2)}\n\`\`\``
		);
	}

	return `# ${page.data.title} (${page.url})

${processed}`;
}
