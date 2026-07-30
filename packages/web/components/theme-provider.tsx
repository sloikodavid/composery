"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ComponentProps } from "react";
import { useEffect } from "react";
import { syncBrowserThemeColor } from "@/lib/browser-theme";

export function ThemeProvider({
	children,
	...props
}: ComponentProps<typeof NextThemesProvider>) {
	return (
		<NextThemesProvider {...props}>
			<SystemThemeSync />
			<FaviconSync />
			<BrowserThemeColorSync />
			{children}
		</NextThemesProvider>
	);
}

function SystemThemeSync() {
	const { setTheme } = useTheme();

	useEffect(() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const sync = (event: Pick<MediaQueryListEvent, "matches">) => {
			setTheme(event.matches ? "dark" : "light");
		};

		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	}, [setTheme]);

	return null;
}

function BrowserThemeColorSync() {
	const { resolvedTheme } = useTheme();

	useEffect(() => {
		if (resolvedTheme === "light" || resolvedTheme === "dark")
			syncBrowserThemeColor(document, resolvedTheme);
	}, [resolvedTheme]);

	return null;
}

// The tab icon follows the theme the moment it changes, the way github.com and
// polar.sh do it - no reload.
//
// The declared /icon.svg carries its own prefers-color-scheme rule, but Chromium
// rasterizes a favicon once per URL and never re-runs that query, so on its own
// the icon only ever catches up across a reload - and it could never follow a
// theme picked here that disagrees with the OS. Pointing a link at a
// scheme-pinned file is a new URL, which every browser does re-render.
//
// The page carries exactly one SVG icon link - the one Next renders from
// app/icon.svg - and this owns its href. Repointing that link rather than adding
// a second one leaves nothing to arbitrate: two candidates of the same type and
// the browser picks, which is not a thing to guess about a tab icon. The
// adaptive file it starts on is what the pre-hydration frame and a JS-less
// client get.
function FaviconSync() {
	const { resolvedTheme } = useTheme();

	useEffect(() => {
		if (!resolvedTheme) return;
		const selector = 'link[rel="icon"][type="image/svg+xml"]';
		const link =
			document.head.querySelector<HTMLLinkElement>(selector) ??
			document.head.appendChild(
				Object.assign(document.createElement("link"), {
					rel: "icon",
					type: "image/svg+xml"
				})
			);
		link.href = resolvedTheme === "dark" ? "/icon-dark.svg" : "/icon-light.svg";
	}, [resolvedTheme]);

	return null;
}
