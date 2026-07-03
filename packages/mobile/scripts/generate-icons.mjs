// Regenerates the Composery mobile app icons from the shared brand icon. Run
// `node ./scripts/generate-icons.mjs` after the icon or palette changes. Uses
// sharp (a root devDep) - no mobile dep added.
//
// Outputs (all into assets/images/, the paths app.json references):
//   icon.png                       1024 - app icon (full-bleed tile + color icon)
//   android-icon-background.png    1024 - adaptive background (solid tile)
//   android-icon-foreground.png    1024 - adaptive foreground (safe-zone icon)
//   android-icon-monochrome.png    1024 - Android 13 themed-icon silhouette
//   splash-icon.png                 384 - splash icon (dark strokes on transparent)
//   favicon.png                      64 - web favicon (tile + color icon)
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { brandColors, centeredIconSvg, iconTileSvg } from "brand";

const outDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"assets",
	"images"
);

// Solid color fill for the adaptive background.
function solidSvg(size, color) {
	return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="256" fill="${color}"/></svg>`;
}

const png = (svgStr) => sharp(Buffer.from(svgStr)).png().toBuffer();
const write = (name, buf) => writeFile(join(outDir, name), buf);

await write(
	"icon.png",
	await png(
		iconTileSvg({
			background: brandColors.surface.tile,
			size: 1024,
			scale: 0.687
		})
	)
);
await write(
	"android-icon-background.png",
	await png(solidSvg(1024, brandColors.surface.tile))
);
await write(
	"android-icon-foreground.png",
	await png(
		centeredIconSvg({
			size: 1024,
			scale: 0.546,
			fill: brandColors.icon.tileStroke
		})
	)
);
await write(
	"android-icon-monochrome.png",
	await png(centeredIconSvg({ size: 1024, scale: 0.546, fill: "#ffffff" }))
);
await write(
	"splash-icon.png",
	await png(
		centeredIconSvg({
			size: 384,
			scale: 0.687,
			fill: brandColors.surface.ink
		})
	)
);
await write(
	"favicon.png",
	await png(
		iconTileSvg({
			background: brandColors.surface.tile,
			size: 64,
			scale: 0.687,
			radius: 56
		})
	)
);

console.log("Wrote Composery icons to assets/images/");
