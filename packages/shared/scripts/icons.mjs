// Rasterizes the Composery icon into every platform's PNG/ICO assets. Vector
// source: packages/shared/index.ts. One home for all raster brand icons - the editor overlay,
// web, and the mobile app - so a size or padding change happens in a single file.
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";
import {
	brandColors,
	centeredIconSvg,
	iconSvg,
	iconTileSvg
} from "../index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ideMedia = join(
	root,
	"packages",
	"ide",
	"overlay",
	"src",
	"browser",
	"media"
);
const webApp = join(root, "packages", "web", "app");
const mobileImages = join(root, "packages", "mobile", "assets", "images");

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
const write = (path, buf) => writeFile(path, buf);
const ico = (sizes) =>
	Promise.all(sizes.map((s) => png(iconSvg({ height: s, width: s })))).then(
		pngToIco
	);

// scales preserve the app-icon padding now that the shared icon fills its box flush
// (see ICON_FIT in index.mjs): old effective fill was scale * 17.617/20.

// Editor overlay: installable PWA icons on a solid tile (maskable variant unpadded
// so the OS mask has room), plus a bare-icon favicon.
const standard = { radius: 46, scale: 0.687 };
const maskable = { radius: 0, scale: 0.546 };
await write(
	join(ideMedia, "pwa-icon-192.png"),
	await png(
		iconTileSvg({
			...standard,
			background: brandColors.surface.tile,
			size: 192
		})
	)
);
await write(
	join(ideMedia, "pwa-icon-512.png"),
	await png(
		iconTileSvg({
			...standard,
			background: brandColors.surface.tile,
			size: 512
		})
	)
);
await write(
	join(ideMedia, "pwa-icon-maskable-192.png"),
	await png(
		iconTileSvg({
			...maskable,
			background: brandColors.surface.tile,
			size: 192
		})
	)
);
await write(
	join(ideMedia, "pwa-icon-maskable-512.png"),
	await png(
		iconTileSvg({
			...maskable,
			background: brandColors.surface.tile,
			size: 512
		})
	)
);
await write(join(ideMedia, "favicon.ico"), await ico([16, 32, 48]));

// Web: apple-icon is a full-bleed tile (iOS rounds the corners itself); favicon.ico
// is the bare icon at the classic legacy sizes.
await write(
	join(webApp, "apple-icon.png"),
	await png(
		iconTileSvg({ background: brandColors.surface.tile, size: 180, scale: 0.7 })
	)
);
await write(join(webApp, "favicon.ico"), await ico([16, 32, 48]));

// Mobile: app icon, Android adaptive layers, splash, and web favicon - the paths
// mobile/app.json references.
const solidSvg = (size, color) =>
	`<svg width="${size}" height="${size}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="256" fill="${color}"/></svg>`;
await write(
	join(mobileImages, "icon.png"),
	await png(
		iconTileSvg({
			background: brandColors.surface.tile,
			size: 1024,
			scale: 0.687
		})
	)
);
await write(
	join(mobileImages, "android-icon-background.png"),
	await png(solidSvg(1024, brandColors.surface.tile))
);
await write(
	join(mobileImages, "android-icon-foreground.png"),
	await png(
		centeredIconSvg({
			size: 1024,
			scale: 0.546,
			fill: brandColors.icon.tileStroke
		})
	)
);
await write(
	join(mobileImages, "android-icon-monochrome.png"),
	await png(centeredIconSvg({ size: 1024, scale: 0.546, fill: "#ffffff" }))
);
// Two splash icons: the splash background follows the system theme, so a single
// ink glyph would be black on near-black in dark mode.
await write(
	join(mobileImages, "splash-icon.png"),
	await png(
		centeredIconSvg({ size: 384, scale: 0.687, fill: brandColors.surface.ink })
	)
);
await write(
	join(mobileImages, "splash-icon-dark.png"),
	await png(
		centeredIconSvg({ size: 384, scale: 0.687, fill: brandColors.icon.dark })
	)
);
await write(
	join(mobileImages, "favicon.png"),
	await png(
		iconTileSvg({
			background: brandColors.surface.tile,
			size: 64,
			scale: 0.687,
			radius: 56
		})
	)
);

console.log("Wrote raster icons for the editor overlay, web, and mobile.");
