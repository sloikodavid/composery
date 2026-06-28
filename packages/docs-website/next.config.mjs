import { join } from "node:path";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
	// Widen root to the repo so Turbopack resolves the sibling `docs/` markdown.
	turbopack: {
		root: join(import.meta.dirname, "..", "..")
	}
};

export default withMDX(config);
