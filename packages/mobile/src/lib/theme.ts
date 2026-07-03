import { BRAND_THEME } from "@/lib/brand";

export type Palette = {
	background: string;
	foreground: string;
	muted: string;
	mutedForeground: string;
	card: string;
	cardForeground: string;
	border: string;
	primary: string;
	primaryForeground: string;
	secondary: string;
	secondaryForeground: string;
	accent: string;
	accentForeground: string;
	ring: string;
	destructive: string;
	success: string;
	warning: string;
};

export type ThemeScheme = "light" | "dark" | "unspecified" | null | undefined;

export const light: Palette = {
	background: BRAND_THEME.light.background,
	foreground: BRAND_THEME.light.foreground,
	muted: BRAND_THEME.light.muted,
	mutedForeground: BRAND_THEME.light.mutedForeground,
	card: BRAND_THEME.light.card,
	cardForeground: BRAND_THEME.light.cardForeground,
	border: BRAND_THEME.light.border,
	primary: BRAND_THEME.light.primary,
	primaryForeground: BRAND_THEME.light.primaryForeground,
	secondary: BRAND_THEME.light.secondary,
	secondaryForeground: BRAND_THEME.light.secondaryForeground,
	accent: BRAND_THEME.light.accent,
	accentForeground: BRAND_THEME.light.accentForeground,
	ring: BRAND_THEME.light.ring,
	destructive: BRAND_THEME.light.destructive,
	success: BRAND_THEME.light.success,
	warning: BRAND_THEME.light.warning
};

export const dark: Palette = {
	background: BRAND_THEME.dark.background,
	foreground: BRAND_THEME.dark.foreground,
	muted: BRAND_THEME.dark.muted,
	mutedForeground: BRAND_THEME.dark.mutedForeground,
	card: BRAND_THEME.dark.card,
	cardForeground: BRAND_THEME.dark.cardForeground,
	border: BRAND_THEME.dark.border,
	primary: BRAND_THEME.dark.primary,
	primaryForeground: BRAND_THEME.dark.primaryForeground,
	secondary: BRAND_THEME.dark.secondary,
	secondaryForeground: BRAND_THEME.dark.secondaryForeground,
	accent: BRAND_THEME.dark.accent,
	accentForeground: BRAND_THEME.dark.accentForeground,
	ring: BRAND_THEME.dark.ring,
	destructive: BRAND_THEME.dark.destructive,
	success: BRAND_THEME.dark.success,
	warning: BRAND_THEME.dark.warning
};

export function themeForScheme(scheme: ThemeScheme): Palette {
	return scheme === "dark" ? dark : light;
}
