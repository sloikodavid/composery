import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

// Public, indexable routes only; auth-gated surfaces (/boxes, /console) and
// utility pages stay out.
const staticRoutes = [
	"/",
	"/pricing",
	"/brand",
	"/privacy",
	"/terms",
	"/cookies",
	"/licenses"
];

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		...staticRoutes.map((route) => ({ url: `${siteUrl}${route}` })),
		...source.getPages().map((page) => ({ url: `${siteUrl}${page.url}` }))
	];
}
