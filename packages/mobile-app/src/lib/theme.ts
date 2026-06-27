/**
 * Composery token palette as hex.
 *
 * React Native does not parse `oklch()` (PLAN.md Wrinkle 3), so the docs-website
 * warm-amber oklch palette (packages/docs-website/src/app/global.css) is
 * converted to hex here once. The hex is derived from the oklch values, not
 * eyeballed — see tmp/oklch.mjs for the conversion (CSS Color 4 matrices,
 * cross-checked against sRGB red/blue/white/black).
 *
 * Pure data: no React Native imports, so it runs in Vitest in plain Node. The
 * scheme-aware `useTheme` hook lives in use-theme.ts (it needs react-native).
 */

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
	// docs-website --destructive oklch(0.577 0.245 27.325), converted to hex.
	destructive: "#e7000b"
};

export const dark: Palette = {
	background: "#2c231c",
	foreground: "#f5f1ea",
	muted: "#3c322a",
	mutedForeground: "#beb2a6",
	card: "#2c231c",
	cardForeground: "#f5f1ea",
	// The docs-website dark border is oklch(0.96 0.018 80 / 14%) — an alpha
	// border. RN processColor accepts rgba().
	border: "rgba(248, 241, 229, 0.14)",
	primary: "#b86a00",
	primaryForeground: "#fffced",
	secondary: "#3c322a",
	secondaryForeground: "#f5f1ea",
	accent: "#3c322a",
	accentForeground: "#f5f1ea",
	ring: "#9a7144",
	// docs-website dark --destructive oklch(0.704 0.191 22.216), converted to hex.
	destructive: "#ff6467"
};
