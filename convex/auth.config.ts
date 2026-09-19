import type { AuthConfig } from "convex/server";

const clerkFrontendApiUrl = process.env.CLERK_FRONTEND_API_URL;
if (!clerkFrontendApiUrl) {
	throw new Error("CLERK_FRONTEND_API_URL is not set on this deployment.");
}

export default {
	providers: [
		{
			domain: clerkFrontendApiUrl,
			// biome-ignore lint/style/useNamingConvention: external field name
			applicationID: "convex",
		},
	],
} satisfies AuthConfig;
