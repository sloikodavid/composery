// Regenerates the code-server raster branding from the icon mark. The mark
// vector lives in the favicon.svg next to the outputs; this script rasterizes it
// so the PNG/ICO never drift from the source. Run `node scripts/generate-icons.mjs`
// after the mark changes.
//
// Convention: the favicon (.ico) carries the bare mark; the installable PWA icons
// carry the mark on a solid stone tile, since a launcher masks the image and a
// transparent icon would look unfinished on the home screen. Maskable variants are
// full-bleed with extra padding so the mark survives the launcher's safe-zone crop.
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const mediaDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"vendor",
	"code-server",
	"overlay",
	"src",
	"browser",
	"media"
);
const TILE_BG = "#2c231c";

// The mark, centered on a 256 viewBox. Keep in sync with media/favicon.svg.
const MARK = `
	<defs>
		<linearGradient id="s1" gradientUnits="userSpaceOnUse" x1="128" x2="128" y1="23" y2="233">
			<stop stop-color="#F6C886" /><stop offset="1" stop-color="#9A5320" />
		</linearGradient>
		<linearGradient id="s2" gradientUnits="userSpaceOnUse" x1="128" x2="128" y1="59" y2="197">
			<stop stop-color="#ECAE60" /><stop offset="1" stop-color="#8F4C1C" />
		</linearGradient>
		<linearGradient id="s3" gradientUnits="userSpaceOnUse" x1="128" x2="128" y1="90" y2="160">
			<stop stop-color="#C97E3B" /><stop offset="1" stop-color="#6E3711" />
		</linearGradient>
	</defs>
	<path d="M200.5 71.4A92 92 0 1 0 200.5 184.6" stroke="url(#s1)" stroke-linecap="round" stroke-width="26" />
	<path d="M154.3 76.3A58 58 0 1 0 184.5 141" stroke="url(#s2)" stroke-linecap="round" stroke-width="22" />
	<path d="M130.4 101.1A27 27 0 1 0 154.1 121" stroke="url(#s3)" stroke-linecap="round" stroke-width="17" />`;

function bareSvg(size) {
	return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">${MARK}</svg>`;
}

function tileSvg(size, { radius, scale }) {
	const transform = `translate(128 128) scale(${scale}) translate(-128 -128)`;
	return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="256" rx="${radius}" fill="${TILE_BG}" /><g transform="${transform}">${MARK}</g></svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
const write = (name, buf) => writeFile(join(mediaDir, name), buf);

// Standard PWA icons: gently rounded tile, mark near full size.
const standard = { radius: 46, scale: 0.78 };
// Maskable icons: full-bleed tile, mark pulled in to survive the safe-zone crop.
const maskable = { radius: 0, scale: 0.62 };

await write("pwa-icon-192.png", await png(tileSvg(192, standard)));
await write("pwa-icon-512.png", await png(tileSvg(512, standard)));
await write("pwa-icon-maskable-192.png", await png(tileSvg(192, maskable)));
await write("pwa-icon-maskable-512.png", await png(tileSvg(512, maskable)));

// favicon.ico: bare mark at the classic legacy sizes.
const icoSizes = await Promise.all([16, 32, 48].map((s) => png(bareSvg(s))));
await write("favicon.ico", await pngToIco(icoSizes));

console.log("Wrote favicon.ico and the four pwa-icon PNGs");
