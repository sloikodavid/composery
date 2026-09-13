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

const contentSecurityPolicy = [
	"default-src 'self'",
	`script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} ${clerkFrontendApiUrl}`,
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' blob: data:",
	"font-src 'self'",
	"worker-src 'self' blob:",
	`connect-src 'self' ${convexUrl} ${convexSocketUrl} ${clerkFrontendApiUrl}`,
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
