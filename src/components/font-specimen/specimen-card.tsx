import { useState } from "react";
import { DetailSections, Section } from "./detail-sections";
import type { SpecimenFont } from "./fonts";
import { SpecimenLockup } from "./specimen-lockup";
import {
	type AxisValues,
	defaultAxisValues,
	fontVariationSettings,
	resolveWeight,
	type SpecimenSettings,
} from "./specimen-settings";

type SpecimenCardProps = {
	font: SpecimenFont;
	settings: SpecimenSettings;
	shortlisted: boolean;
	onToggleShortlist: () => void;
};

const smallSizes = [32, 20, 14] as const;

function describeFont(font: SpecimenFont) {
	const min = font.weights[0];
	const max = font.weights.at(-1);
	const parts = [
		font.variable
			? `Variable ${min}–${max}`
			: font.weights.length === 1
				? `Static ${min}`
				: `Static ${font.weights.join(", ")}`,
		font.italic ? "Italic" : "No italic",
		...font.axes.map((axis) => `${axis.name} axis`),
	];
	return parts.join(" · ");
}

function ShortlistButton({
	shortlisted,
	onToggle,
}: {
	shortlisted: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={shortlisted}
			onClick={onToggle}
			className={`w-24 shrink-0 border px-2 py-1 text-xs ${
				shortlisted
					? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
					: "border-neutral-300 text-neutral-700 hover:border-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-100"
			}`}
		>
			{shortlisted ? "Shortlisted" : "Shortlist"}
		</button>
	);
}

function CardHeader({
	font,
	shortlisted,
	onToggleShortlist,
	detailed,
}: {
	font: SpecimenFont;
	shortlisted: boolean;
	onToggleShortlist: () => void;
	detailed: boolean;
}) {
	return (
		<header className="flex items-start justify-between gap-4">
			<div className="min-w-0">
				<h2 className="font-medium text-neutral-900 text-sm dark:text-neutral-100">
					{font.name}
				</h2>
				<p className="text-neutral-500 text-xs dark:text-neutral-400">
					{font.category}
					{detailed ? ` · ${describeFont(font)}` : null}
				</p>
				{detailed ? (
					<p className="mt-1 text-neutral-600 text-xs dark:text-neutral-400">
						{font.note}
					</p>
				) : null}
			</div>
			<ShortlistButton shortlisted={shortlisted} onToggle={onToggleShortlist} />
		</header>
	);
}

export function SpecimenTile({
	font,
	settings,
	shortlisted,
	onToggleShortlist,
}: SpecimenCardProps) {
	return (
		<article className="flex flex-col gap-6 border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
			<CardHeader
				font={font}
				shortlisted={shortlisted}
				onToggleShortlist={onToggleShortlist}
				detailed={false}
			/>
			<div className="overflow-hidden py-2">
				<SpecimenLockup
					font={font}
					settings={settings}
					axisValues={defaultAxisValues(font.axes)}
					size={settings.size}
				/>
			</div>
		</article>
	);
}

