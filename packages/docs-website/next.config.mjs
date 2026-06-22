import { join } from "node:path";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
	// Content is read from the repo's `/docs`, a sibling of `packages/`. Turbopack
	// won't resolve files outside its root, so widen the root to the repo root
	// (two levels up) - the nearest ancestor of both this app and the markdown.
	// Also silences the multiple-lockfile root inference warning.
	turbopack: {
		root: join(import.meta.dirname, "..", "..")
	}
};

export default withMDX(config);
