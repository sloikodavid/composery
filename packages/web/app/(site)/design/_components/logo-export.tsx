"use client";

import { toast } from "sonner";
import { AnimatedIconButton } from "@/components/animated-icon";
import { ICON_SVG } from "@/components/icon";
import {
	LOGO_HEIGHT,
	LOGO_INNER,
	LOGO_VIEWBOX,
	LOGO_WIDTH
} from "@/components/logo-data";

type Asset = { height: number; svg: string; width: number };

const ICON: Asset = {
	svg: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="none">${ICON_SVG}</svg>`,
	width: 256,
	height: 256
};

// The wordmark is fill="currentColor" in the source; materialize a concrete
// color per variant so the downloaded file is fixed (dark text for light
// backgrounds, light text for dark). Foregrounds mirror the Umber theme.
function logo(fill: string): Asset {
	return {
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" viewBox="${LOGO_VIEWBOX}" fill="none">${LOGO_INNER.replace("currentColor", fill)}</svg>`,
		width: LOGO_WIDTH,
		height: LOGO_HEIGHT
	};
}

const LOGO_LIGHT = logo("#2d241e");
const LOGO_DARK = logo("#f5f1ea");

function save(href: string, name: string) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = name;
	anchor.click();
}

function saveBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	save(url, name);
	URL.revokeObjectURL(url);
}

async function copySvg(asset: Asset) {
	try {
		await navigator.clipboard.writeText(asset.svg);
		toast.success("SVG copied");
	} catch {
		toast.error("Couldn't copy SVG");
	}
}

function downloadSvg(asset: Asset, name: string) {
	saveBlob(new Blob([asset.svg], { type: "image/svg+xml" }), `${name}.svg`);
}

// Rasterize the (font-free) asset SVG to a canvas at `scale`x its intrinsic size
// and save the PNG. No webfont is involved, so this is reliable across browsers.
function downloadPng(
	{ height, svg, width }: Asset,
	scale: number,
	name: string
) {
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	const image = new Image();
	image.onload = () => {
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		canvas
			.getContext("2d")
			?.drawImage(image, 0, 0, canvas.width, canvas.height);
		URL.revokeObjectURL(url);
		canvas.toBlob((blob) => {
			if (blob) saveBlob(blob, `${name}.png`);
			else toast.error("Couldn't render PNG");
		}, "image/png");
	};
	image.onerror = () => {
		URL.revokeObjectURL(url);
		toast.error("Couldn't render PNG");
	};
	image.src = url;
}

function ExportRow({
	asset,
	label,
	name,
	pngScale
}: {
	asset: Asset;
	label: string;
	name: string;
	pngScale: number;
}) {
	return (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">{label}</p>
			<div className="flex flex-wrap gap-2">
				<AnimatedIconButton
					icon="copy"
					iconPosition="start"
					onClick={() => copySvg(asset)}
					size="sm"
					variant="outline"
				>
					Copy SVG
				</AnimatedIconButton>
				<AnimatedIconButton
					icon="download"
					iconPosition="start"
					onClick={() => downloadSvg(asset, name)}
					size="sm"
					variant="outline"
				>
					Download SVG
				</AnimatedIconButton>
				<AnimatedIconButton
					icon="download"
					iconPosition="start"
					onClick={() => downloadPng(asset, pngScale, name)}
					size="sm"
					variant="outline"
				>
					Download PNG
				</AnimatedIconButton>
			</div>
		</div>
	);
}

export function LogoExport() {
	// PNG scale yields ~1024px on the icon's edge and ~480px tall on the logo -
	// high enough to place without re-exporting.
	return (
		<div className="space-y-4">
			<ExportRow asset={ICON} label="Icon" name="composery-icon" pngScale={4} />
			<ExportRow
				asset={LOGO_LIGHT}
				label="Logo (light)"
				name="composery-logo-light"
				pngScale={12}
			/>
			<ExportRow
				asset={LOGO_DARK}
				label="Logo (dark)"
				name="composery-logo-dark"
				pngScale={12}
			/>
		</div>
	);
}
