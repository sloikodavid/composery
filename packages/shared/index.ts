// The single source of truth for who/what this project is: brand, identity, and
// the pure (zero-dependency) icon-SVG builders derived from them. Everything here
// is plain data or pure string functions, so every surface imports it DIRECTLY -
// web, mobile, the IDE build scripts, and rebrand.mjs - with no generated copies
// and no drift. Node imports it via type-stripping; bundlers transpile it.
//
// Files that cannot import TS (Dockerfile, compose, templates/, .env.example.*,
// CI, Markdown) duplicate these values by hand; CONTAINER_IMAGE and REPO below are
// the canonical copy to sync them to. CSS variables and raster/logo picture assets
// are derived from this file by the generator scripts in ./scripts.

// --- Brand -----------------------------------------------------------------

export const BRAND_NAME = "Composery";
export const LOGO_TEXT = "Composery";

export const ICON_VIEWBOX = "0 0 20 20";
export const ICON_WIDTH = 20;
export const ICON_HEIGHT = 20;
export const ICON_CROP_VIEWBOX = ICON_VIEWBOX;

// The product palette. Edit it through `pnpm theme` (scripts/color-console) rather
// than by hand: the console writes this block, the IDE theme JSONs, the patch pins
// and every generated asset in one pass, so no surface can be left behind.
//
// Surfaces sit ABOVE the page, never below it: `card` (the elevated surface - site
// header, footer, docs sidebar, cards, inputs, the outline button fill) is lighter
// than `background` in light and dark alike, and `popover` is one step further up
// for things that float (dialogs, menus, toasts). Against the page an outline
// control then reads as the familiar near-white chip without ever being white.
export const theme = {
	light: {
		background: "#cdc9c4",
		foreground: "#323229",
		card: "#d7d3cf",
		cardForeground: "#323229",
		popover: "#dedbd7",
		popoverForeground: "#323229",
		primary: "#323229",
		primaryForeground: "#cdc9c4",
		secondary: "#c6c1bc",
		secondaryForeground: "#323229",
		muted: "#c6c1bc",
		mutedForeground: "#6b6456",
		accent: "#c6c1bc",
		accentForeground: "#323229",
		destructive: "#8a372e",
		success: "#415331",
		warning: "#513c2c",
		info: "#3d4f5c",
		border: "#00000017",
		input: "#00000017",
		ring: "#6b6456",
		overlay: "rgba(0, 0, 0, 0.4)",
		shadow: "#00000014",
		chart1: "#323229",
		chart2: "#513c2c",
		chart3: "#8a372e",
		chart4: "#415331",
		chart5: "#6b6456"
	},
	dark: {
		background: "#1d1b1b",
		foreground: "#c1b5a9",
		card: "#242121",
		cardForeground: "#c1b5a9",
		popover: "#2a2725",
		popoverForeground: "#c1b5a9",
		primary: "#c1b5a9",
		primaryForeground: "#1d1b1b",
		secondary: "#2d2925",
		secondaryForeground: "#c1b5a9",
		muted: "#2d2925",
		mutedForeground: "#7e7467",
		accent: "#2d2925",
		accentForeground: "#c1b5a9",
		destructive: "#c15145",
		success: "#90ae75",
		warning: "#b38e72",
		info: "#8ba3b3",
		border: "#ffffff14",
		input: "#ffffff14",
		ring: "#7e7467",
		overlay: "rgba(0, 0, 0, 0.4)",
		shadow: "#0000001f",
		chart1: "#c1b5a9",
		chart2: "#b38e72",
		chart3: "#c15145",
		chart4: "#90ae75",
		chart5: "#7e7467"
	}
} as const;

// What the editor needs on top of the shared palette. Anything the IDE can take
// straight from `theme` is NOT repeated here - a role earns a line only where the
// editor genuinely differs (its chrome is flush with the editor, not raised like
// the site's) or where the surface has no web equivalent at all (syntax, ANSI).
// Roles listed in `ideLinked` below are kept equal to their `theme` counterpart
// by the console, so they move together until you unlink them there.
export const ideTheme = {
	light: {
		chrome: "#cdc9c4",
		editor: "#cdc9c4",
		surface: "#c8c4be",
		hover: "#c6c1bc",
		lineNumber: "#6b6456",
		ignored: "#6f6758",
		focus: "#323229",
		keyword: "#6f604d",
		string: "#415331",
		number: "#873a2b",
		type: "#433223",
		variable: "#323229",
		punctuation: "#6b6456",
		comment: "#275e91",
		invalid: "#803a14",
		ansiBlack: "#433223",
		ansiRed: "#8a372e",
		ansiGreen: "#415331",
		ansiYellow: "#6f604d",
		ansiBlue: "#433223",
		ansiMagenta: "#873a2b",
		ansiCyan: "#433223",
		ansiWhite: "#c6c1bc",
		ansiBrightBlack: "#6b6456"
	},
	dark: {
		chrome: "#1d1b1b",
		editor: "#1d1b1b",
		surface: "#181616",
		hover: "#2d2925",
		lineNumber: "#7e7467",
		ignored: "#867e75",
		focus: "#c1b5a9",
		keyword: "#918473",
		string: "#90ae75",
		number: "#9b745f",
		type: "#ada294",
		variable: "#c1b5a9",
		punctuation: "#7e7467",
		comment: "#7c9abb",
		invalid: "#cea36f",
		ansiBlack: "#181616",
		ansiRed: "#c15145",
		ansiGreen: "#90ae75",
		ansiYellow: "#918473",
		ansiBlue: "#ada294",
		ansiMagenta: "#9b745f",
		ansiCyan: "#ada294",
		ansiWhite: "#ada294",
		ansiBrightBlack: "#7b746b"
	}
} as const;

