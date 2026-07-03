import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";
import { brandColors, iconSvg, iconTileSvg } from "./index.mjs";

const mediaDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"ide",
	"overlay",
	"src",
	"browser",
	"media"
);

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
const write = (name, buf) => writeFile(join(mediaDir, name), buf);

// scales preserve the app-icon padding now that the shared icon fills its box flush
// (see ICON_FIT in index.mjs): old effective fill was scale * 17.617/20.
const standard = { radius: 46, scale: 0.687 };
const maskable = { radius: 0, scale: 0.546 };

await write(
	"pwa-icon-192.png",
	await png(
		iconTileSvg({
			...standard,
			background: brandColors.surface.tile,
			size: 192
		})
	)
);
await write(
	"pwa-icon-512.png",
	await png(
		iconTileSvg({
			...standard,
			background: brandColors.surface.tile,
			size: 512
		})
	)
);
await write(
	"pwa-icon-maskable-192.png",
	await png(
		iconTileSvg({
			...maskable,
			background: brandColors.surface.tile,
			size: 192
		})
	)
);
await write(
	"pwa-icon-maskable-512.png",
	await png(
		iconTileSvg({
			...maskable,
			background: brandColors.surface.tile,
			size: 512
		})
	)
);

const icoSizes = await Promise.all(
	[16, 32, 48].map((s) => png(iconSvg({ height: s, width: s })))
);
await write("favicon.ico", await pngToIco(icoSizes));

console.log("Wrote favicon.ico and the four pwa-icon PNGs");
