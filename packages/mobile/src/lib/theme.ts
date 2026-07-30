import { BRAND_THEME } from "shared";

export type Palette = {
	background: string;
	foreground: string;
	muted: string;
	mutedForeground: string;
	card: string;
	border: string;
	button: string;
	buttonForeground: string;
	destructive: string;
};

export type ThemeScheme = "light" | "dark" | "unspecified" | null | undefined;

export const light: Palette = {
	background: BRAND_THEME.light.background,
	foreground: BRAND_THEME.light.foreground,
	muted: BRAND_THEME.light.muted,
	mutedForeground: BRAND_THEME.light.mutedForeground,
	card: BRAND_THEME.light.card,
	border: BRAND_THEME.light.border,
	button: BRAND_THEME.light.button,
	buttonForeground: BRAND_THEME.light.buttonForeground,
	destructive: BRAND_THEME.light.destructive
};

export const dark: Palette = {
	background: BRAND_THEME.dark.background,
	foreground: BRAND_THEME.dark.foreground,
	muted: BRAND_THEME.dark.muted,
	mutedForeground: BRAND_THEME.dark.mutedForeground,
	card: BRAND_THEME.dark.card,
	border: BRAND_THEME.dark.border,
	button: BRAND_THEME.dark.button,
	buttonForeground: BRAND_THEME.dark.buttonForeground,
	destructive: BRAND_THEME.dark.destructive
};

export function themeForScheme(scheme: ThemeScheme): Palette {
	return scheme === "dark" ? dark : light;
}