// Which `theme` role each IDE role can follow. This is the pairing, not the
// state: a role missing here (syntax, ANSI) is IDE-only by definition and can
// never link, and re-linking a role in the console restores the pairing named
// here.
export const IDE_THEME_LINKS = {
	chrome: "background",
	editor: "background",
	surface: "card",
	hover: "accent",
	lineNumber: "mutedForeground",
	ignored: "mutedForeground",
	focus: "foreground",
	variable: "foreground",
	punctuation: "mutedForeground",
	string: "success",
	number: "destructive",
	invalid: "destructive",
	ansiRed: "destructive",
	ansiGreen: "success",
	ansiBrightBlack: "mutedForeground"
} as const;

// Which links are live right now, per scheme. Membership is the whole state:
// a listed role takes its value from `theme` and the console keeps its entry in
// `ideTheme` equal to the source, so every consumer still reads a real colour
// and never has to resolve anything. Dropping a role from this list is what
// "unlink" means - the value it was showing becomes its own to edit.
export const ideLinked = {
	light: [
		"chrome",
		"editor",
		"hover",
		"focus",
		"variable",
		"punctuation",
		"string",
		"ansiGreen",
		"ansiRed",
		"lineNumber"
	],
	dark: [
		"chrome",
		"editor",
		"hover",
		"focus",
		"variable",
		"punctuation",
		"string",
		"ansiGreen",
		"ansiRed",
		"lineNumber"
	]
} as const;

export const BRAND_IDE_THEME = ideTheme;

// Marks, icons and app chrome are the same palette as the UI theme above, not a
// second greyscale one: every value here is a pick from `theme`, so the logo, the
// favicons, the launcher icon and the splash cannot drift away from the product.
export const brandColors = {
	icon: {
		light: theme.light.primary,
		dark: theme.dark.primary,
		muted: theme.light.mutedForeground,
		tileStroke: theme.dark.primary
	},
	surface: {
		ink: theme.light.primary,
		paper: theme.dark.primary,
		canvas: theme.light.background,
		border: theme.light.secondary,
		lightText: theme.light.primary,
		darkText: theme.dark.primary,
		tile: theme.dark.card,
		splash: theme.light.background,
		splashDark: theme.dark.background
	},
	state: {
		success: theme.light.success,
		warning: theme.light.warning,
		destructive: theme.light.destructive,
		info: theme.light.info
	}
} as const;

// SCREAMING_CASE aliases: the app-facing name for the palette/theme.
export const BRAND_COLORS = brandColors;
export const BRAND_THEME = theme;

// --- Icon SVG builders (pure, zero-dep) ------------------------------------

// The raw shape is drawn in a 0..20 space then rotated 135deg about (12,12), which
// leaves the ink off-center with uneven padding - it spans ~[0.62..18.23], not the
// full box. This scales and re-centers the ink so the icon fills its 0..20 box flush,
// with no dead space, in every consumer - without changing the design. Ink bounds
// measured with tmp/measure-icon.mjs; update if ICON_PATH or the stroke width changes.
const ICON_PATH =
	"M12 5 L17.6 14.6 C20.6 19.8 19.2 19.8 15.6 19.8 L8.4 19.8 C4.8 19.8 3.4 19.8 6.4 14.6 Z";
// The holes - a circle with a slit running into it - subtract from the mark as one
// even-odd subpath, not as the two shapes they read as: two overlapping subpaths
// cancel where they overlap under even-odd and paint the lens back in. So the
// outline traces their union - up the slit's left wall, over its round cap, down
// the right wall to where it meets the circle at y = 15 - sqrt(3.6^2 - 1.05^2),
// then the long way round the circle. Slit r 1.05 (the old stroke-width 2.1),
// circle r 3.6 at (12,15), both unchanged from the shapes this replaced.
const ICON_HOLES_PATH =
	"M0 0H24V24H0Z M10.95 11.55653 L10.95 3.6 A1.05 1.05 0 0 1 13.05 3.6 L13.05 11.55653 A3.6 3.6 0 1 1 10.95 11.55653 Z";
