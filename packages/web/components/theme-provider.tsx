"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ComponentProps } from "react";
import { useEffect } from "react";

export function ThemeProvider({
	children,
	...props
}: ComponentProps<typeof NextThemesProvider>) {
	return (
		<NextThemesProvider {...props}>
			<SystemThemeSync />
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
