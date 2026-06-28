import localFont from "next/font/local";

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
