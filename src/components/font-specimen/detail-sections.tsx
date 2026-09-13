import type { CSSProperties, ReactNode } from "react";
import type { SpecimenFont } from "./fonts";
import {
	characterRows,
	kerningRows,
	legibilityRows,
	numberRows,
	sampleParagraph,
	shortParagraph,
} from "./sample-text";
import {
	type AxisValues,
	fontVariationSettings,
	resolveWeight,
	type SpecimenSettings,
} from "./specimen-settings";
import { tones } from "./specimen-tones";

export function Section({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className={`flex flex-col gap-3 border-t pt-4 ${tones.border}`}>
			<h3 className={`text-xs uppercase tracking-wide ${tones.muted}`}>
				{title}
			</h3>
			{children}
		</section>
	);
}

function Caption({ children }: { children: ReactNode }) {
	return (
		<span className={`w-20 shrink-0 text-[11px] ${tones.faint}`}>
			{children}
		</span>
	);
}

type DetailSectionsProps = {
	font: SpecimenFont;
	settings: SpecimenSettings;
	axisValues: AxisValues;
};

export function DetailSections({
	font,
	settings,
	axisValues,
}: DetailSectionsProps) {
	const base: CSSProperties = {
		fontFamily: font.fontFamily,
		fontVariationSettings: fontVariationSettings(axisValues),
	};
	const regular: CSSProperties = {
		...base,
		fontWeight: resolveWeight(font, 400),
	};
	const buttonWeights = [
		...new Set([400, 500, 600].map((weight) => resolveWeight(font, weight))),
	];

	return (
		<>
			<Section title="Characters">
				<div
					className={`flex flex-col gap-1 overflow-x-auto text-2xl ${tones.text}`}
					style={{ ...base, fontWeight: resolveWeight(font, settings.weight) }}
				>
					{characterRows.map((row) => (
						<p key={row} className="whitespace-nowrap">
							{row}
						</p>
					))}
				</div>
			</Section>

			<Section title="Legibility and spacing">
				<ul className="flex flex-col gap-2 overflow-x-auto">
					{[...legibilityRows, ...kerningRows].map((row) => (
						<li key={row} className="flex items-baseline gap-4">
							<Caption>
								{legibilityRows.some((item) => item === row)
									? "Similar shapes"
									: "Letter pairs"}
							</Caption>
							<span
								className={`whitespace-nowrap text-xl ${tones.text}`}
								style={regular}
							>
								{row}
							</span>
						</li>
					))}
				</ul>
			</Section>

			<Section title="Numbers">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2" style={regular}>
					{(["tabular-nums", "proportional-nums"] as const).map((variant) => (
						<div key={variant} className="flex flex-col gap-1">
							<Caption>
								{variant === "tabular-nums" ? "Tabular" : "Proportional"}
							</Caption>
							<table className={`w-full text-sm ${tones.text}`}>
								<tbody>
									{numberRows.map(([name, value]) => (
										<tr key={name} className={`border-b ${tones.border}`}>
											<td className="py-1">{name}</td>
											<td className={`py-1 text-right ${variant}`}>{value}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					))}
				</div>
				<p className={`text-xs ${tones.faint}`}>
					If both columns look the same, the font has only one number style.
				</p>
			</Section>

			<Section title="Paragraphs">
				<div className="flex flex-col gap-4" style={regular}>
					{([16, 14, 12] as const).map((size) => (
						<div key={size} className="flex items-baseline gap-4">
							<Caption>{size}px</Caption>
							<p
								className={`max-w-prose ${tones.muted}`}
								style={{ fontSize: `${size}px`, lineHeight: 1.55 }}
							>
								{size === 12 ? shortParagraph : sampleParagraph}
							</p>
						</div>
					))}
				</div>
			</Section>

			<Section title="Buttons">
				<div className="flex flex-col gap-3">
					{buttonWeights.map((weight) => (
						<div key={weight} className="flex flex-wrap items-center gap-3">
							<Caption>Weight {weight}</Caption>
							<span
								className={`inline-flex h-9 items-center px-4 text-sm ${tones.inverse}`}
								style={{
									...base,
									fontWeight: weight,
									letterSpacing: `${settings.tracking}em`,
								}}
							>
								Create server
							</span>
							<span
								className={`inline-flex h-9 items-center border px-4 text-sm ${tones.strongBorder} ${tones.text}`}
								style={{
									...base,
									fontWeight: weight,
									letterSpacing: `${settings.tracking}em`,
								}}
							>
								Connect assistant
							</span>
							<span
								className={`inline-flex h-9 items-center px-4 text-xs uppercase ${tones.sunken} ${tones.text}`}
								style={{ ...base, fontWeight: weight, letterSpacing: "0.06em" }}
							>
								Deploy
							</span>
						</div>
					))}
				</div>
			</Section>
		</>
	);
}