export function SpecimenCard({
	font,
	settings,
	shortlisted,
	onToggleShortlist,
}: SpecimenCardProps) {
	const [axisValues, setAxisValues] = useState<AxisValues>(() =>
		defaultAxisValues(font.axes),
	);
	const weight = resolveWeight(font, settings.weight);
	const textStyle = {
		fontFamily: font.fontFamily,
		fontVariationSettings: fontVariationSettings(axisValues),
	};

	return (
		<article className="flex flex-col gap-4 border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
			<CardHeader
				font={font}
				shortlisted={shortlisted}
				onToggleShortlist={onToggleShortlist}
				detailed
			/>

			{font.axes.length > 0 ? (
				<div className="flex flex-wrap gap-x-6 gap-y-2">
					{font.axes.map((axis) => (
						<label
							key={axis.tag}
							className="flex items-center gap-2 text-neutral-600 text-xs dark:text-neutral-400"
						>
							{axis.name}
							<input
								type="range"
								min={axis.min}
								max={axis.max}
								step={axis.tag === "wdth" ? 0.5 : 1}
								value={axisValues[axis.tag] ?? axis.defaultValue}
								onChange={(event) => {
									const value = Number(event.target.value);
									setAxisValues((current) => ({
										...current,
										[axis.tag]: value,
									}));
								}}
							/>
							<span className="w-10 text-neutral-900 tabular-nums dark:text-neutral-100">
								{axisValues[axis.tag] ?? axis.defaultValue}
							</span>
						</label>
					))}
				</div>
			) : null}

			<Section title="Logo">
				<div className="overflow-x-auto py-2">
					<SpecimenLockup
						font={font}
						settings={settings}
						axisValues={axisValues}
						size={settings.size}
					/>
				</div>
				<div className="flex flex-wrap items-end gap-x-10 gap-y-4">
					{smallSizes.map((size) => (
						<div key={size} className="flex flex-col gap-1">
							<SpecimenLockup
								font={font}
								settings={settings}
								axisValues={axisValues}
								size={size}
							/>
							<span className="text-[11px] text-neutral-400 dark:text-neutral-500">
								{size}px
							</span>
						</div>
					))}
				</div>
			</Section>

			<Section title="Weights">
				<ul className="flex flex-col gap-1 overflow-x-auto">
					{font.weights.map((namedWeight) => (
						<li key={namedWeight} className="flex items-baseline gap-4">
							<span className="w-8 shrink-0 text-[11px] text-neutral-400 tabular-nums dark:text-neutral-500">
								{namedWeight}
							</span>
							<SpecimenLockup
								font={font}
								settings={{ ...settings, lockup: "none" }}
								axisValues={axisValues}
								size={28}
								weight={namedWeight}
							/>
						</li>
					))}
				</ul>
			</Section>

			<Section title="Styles">
				<ul className="flex flex-col gap-1 overflow-x-auto">
					<li className="flex items-baseline gap-4">
						<span className="w-16 shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
							Italic
						</span>
						{font.italic ? (
							<SpecimenLockup
								font={font}
								settings={{ ...settings, lockup: "none" }}
								axisValues={axisValues}
								size={28}
								italic
							/>
						) : (
							<span className="text-neutral-400 text-sm dark:text-neutral-500">
								Not available
							</span>
						)}
					</li>
					<li className="flex items-baseline gap-4">
						<span className="w-16 shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
							Lowercase
						</span>
						<SpecimenLockup
							font={font}
							settings={{ ...settings, lockup: "none" }}
							axisValues={axisValues}
							size={28}
							textCase="lowercase"
						/>
					</li>
					<li className="flex items-baseline gap-4">
						<span className="w-16 shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
							Uppercase
						</span>
						<SpecimenLockup
							font={font}
							settings={{ ...settings, lockup: "none" }}
							axisValues={axisValues}
							size={28}
							textCase="uppercase"
						/>
					</li>
				</ul>
			</Section>

			<DetailSections font={font} settings={settings} axisValues={axisValues} />

			<Section title="Interface">
				<div
					className="flex flex-col gap-6 border border-neutral-200 p-5 text-neutral-900 dark:border-neutral-800 dark:text-neutral-100"
					style={textStyle}
				>
					<div className="flex items-center justify-between gap-4">
						<SpecimenLockup
							font={font}
							settings={settings}
							axisValues={axisValues}
							size={18}
						/>
						<button
							type="button"
							className="bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
							style={{ fontWeight: resolveWeight(font, 500) }}
						>
							Sign in
						</button>
					</div>
					<div className="flex flex-col gap-2">
						<p
							className="text-4xl leading-tight"
							style={{
								fontWeight: weight,
								letterSpacing: `${settings.tracking}em`,
							}}
						>
							AI-first personal compute.
						</p>
						<p
							className="max-w-prose text-base text-neutral-600 dark:text-neutral-400"
							style={{ fontWeight: resolveWeight(font, 400) }}
						>
							Create a server, deploy your apps, and share access with other
							people.
						</p>
					</div>
					<p
						className="text-neutral-600 text-sm tabular-nums dark:text-neutral-400"
						style={{ fontWeight: resolveWeight(font, 400) }}
					>
						0123456789 · 4 vCPU · 8 GB RAM · 80 GB disk · 99.9%
					</p>
					<div
						className="flex flex-wrap items-center gap-x-6 gap-y-2 border-neutral-200 border-t pt-4 text-neutral-600 text-sm dark:border-neutral-800 dark:text-neutral-400"
						style={{ fontWeight: resolveWeight(font, 400) }}
					>
						<SpecimenLockup
							font={font}
							settings={settings}
							axisValues={axisValues}
							size={14}
						/>
						<span>Privacy</span>
						<span>Terms</span>
						<span className="ml-auto">© 2026 Composery</span>
					</div>
				</div>
			</Section>
		</article>
	);
}
