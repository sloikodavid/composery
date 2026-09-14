import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
	throw new Error(
		"NEXT_PUBLIC_CONVEX_URL is not set. Run `bunx convex dev` to write .env.local.",
	);
}

const convexSocketUrl = convexUrl.replace(/^http/, "ws");

const clerkFrontendApiUrl = process.env.CLERK_FRONTEND_API_URL;
if (!clerkFrontendApiUrl) {
	throw new Error("CLERK_FRONTEND_API_URL is not set.");
}

// Without it, Clerk sends users to its hosted Account Portal instead of the app's sign-in page.
if (!process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL) {
	throw new Error("NEXT_PUBLIC_CLERK_SIGN_IN_URL is not set.");
}

// Clerk's bot protection runs Cloudflare Turnstile and Clerk's fraud protection, which connects on ports other than 443.
const clerkChallengeOrigins =
	"https://challenges.cloudflare.com https://*.protect.clerk.com";

const contentSecurityPolicy = [
	"default-src 'self'",
	`script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} ${clerkFrontendApiUrl} ${clerkChallengeOrigins}`,
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' blob: data: https://img.clerk.com",
	"font-src 'self'",
	"worker-src 'self' blob:",
	`frame-src ${clerkChallengeOrigins}`,
	`connect-src 'self' ${convexUrl} ${convexSocketUrl} ${clerkFrontendApiUrl} https://img.clerk.com https://*.protect.clerk.com:*`,
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
	{ key: "Content-Security-Policy", value: contentSecurityPolicy },
	{ key: "Strict-Transport-Security", value: "max-age=63072000" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
	{
		key: "Permissions-Policy",
		value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
	},
];

const nextConfig: NextConfig = {
	reactCompiler: true,
	typedRoutes: true,
	poweredByHeader: false,
	async headers() {
		return [{ source: "/(.*)", headers: securityHeaders }];
	},
};

export default nextConfig;
