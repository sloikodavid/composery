"use client";

import { AnimatedIconButton } from "@/components/animated-icon";
import { BrandIcon } from "@/components/brand-icon";
import { LogoLockup } from "@/components/logo";
import {
	BRAND_ASSETS,
	type BrandAssetScheme,
	type BrandAssetType,
	copySvg,
	downloadPng,
	downloadSvg
} from "@/lib/brand-assets";

const SCHEMES: BrandAssetScheme[] = ["light", "dark"];
const TYPES: { label: string; type: BrandAssetType }[] = [
	{ label: "Logo", type: "logo" },
	{ label: "Icon", type: "icon" }
];

function Tile({
	label,
	scheme,
	type
}: {
	label: string;
	scheme: BrandAssetScheme;
	type: BrandAssetType;
}) {
	const set = BRAND_ASSETS[scheme];
	const asset = set[type];
	const name = `composery-${type}-${scheme}`;
	const board = `repeating-conic-gradient(${set.checker} 0% 25%, ${set.background} 0% 50%) 0 / 20px 20px`;

	return (
		<div className="space-y-2.5">
			<p className="text-xs text-muted-foreground">
				{label} for {scheme} backgrounds
			</p>
			<div
				className="flex min-h-40 items-center justify-center rounded-2xl border border-border p-8"
				style={{ background: board, color: set.color }}
			>
				{type === "logo" ? (
					<LogoLockup className="h-12 max-w-full w-auto" />
				) : (
					<BrandIcon className="size-20" />
				)}
			</div>
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
					onClick={() => downloadPng(asset, type === "icon" ? 4 : 12, name)}
					size="sm"
					variant="outline"
				>
					Download PNG
				</AnimatedIconButton>
			</div>
		</div>
	);
}

export function BrandKit() {
	return (
		<div className="space-y-8">
			<p className="max-w-2xl text-sm leading-6 text-muted-foreground">
				Each file has a transparent background. Choose the version made for the
				background where it will appear.
			</p>
			{TYPES.map(({ label, type }) => (
				<section className="space-y-3" key={type}>
					<h2 className="text-sm font-medium text-foreground">{label}</h2>
					<div className="grid gap-5 sm:grid-cols-2">
						{SCHEMES.map((scheme) => (
							<Tile key={scheme} label={label} scheme={scheme} type={type} />
						))}
					</div>
				</section>
			))}
		</div>
	);
}
