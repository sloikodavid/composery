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

export const brandColors = {
	icon: {
		light: "#000000",
		dark: "#fafafa",
		muted: "#737373",
		tileStroke: "#ffffff"
	},
	surface: {
		ink: "#000000",
		paper: "#ffffff",
		canvas: "#fafafa",
		border: "#e5e5e5",
		lightText: "#000000",
		darkText: "#fafafa",
		tile: "#0a0a0a",
		splash: "#ffffff"
	},
	state: {
		success: "#16a34a",
		warning: "#dc8a06",
		destructive: "#dc2626",
		info: "#2563eb"
	}
} as const;

export const theme = {
	light: {
		background: "#ffffff",
		foreground: "#000000",
		card: "#ffffff",
		cardForeground: "#000000",
		popover: "#ffffff",
		popoverForeground: "#000000",
		primary: "#171717",
		primaryForeground: "#fafafa",
		secondary: "#f5f5f5",
		secondaryForeground: "#171717",
		muted: "#f5f5f5",
		mutedForeground: "#737373",
		accent: "#f5f5f5",
		accentForeground: "#171717",
		destructive: "#dc2626",
		success: "#16a34a",
		warning: "#dc8a06",
		border: "#e5e5e5",
		input: "#e5e5e5",
		ring: "#a3a3a3",
		overlay: "rgba(0, 0, 0, 0.4)",
		chart1: "#171717",
		chart2: "#525252",
		chart3: "#737373",
		chart4: "#a3a3a3",
		chart5: "#d4d4d4",
		sidebar: "#ffffff",
		sidebarForeground: "#000000",
		sidebarPrimary: "#171717",
		sidebarPrimaryForeground: "#fafafa",
		sidebarAccent: "#f5f5f5",
		sidebarAccentForeground: "#171717",
		sidebarBorder: "#e5e5e5",
		sidebarRing: "#a3a3a3"
	},
	dark: {
		background: "#0a0a0a",
		foreground: "#fafafa",
		card: "#0a0a0a",
		cardForeground: "#fafafa",
		popover: "#0a0a0a",
		popoverForeground: "#fafafa",
		primary: "#fafafa",
		primaryForeground: "#0a0a0a",
		secondary: "#171717",
		secondaryForeground: "#fafafa",
		muted: "#171717",
		mutedForeground: "#a3a3a3",
		accent: "#171717",
		accentForeground: "#fafafa",
		destructive: "#f87171",
		success: "#22c55e",
		warning: "#f5a80b",
		border: "#ffffff1f",
		input: "#ffffff29",
		ring: "#737373",
		overlay: "rgba(0, 0, 0, 0.4)",
		chart1: "#fafafa",
		chart2: "#d4d4d4",
		chart3: "#a3a3a3",
		chart4: "#737373",
		chart5: "#525252",
		sidebar: "#0a0a0a",
		sidebarForeground: "#fafafa",
		sidebarPrimary: "#fafafa",
		sidebarPrimaryForeground: "#0a0a0a",
		sidebarAccent: "#171717",
		sidebarAccentForeground: "#fafafa",
		sidebarBorder: "#ffffff1f",
		sidebarRing: "#737373"
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
