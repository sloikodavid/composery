import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/shared";

// Allow crawling everything by default; keep auth-gated app surfaces out.
export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				disallow: ["/boxes", "/console", "/sign-in", "/api/"]
			}
		],
		sitemap: `${siteUrl}/sitemap.xml`
	};
}
