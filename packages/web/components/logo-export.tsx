"use client";

import { AnimatedIconButton } from "@/components/animated-icon";
import {
	type BrandAsset,
	copySvg,
	downloadPng,
	downloadSvg,
	ICON_LIGHT_ASSET,
	LOGO_DARK_ASSET,
	LOGO_LIGHT_ASSET
} from "@/lib/brand-assets";

function ExportRow({
	asset,
	label,
	name,
	pngScale
}: {
	asset: BrandAsset;
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
			<ExportRow
				asset={ICON_LIGHT_ASSET}
				label="Icon"
				name="composery-icon"
				pngScale={4}
			/>
			<ExportRow
				asset={LOGO_LIGHT_ASSET}
				label="Logo (light)"
				name="composery-logo-light"
				pngScale={12}
			/>
			<ExportRow
				asset={LOGO_DARK_ASSET}
				label="Logo (dark)"
				name="composery-logo-dark"
				pngScale={12}
			/>
		</div>
	);
}