const ICON_HOLES_ID = "composery-icon-holes";
const ICON_INK_MIN = 0.617;
const ICON_INK_SIZE = 17.617;
const ICON_FIT_SCALE = 20 / ICON_INK_SIZE;
const ICON_FIT_SHIFT = -ICON_INK_MIN * ICON_FIT_SCALE;
const ICON_FIT = `translate(${ICON_FIT_SHIFT} ${ICON_FIT_SHIFT}) scale(${ICON_FIT_SCALE}) rotate(135 12 12)`;

// The holes are clipped, not masked. A <mask> makes the engine rasterize the mask,
// take its luminance and multiply that in - a step engines do not agree on (the
// colour space the luminance is computed in is the known divergence), and the
// intermediate is what carries the hole's antialiasing. WebKit renders those edges
// soft where Blink keeps them crisp, so the mark looked mushy on iOS and nowhere
// else. A clip is pure geometry with no luminance step, so every engine antialiases
// the hole the same way it antialiases the outer edge.
export function iconInner({
	fill = "currentColor",
	holesId = ICON_HOLES_ID
} = {}) {
	return `<g transform="${ICON_FIT}"><clipPath id="${holesId}"><path clip-rule="evenodd" d="${ICON_HOLES_PATH}"/></clipPath><path d="${ICON_PATH}" fill="${fill}" stroke="${fill}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6" clip-path="url(#${holesId})"/></g>`;
}

export function iconSvg({
	color = brandColors.icon.light,
	fill = "currentColor",
	height = 256,
	viewBox = ICON_VIEWBOX,
	width = 256
} = {}) {
	return `<svg width="${width}" height="${height}" viewBox="${viewBox}" fill="none" color="${color}" xmlns="http://www.w3.org/2000/svg">${iconInner({ fill })}</svg>`;
}

export function iconTileSvg({
	background = brandColors.surface.tile,
	fill = brandColors.icon.tileStroke,
	radius = 0,
	scale = 0.652,
	size = ICON_WIDTH
} = {}) {
	const iconScale = (256 / ICON_WIDTH) * scale;
	const transform = `translate(128 128) scale(${iconScale}) translate(-10 -10)`;
	const rect = `<rect width="256" height="256"${radius ? ` rx="${radius}"` : ""} fill="${background}"/>`;

	return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">${rect}<g transform="${transform}">${iconInner({ fill })}</g></svg>`;
}

export function centeredIconSvg({
	color = brandColors.icon.light,
	fill = "currentColor",
	scale = 0.652,
	size = ICON_WIDTH
} = {}) {
	const iconScale = (256 / ICON_WIDTH) * scale;
	const transform = `translate(128 128) scale(${iconScale}) translate(-10 -10)`;
	return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" color="${color}" xmlns="http://www.w3.org/2000/svg"><g transform="${transform}">${iconInner({ fill })}</g></svg>`;
}

// Pre-rendered icon strings the apps embed directly.
export const ICON_SVG = iconInner();
export const ICON_XML = iconSvg({ viewBox: ICON_CROP_VIEWBOX });

// --- Identity --------------------------------------------------------------

// The legal person behind Composery Cloud. Shown on the Terms and Privacy pages
// and used as the merchant/support identity. The address is a legal requirement
// for the terms; swap all four fields to re-owner the hosted service.
export const OWNER = {
	legalName: "David Sloiko",
	tradingName: "Composery",
	jurisdiction: "Ireland",
	address: "20 Templegreen, Newcastle West, Co. Limerick, V42 AH01, Ireland",
	email: "sloikodavid@gmail.com"
} as const;

// GitHub coordinates. A fork repoints these once and every derived URL follows.
export const REPO = {
	owner: "sloikodavid",
	name: "composery",
	branch: "main"
} as const;

// Social handles: x.com/<x>, linkedin.com/company/<linkedin>.
export const SOCIAL = {
	x: "sloikodavid",
	linkedin: "composery"
} as const;

// Marketing site. The hosted cloud's own domains are env-driven at runtime
// (CLOUD_DOMAIN / WEBSITE_ORIGIN, see packages/web/convex/env.ts); these are the
// build-time defaults for static site copy and links.
export const WEBSITE_DOMAIN = "composery.io";
export const WEBSITE_ORIGIN = "https://www.composery.io";

// Published runtime image on GHCR. Infra files that can't import TS (Dockerfile,
// compose, templates/, .env.example.*) hardcode this same string - keep in sync.
export const CONTAINER_IMAGE = "ghcr.io/sloikodavid/composery";

export const APP_DESCRIPTION =
	"Composery is an always-on cloud IDE: VS Code in the browser or on your phone, self-hosted on your own server or managed in Composery Cloud, and made for long-running AI agents.";

// The one-line pitch, in the product's own voice. Longer prose (APP_DESCRIPTION)
// is what search engines and app stores get; this is what a person reads first.
// README.md and docs/index.md cannot import it and copy it by hand - the "brand
// copy" test in tests/brand-copy.test.ts is what keeps those copies honest.
export const APP_TAGLINE =
	"A secure cloud computer with a powerful UI, usable from any phone or browser.";
