import localFont from "next/font/local";

// Matches the composery-web design system: Inter for UI, Bricolage Grotesque
// for the wordmark and headings. Self-hosted so the docs never flash an
// unstyled wordmark. Variable weight axes: Inter 100-900, Bricolage 200-800.
export const inter = localFont({
	display: "swap",
	src: "./fonts/inter-latin-wght-normal.woff2",
	style: "normal",
	variable: "--font-inter",
	weight: "100 900"
});

export const bricolage = localFont({
	display: "swap",
	src: "./fonts/bricolage-grotesque-latin-wght-normal.woff2",
	style: "normal",
	variable: "--font-bricolage",
	weight: "200 800"
});
