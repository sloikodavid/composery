import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";

// `dir` points to the repo's sibling `docs/`; next.config turbopack.root must widen to match.
// `docs/developing/` is contributor runbooks, not product documentation - it stays in the repo
// and renders on GitHub, and is excluded here so it never reaches the site, sidebar, or indexes.
export const docs = defineDocs({
	dir: "../../docs",
	docs: {
		files: ["**/*.{md,mdx}", "!developing/**"],
		schema: pageSchema,
		postprocess: {
			includeProcessedMarkdown: true
		}
	},
	meta: {
		files: ["**/*.json", "!developing/**"],
		schema: metaSchema
	}
});

export default defineConfig({});
