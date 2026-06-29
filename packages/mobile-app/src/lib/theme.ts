// Composery palette as hex/rgba. RN can't parse oklch() (PLAN.md Wrinkle 3), so
// the docs-website oklch palette (src/app/global.css) is converted to hex once
// here, derived from the oklch values via CSS Color 4 matrices, not eyeballed.

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
};

export type ThemeScheme = "light" | "dark" | "unspecified" | null | undefined;

export const light: Palette = {
	background: "#fefdf9",
	foreground: "#2d241e",
	muted: "#f5f1ea",
	mutedForeground: "#746a61",
	card: "#fefdf9",
	cardForeground: "#2d241e",
	border: "#e4dfd7",
	primary: "#a1600d",
	primaryForeground: "#fffced",
	secondary: "#f5f1ea",
	secondaryForeground: "#2d241e",
	accent: "#f5f1ea",
	accentForeground: "#2d241e",
	ring: "#ac7a4a",
	destructive: "#e7000b"
};

export const dark: Palette = {
	background: "#2c231c",
	foreground: "#f5f1ea",
	muted: "#3c322a",
	mutedForeground: "#beb2a6",
	card: "#2c231c",
	cardForeground: "#f5f1ea",
	// Alpha border (docs-website oklch(0.96 0.018 80 / 14%)); RN accepts rgba().
	border: "rgba(248, 241, 229, 0.14)",
	primary: "#b86a00",
	primaryForeground: "#fffced",
	secondary: "#3c322a",
	secondaryForeground: "#f5f1ea",
	accent: "#3c322a",
	accentForeground: "#f5f1ea",
	ring: "#9a7144",
	destructive: "#ff6467"
};

export function themeForScheme(scheme: ThemeScheme): Palette {
	return scheme === "dark" ? dark : light;
}
