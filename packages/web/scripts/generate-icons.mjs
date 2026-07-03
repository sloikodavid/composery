// Regenerates the raster favicons from the Composery icon. The vector source
// lives in packages/brand/index.mjs; this script rasterizes it so the PNG/ICO
// never drift from the source. Run `node scripts/generate-icons.mjs` after the
// icon changes.
//
// Convention: favicons (the .svg and .ico) carry the bare icon; installable app
// icons (apple-icon) carry the icon on a solid tile, since iOS masks the
// image and a transparent icon would look unfinished on the home screen.
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";
import { brandColors, iconSvg, iconTileSvg } from "brand";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();

// apple-icon: full-bleed tile (iOS rounds the corners itself).
await writeFile(
	join(appDir, "apple-icon.png"),
	await png(
		iconTileSvg({
			background: brandColors.surface.tile,
			size: 180,
			scale: 0.7
		})
	)
);

// favicon.ico: bare icon at the classic legacy sizes.
const icoSizes = await Promise.all(
	[16, 32, 48].map((s) => png(iconSvg({ height: s, width: s })))
);
await writeFile(join(appDir, "favicon.ico"), await pngToIco(icoSizes));

console.log("Wrote app/apple-icon.png and app/favicon.ico");
