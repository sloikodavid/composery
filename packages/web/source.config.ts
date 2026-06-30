import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";

// `dir` points to the repo's sibling `docs/`; next.config turbopack.root must widen to match.
export const docs = defineDocs({
	dir: "../../docs",
	docs: {
		files: ["**/*.{md,mdx}"],
		schema: pageSchema,
		postprocess: {
			includeProcessedMarkdown: true
		}
	},
	meta: {
		files: ["**/*.json"],
		schema: metaSchema
	}
});

export default defineConfig({});
