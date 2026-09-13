"use client";

import { useState } from "react";
import { type FontCategory, fontCategories, type SpecimenFont } from "./fonts";
import {
	defaultPairingSettings,
	type PairingSettings,
	PairingView,
} from "./pairing-view";
import { ReadingView } from "./reading-view";
import { SpecimenCard, SpecimenTile } from "./specimen-card";
import {
	CheckboxField,
	Field,
	RangeField,
	SelectField,
} from "./specimen-fields";
import {
	defaultSettings,
	iconScales,
	lockupLayouts,
	type SpecimenSettings,
	textCases,
} from "./specimen-settings";
import { tones } from "./specimen-tones";

type View = "overview" | "detail" | "reading" | "pairing";

const viewOptions = [
	{ value: "overview", label: "Overview" },
	{ value: "detail", label: "Detail" },
	{ value: "reading", label: "Reading" },
	{ value: "pairing", label: "Pairing" },
] as const satisfies readonly { value: View; label: string }[];

const categoryOptions: readonly {
	value: FontCategory | "all";
	label: string;
}[] = [
	{ value: "all", label: "All categories" },
	...fontCategories.map((category) => ({
		value: category,
		label: category,
	})),
];

export function FontSpecimen({ fonts }: { fonts: readonly SpecimenFont[] }) {
	const [settings, setSettings] = useState<SpecimenSettings>(defaultSettings);
	const [pairing, setPairing] = useState<PairingSettings>(
		defaultPairingSettings,
	);
	const [view, setView] = useState<View>("overview");
	const [category, setCategory] = useState<FontCategory | "all">("all");
	const [shortlist, setShortlist] = useState<ReadonlySet<string>>(new Set());
	const [shortlistOnly, setShortlistOnly] = useState(false);

	function update<Key extends keyof SpecimenSettings>(
		key: Key,
		value: SpecimenSettings[Key],
	) {
		setSettings((current) => ({ ...current, [key]: value }));
	}

	function toggleShortlist(name: string) {
		setShortlist((current) => {
			const next = new Set(current);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			return next;
		});
	}

	const visibleFonts = fonts.filter(
		(font) =>
			(category === "all" || font.category === category) &&
			(!shortlistOnly || shortlist.has(font.name)),
	);
	const filtersApply = view !== "pairing";

	function renderFonts() {
		if (visibleFonts.length === 0) {
			return (
				<p
					className={`border border-dashed p-10 text-center text-sm ${tones.strongBorder} ${tones.muted}`}
				>
					No fonts match the filters.
				</p>
			);
		}
		switch (view) {
			case "overview":
				return (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))] gap-4">
						{visibleFonts.map((font) => (
							<SpecimenTile
								key={font.name}
								font={font}
								settings={settings}
								shortlisted={shortlist.has(font.name)}
								onToggleShortlist={() => toggleShortlist(font.name)}
							/>
						))}
					</div>
				);
			case "detail":
				return (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,40rem),1fr))] gap-4">
						{visibleFonts.map((font) => (
							<SpecimenCard
								key={font.name}
								font={font}
								settings={settings}
								shortlisted={shortlist.has(font.name)}
								onToggleShortlist={() => toggleShortlist(font.name)}
							/>
						))}
					</div>
				);
			case "reading":
				return <ReadingView fonts={visibleFonts} />;
			case "pairing":
				return null;
		}
	}

	return (
		<div
			className={`min-h-screen font-sans [font-synthesis:none] ${tones.page} ${tones.text}`}
		>
			<div
				className={`sticky top-0 z-10 border-b backdrop-blur ${tones.border} bg-white/95 dark:bg-neutral-900/95`}
			>
				<div className="mx-auto flex max-w-screen-2xl flex-wrap items-end gap-x-6 gap-y-3 px-6 py-4">
					<SelectField
						label="View"
						value={view}
						options={viewOptions}
						onChange={setView}
					/>
					<Field label="Text">
						<input
							type="text"
							value={settings.text}
							maxLength={40}
							onChange={(event) => update("text", event.target.value)}
							className={`w-36 border px-2 py-1 ${tones.strongBorder} ${tones.surface} ${tones.text}`}
						/>
					</Field>
					<RangeField
						label="Weight"
						value={settings.weight}
						display={String(settings.weight)}
						min={100}
						max={900}
						step={100}
						onChange={(value) => update("weight", value)}
					/>
					<RangeField
						label="Size"
						value={settings.size}
						display={`${settings.size}px`}
						min={16}
						max={120}
						step={1}
						onChange={(value) => update("size", value)}
					/>
					<RangeField
						label="Tracking"
						value={settings.tracking}
						display={`${settings.tracking.toFixed(3)}em`}
						min={-0.08}
						max={0.08}
						step={0.005}
						onChange={(value) => update("tracking", value)}
					/>
					<SelectField
						label="Case"
						value={settings.textCase}
						options={textCases}
						onChange={(value) => update("textCase", value)}
					/>
					<CheckboxField
						label="Style"
						text="Italic"
						checked={settings.italic}
						onChange={(value) => update("italic", value)}
					/>
					<SelectField
						label="Lockup"
						value={settings.lockup}
						options={lockupLayouts}
						onChange={(value) => update("lockup", value)}
					/>
					<SelectField
						label="Icon size"
						value={settings.iconScale}
						options={iconScales}
						onChange={(value) => update("iconScale", value)}
					/>
					<RangeField
						label="Icon gap"
						value={settings.gap}
						display={`${settings.gap.toFixed(2)}em`}
						min={0.1}
						max={0.8}
						step={0.05}
						onChange={(value) => update("gap", value)}
					/>
					{filtersApply ? (
						<>
							<SelectField
								label="Category"
								value={category}
								options={categoryOptions}
								onChange={setCategory}
							/>
							<CheckboxField
								label={`Shortlist (${shortlist.size})`}
								text="Only shortlisted"
								checked={shortlistOnly}
								onChange={setShortlistOnly}
							/>
						</>
					) : null}
					<button
						type="button"
						onClick={() => setSettings(defaultSettings)}
						className={`h-7 border px-3 text-xs ${tones.strongBorder} ${tones.text}`}
					>
						Reset
					</button>
				</div>
			</div>

			<main className="mx-auto max-w-screen-2xl px-6 py-8">
				{filtersApply ? (
					<>
						<p className={`mb-6 text-sm ${tones.muted}`}>
							{visibleFonts.length} of {fonts.length} fonts. The weight moves to
							the nearest weight that each font has. The shortlist resets when
							the page reloads.
						</p>
						{renderFonts()}
					</>
				) : (
					<PairingView
						fonts={fonts}
						pairing={pairing}
						onPairingChange={setPairing}
						settings={settings}
					/>
				)}
			</main>
		</div>
	);
}
