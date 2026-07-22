"use client";

import type { ReactNode } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { CopyLinkButton } from "@/components/copy-link-button";
import { BrandIcon } from "@/components/brand-icon";
import { LogoLockup } from "@/components/logo";
import {
	type BrandAsset,
	downloadPng,
	downloadSvg,
	ICON_DARK_ASSET,
	ICON_LIGHT_ASSET,
	LOGO_DARK_ASSET,
	LOGO_LIGHT_ASSET
} from "@/lib/brand-assets";
import { BRAND_COLORS } from "shared";

// Checkerboard preview surfaces so it's clear the downloaded SVG/PNG are
// transparent - the background isn't part of the file. A light and a dark board
// also show each mark's fill: pure black on light, pure white on dark.
const CHECKER_LIGHT = {
	board:
		"repeating-conic-gradient(#f3f3f3 0% 25%, #ffffff 0% 50%) 0 / 20px 20px",
	color: BRAND_COLORS.surface.ink
};
const CHECKER_DARK = {
	board:
		"repeating-conic-gradient(#151515 0% 25%, #0a0a0a 0% 50%) 0 / 20px 20px",
	color: BRAND_COLORS.surface.paper
};

function Tile({
	asset,
	board,
	color,
	label,
	mark,
	name,
	pngScale
}: {
	asset: BrandAsset;
	board: string;
	color: string;
	label: string;
	mark: ReactNode;
	name: string;
	pngScale: number;
}) {
	return (
		<div className="space-y-2.5">
			<p className="text-xs text-muted-foreground">{label}</p>
			<div
				className="flex min-h-44 items-center justify-center rounded-2xl border border-border p-10"
				style={{ background: board, color }}
			>
				{mark}
			</div>
			<div className="flex flex-wrap gap-2">
				<CopyLinkButton
					label="SVG"
					message="SVG copied"
					size="sm"
					value={asset.svg}
					variant="outline"
				/>
				<AnimatedIconButton
					icon="download"
					iconPosition="start"
					onClick={() => downloadSvg(asset, name)}
					size="sm"
					variant="outline"
				>
					SVG
				</AnimatedIconButton>
				<AnimatedIconButton
					icon="download"
					iconPosition="start"
					onClick={() => downloadPng(asset, pngScale, name)}
					size="sm"
					variant="outline"
				>
					PNG
				</AnimatedIconButton>
			</div>
		</div>
	);
}

const COLORS: [string, string][] = [
	["Black", BRAND_COLORS.surface.ink],
	["White", BRAND_COLORS.surface.paper],
	["Success", BRAND_COLORS.state.success],
	["Warning", BRAND_COLORS.state.warning],
	["Destructive", BRAND_COLORS.state.destructive],
	["Info", BRAND_COLORS.state.info]
];

function ColorCard({ hex, label }: { hex: string; label: string }) {
	return (
		<div className="space-y-2.5">
			<p className="text-xs text-muted-foreground">{label}</p>
			<div
				className="h-20 rounded-2xl border border-border"
				style={{ background: hex }}
			/>
			<CopyLinkButton
				className="w-full justify-start"
				label={hex}
				message={`Copied ${hex}`}
				size="sm"
				value={hex}
				variant="outline"
			/>
		</div>
	);
}

export function BrandKit() {
	return (
		<div className="space-y-8">
			<div className="grid gap-5 sm:grid-cols-2">
				<Tile
					asset={LOGO_LIGHT_ASSET}
					board={CHECKER_LIGHT.board}
					color={CHECKER_LIGHT.color}
					label="Logo"
					mark={<LogoLockup className="h-16 w-auto" />}
					name="composery-logo-light"
					pngScale={12}
				/>
				<Tile
					asset={LOGO_DARK_ASSET}
					board={CHECKER_DARK.board}
					color={CHECKER_DARK.color}
					label="Logo"
					mark={<LogoLockup className="h-16 w-auto" />}
					name="composery-logo-dark"
					pngScale={12}
				/>
				<Tile
					asset={ICON_LIGHT_ASSET}
					board={CHECKER_LIGHT.board}
					color={CHECKER_LIGHT.color}
					label="Icon"
					mark={<BrandIcon className="size-24" />}
					name="composery-icon-light"
					pngScale={4}
				/>
				<Tile
					asset={ICON_DARK_ASSET}
					board={CHECKER_DARK.board}
					color={CHECKER_DARK.color}
					label="Icon"
					mark={<BrandIcon className="size-24" />}
					name="composery-icon-dark"
					pngScale={4}
				/>
			</div>

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
				{COLORS.map(([label, hex]) => (
					<ColorCard hex={hex} key={label} label={label} />
				))}
			</div>
		</div>
	);
}
