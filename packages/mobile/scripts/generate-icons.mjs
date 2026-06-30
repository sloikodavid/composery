// Regenerates the Composery mobile app icons from the brand mark. The mark is
// the three concentric amber arcs used across code-server (favicon.svg) and the
// docs site. Run `node ./scripts/generate-icons.mjs` after the mark or palette
// changes. Uses sharp (a root devDep) — no mobile dep added.
//
// Outputs (all into assets/images/, the paths app.json references):
//   icon.png                       1024 — app icon (full-bleed dark-stone tile + amber mark)
//   android-icon-background.png    1024 — adaptive background (solid dark stone)
//   android-icon-foreground.png    1024 — adaptive foreground (amber mark, safe-zone scaled)
//   android-icon-monochrome.png    1024 — Android 13 themed-icon silhouette (white mark)
//   splash-icon.png                 384 — splash mark (dark-stone strokes on transparent,
//                                          high contrast on the amber splash background)
//   favicon.png                      64 — web favicon (dark-stone tile + amber mark)
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const outDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"assets",
	"images"
);
// Composery dark stone — matches the code-server PWA icon tiles.
const TILE_BG = "#2c231c";
// Composery amber strokes for the splash mark (contrasts the amber splash bg).
const DARK_STROKE = "#2c231c";

// The mark on a 256 viewBox, centered. strokeFor picks per-arc colors:
// "gradient" = the amber gradient, "white" = monochrome, "dark" = dark stone.
function markBody(strokeFor) {
	const strokes = {
		gradient: ["url(#s1)", "url(#s2)", "url(#s3)"],
		white: ["#ffffff", "#ffffff", "#ffffff"],
		dark: [DARK_STROKE, DARK_STROKE, DARK_STROKE]
	}[strokeFor];
	const defs =
		strokeFor === "gradient"
			? `<defs>
		<linearGradient id="s1" gradientUnits="userSpaceOnUse" x1="128" x2="128" y1="23" y2="233"><stop stop-color="#F6C886"/><stop offset="1" stop-color="#9A5320"/></linearGradient>
		<linearGradient id="s2" gradientUnits="userSpaceOnUse" x1="128" x2="128" y1="59" y2="197"><stop stop-color="#ECAE60"/><stop offset="1" stop-color="#8F4C1C"/></linearGradient>
		<linearGradient id="s3" gradientUnits="userSpaceOnUse" x1="128" x2="128" y1="90" y2="160"><stop stop-color="#C97E3B"/><stop offset="1" stop-color="#6E3711"/></linearGradient>
	</defs>`
			: "";
	return `${defs}
	<path d="M200.5 71.4A92 92 0 1 0 200.5 184.6" stroke="${strokes[0]}" stroke-linecap="round" stroke-width="26"/>
	<path d="M154.3 76.3A58 58 0 1 0 184.5 141" stroke="${strokes[1]}" stroke-linecap="round" stroke-width="22"/>
	<path d="M130.4 101.1A27 27 0 1 0 154.1 121" stroke="${strokes[2]}" stroke-linecap="round" stroke-width="17"/>`;
}

function svg(size, inner) {
	return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// Full-bleed dark-stone tile with the amber mark scaled to `scale`.
function tileSvg(size, scale, radius = 0) {
	const transform = `translate(128 128) scale(${scale}) translate(-128 -128)`;
	const rect = `<rect width="256" height="256"${radius ? ` rx="${radius}"` : ""} fill="${TILE_BG}"/>`;
	return svg(
		size,
		`${rect}<g transform="${transform}">${markBody("gradient")}</g>`
	);
}

// Bare mark on transparent, centered and scaled to `scale`.
function centeredMarkSvg(size, scale, strokeFor) {
	const transform = `translate(128 128) scale(${scale}) translate(-128 -128)`;
	return svg(size, `<g transform="${transform}">${markBody(strokeFor)}</g>`);
}

// Solid color fill (for the adaptive background).
function solidSvg(size, color) {
	return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="256" fill="${color}"/></svg>`;
}

const png = (svgStr) => sharp(Buffer.from(svgStr)).png().toBuffer();
const write = (name, buf) => writeFile(join(outDir, name), buf);

// App icon: full-bleed dark-stone square (the OS masks), amber mark near full size.
await write("icon.png", await png(tileSvg(1024, 0.78)));
// Android adaptive: full-bleed background + safe-zone-scaled foreground mark.
await write("android-icon-background.png", await png(solidSvg(1024, TILE_BG)));
await write(
	"android-icon-foreground.png",
	await png(centeredMarkSvg(1024, 0.62, "gradient"))
);
await write(
	"android-icon-monochrome.png",
	await png(centeredMarkSvg(1024, 0.62, "white"))
);
// Splash mark: dark-stone strokes for contrast on the amber splash background.
await write("splash-icon.png", await png(centeredMarkSvg(384, 0.78, "dark")));
// Web favicon: dark-stone tile + amber mark.
await write("favicon.png", await png(tileSvg(64, 0.78, 56)));

console.log("Wrote Composery icons to assets/images/");
