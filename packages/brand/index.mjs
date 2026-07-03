export const BRAND_NAME = "Composery";
export const LOGO_TEXT = "Composery";

export const ICON_VIEWBOX = "0 0 20 20";
export const ICON_WIDTH = 20;
export const ICON_HEIGHT = 20;
export const ICON_CROP_VIEWBOX = ICON_VIEWBOX;

export const brandColors = {
	icon: {
		light: "#000000",
		dark: "#ffffff",
		muted: "#737373",
		tileStroke: "#ffffff"
	},
	surface: {
		ink: "#000000",
		paper: "#ffffff",
		canvas: "#fafafa",
		border: "#e5e5e5",
		lightText: "#000000",
		darkText: "#ffffff",
		tile: "#0a0a0a",
		splash: "#ffffff"
	},
	state: {
		success: "#16a34a",
		warning: "#d97706",
		destructive: "#dc2626",
		info: "#2563eb"
	}
};

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
		warning: "#d97706",
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
		foreground: "#ffffff",
		card: "#0a0a0a",
		cardForeground: "#ffffff",
		popover: "#0a0a0a",
		popoverForeground: "#ffffff",
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
		warning: "#f59e0b",
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
		sidebarForeground: "#ffffff",
		sidebarPrimary: "#fafafa",
		sidebarPrimaryForeground: "#0a0a0a",
		sidebarAccent: "#171717",
		sidebarAccentForeground: "#fafafa",
		sidebarBorder: "#ffffff1f",
		sidebarRing: "#737373"
	}
};

const ICON_PATH =
	"M12 5 L17.6 14.6 C20.6 19.8 19.2 19.8 15.6 19.8 L8.4 19.8 C4.8 19.8 3.4 19.8 6.4 14.6 Z";
const ICON_SLIT_PATH = "M12 15.5 L12 3.6";
const ICON_MASK_ID = "composery-icon-holes";

// The raw shape is drawn in a 0..20 space then rotated 135deg about (12,12), which
// leaves the ink off-center with uneven padding - it spans ~[0.62..18.23], not the
// full box. This scales and re-centers the ink so the icon fills its 0..20 box flush,
// with no dead space, in every consumer - without changing the design. Ink bounds
// measured with tmp/measure-icon.mjs; update if ICON_PATH or the stroke width changes.
const ICON_INK_MIN = 0.617;
const ICON_INK_SIZE = 17.617;
const ICON_FIT_SCALE = 20 / ICON_INK_SIZE;
const ICON_FIT_SHIFT = -ICON_INK_MIN * ICON_FIT_SCALE;
const ICON_FIT = `translate(${ICON_FIT_SHIFT} ${ICON_FIT_SHIFT}) scale(${ICON_FIT_SCALE}) rotate(135 12 12)`;

export function iconInner({
	fill = "currentColor",
	maskId = ICON_MASK_ID
} = {}) {
	return `<g transform="${ICON_FIT}"><mask id="${maskId}"><rect width="24" height="24" fill="#fff" stroke="none"/><circle cx="12" cy="15" r="3.6" fill="#000" stroke="none"/><path d="${ICON_SLIT_PATH}" stroke="#000" stroke-linecap="round" stroke-width="2.1"/></mask><path d="${ICON_PATH}" fill="${fill}" stroke="${fill}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6" mask="url(#${maskId})"/></g>`;
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
