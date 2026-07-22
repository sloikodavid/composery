import {
	APP_DESCRIPTION,
	APP_TAGLINE,
	BRAND_NAME,
	WEBSITE_ORIGIN
} from "shared";

export const appName = BRAND_NAME;
export const siteUrl = WEBSITE_ORIGIN;
export const appDescription = APP_DESCRIPTION;
export const appTagline = APP_TAGLINE;
// Docs are mounted under /docs on the marketing site (www.composery.io/docs).
// The loader baseUrl, the proxy.ts markdown rewrites, and the app/docs route
// segment all derive from this, so the docs base lives in exactly one place.
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";
