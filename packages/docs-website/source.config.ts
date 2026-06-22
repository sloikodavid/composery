import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";

// Content lives in the repo's `/docs` so the markdown stays next to the product
// and renders on GitHub. This app is in `packages/docs-website`, so `dir` points
// back up to the sibling `docs/`; `turbopack.root` in next.config widens the
// resolution root to the repo so Turbopack can import these out-of-app files.
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

export default defineConfig({
	mdxOptions: {
		// MDX options
	}
});
