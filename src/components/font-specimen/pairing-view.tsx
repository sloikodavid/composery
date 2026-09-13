import { type CSSProperties, useEffect, useState } from "react";
import type { SpecimenFont } from "./fonts";
import { PairingContext, type PairingStyles } from "./pairing-context";
import { PairingScreens } from "./pairing-screens";
import { CheckboxField, RangeField, SelectField } from "./specimen-fields";
import { resolveWeight, type SpecimenSettings } from "./specimen-settings";
import { tones } from "./specimen-tones";

export type PairingSettings = {
	displayFont: string;
	textFont: string;
	displayWeight: number;
	displayTracking: number;
	bodyWeight: number;
	headingWeight: number;
	headingTracking: number;
	headingFont: "display" | "text";
	matchXHeight: boolean;
	uppercaseLabels: boolean;
};

export const defaultPairingSettings: PairingSettings = {
	displayFont: "Chakra Petch",
	textFont: "Onest",
	displayWeight: 500,
	displayTracking: -0.025,
	bodyWeight: 400,
	headingWeight: 600,
	headingTracking: -0.02,
	headingFont: "text",
	matchXHeight: true,
	uppercaseLabels: true,
};

const headingFontOptions = [
	{ value: "text", label: "Text font" },
	{ value: "display", label: "Display font" },
] as const;

type Measurement = { fontFamily: string; ratio: number | null };

/** Measures the x-height of a font as a fraction of its font size. */
function useXHeightRatio(fontFamily: string) {
	const [measurement, setMeasurement] = useState<Measurement | null>(null);

	useEffect(() => {
		let cancelled = false;
		const font = `400 100px ${fontFamily}`;
		document.fonts
			.load(font)
			.then(() => {
				const context = document.createElement("canvas").getContext("2d");
				if (cancelled || !context) {
					return;
				}
				context.font = font;
				const ratio = context.measureText("x").actualBoundingBoxAscent / 100;
				setMeasurement({ fontFamily, ratio: ratio > 0 ? ratio : null });
			})
			.catch((error: unknown) => {
				console.error(`Could not load ${fontFamily} to measure it.`, error);
				if (!cancelled) {
					setMeasurement({ fontFamily, ratio: null });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [fontFamily]);

	if (measurement?.fontFamily !== fontFamily) {
		return { status: "measuring" } as const;
	}
	return measurement.ratio === null
		? ({ status: "failed" } as const)
		: ({ status: "measured", ratio: measurement.ratio } as const);
}

function describeRatio(result: ReturnType<typeof useXHeightRatio>) {
	switch (result.status) {
		case "measuring":
			return "measuring";
		case "failed":
			return "not measured";
		case "measured":
			return result.ratio.toFixed(3);
	}
}

function weightDisplay(font: SpecimenFont, weight: number) {
	const resolved = resolveWeight(font, weight);
	return resolved === weight ? String(weight) : `${weight} → ${resolved}`;
}

type PairingViewProps = {
	fonts: readonly SpecimenFont[];
	pairing: PairingSettings;
	onPairingChange: (pairing: PairingSettings) => void;
	settings: SpecimenSettings;
};

export function PairingView({
	fonts,
	pairing,
	onPairingChange,
	settings,
}: PairingViewProps) {
	const displayFont =
		fonts.find((font) => font.name === pairing.displayFont) ?? fonts[0];
	const textFont =
		fonts.find((font) => font.name === pairing.textFont) ?? fonts[0];
	const displayRatio = useXHeightRatio(displayFont?.fontFamily ?? "");
	const textRatio = useXHeightRatio(textFont?.fontFamily ?? "");

	if (!displayFont || !textFont) {
		return null;
	}

	function update<Key extends keyof PairingSettings>(
		key: Key,
		value: PairingSettings[Key],
	) {
		onPairingChange({ ...pairing, [key]: value });
	}

	const fontOptions = fonts.map((font) => ({
		value: font.name,
		label: font.name,
	}));

	// font-size-adjust gives the display font the x-height of the text font.
	const sizeAdjust: CSSProperties =
		pairing.matchXHeight && textRatio.status === "measured"
			? { fontSizeAdjust: String(textRatio.ratio) }
			: {};

	const display: CSSProperties = {
		fontFamily: displayFont.fontFamily,
		fontWeight: resolveWeight(displayFont, pairing.displayWeight),
		letterSpacing: `${pairing.displayTracking}em`,
		...sizeAdjust,
	};
	const label: CSSProperties = pairing.uppercaseLabels
		? { ...display, textTransform: "uppercase", letterSpacing: "0.06em" }
		: display;
	const headingFont =
		pairing.headingFont === "display" ? displayFont : textFont;
	const heading: CSSProperties = {
		fontFamily: headingFont.fontFamily,
		fontWeight: resolveWeight(headingFont, pairing.headingWeight),
		letterSpacing: `${pairing.headingTracking}em`,
		...(pairing.headingFont === "display" ? sizeAdjust : {}),
	};
	const body: CSSProperties = {
		fontFamily: textFont.fontFamily,
		fontWeight: resolveWeight(textFont, pairing.bodyWeight),
	};
	const strong: CSSProperties = {
		...body,
		fontWeight: resolveWeight(textFont, pairing.bodyWeight + 100),
	};

	const styles: PairingStyles = {
		display,
		label,
		heading,
		body,
		strong,
		displayFont,
		textFont,
		headingFont,
		logoSettings: {
			...settings,
			weight: pairing.displayWeight,
			tracking: pairing.displayTracking,
			italic: false,
		},
	};

	return (
		<div className="flex flex-col gap-6">
			<div
				className={`flex flex-wrap items-end gap-x-6 gap-y-3 border p-4 ${tones.border} ${tones.surface}`}
			>
				<SelectField
					label="Display font"
					value={pairing.displayFont}
					options={fontOptions}
					onChange={(value) => update("displayFont", value)}
				/>
				<RangeField
					label="Display weight"
					value={pairing.displayWeight}
					display={weightDisplay(displayFont, pairing.displayWeight)}
					min={100}
					max={900}
					step={50}
					onChange={(value) => update("displayWeight", value)}
				/>
				<RangeField
					label="Display tracking"
					value={pairing.displayTracking}
					display={`${pairing.displayTracking.toFixed(3)}em`}
					min={-0.06}
					max={0.04}
					step={0.005}
					onChange={(value) => update("displayTracking", value)}
				/>
				<SelectField
					label="Text font"
					value={pairing.textFont}
					options={fontOptions}
					onChange={(value) => update("textFont", value)}
				/>
				<RangeField
					label="Body weight"
					value={pairing.bodyWeight}
					display={weightDisplay(textFont, pairing.bodyWeight)}
					min={100}
					max={900}
					step={50}
					onChange={(value) => update("bodyWeight", value)}
				/>
				<SelectField
					label="Headings use"
					value={pairing.headingFont}
					options={headingFontOptions}
					onChange={(value) => update("headingFont", value)}
				/>
				<RangeField
					label="Heading weight"
					value={pairing.headingWeight}
					display={weightDisplay(headingFont, pairing.headingWeight)}
					min={100}
					max={900}
					step={50}
					onChange={(value) => update("headingWeight", value)}
				/>
				<RangeField
					label="Heading tracking"
					value={pairing.headingTracking}
					display={`${pairing.headingTracking.toFixed(3)}em`}
					min={-0.06}
					max={0.04}
					step={0.005}
					onChange={(value) => update("headingTracking", value)}
				/>
				<CheckboxField
					label="Labels"
					text="Uppercase"
					checked={pairing.uppercaseLabels}
					onChange={(value) => update("uppercaseLabels", value)}
				/>
				<CheckboxField
					label="Size"
					text="Match x-height"
					checked={pairing.matchXHeight}
					onChange={(value) => update("matchXHeight", value)}
				/>
				<button
					type="button"
					onClick={() => onPairingChange(defaultPairingSettings)}
					className={`h-7 border px-3 text-xs ${tones.strongBorder} ${tones.text}`}
				>
					Reset pairing
				</button>
				<p className={`basis-full text-xs tabular-nums ${tones.faint}`}>
					x-height: {displayFont.name} {describeRatio(displayRatio)} ·{" "}
					{textFont.name} {describeRatio(textRatio)}. With “Match x-height”, the
					display font is scaled so its lowercase letters are as tall as the
					text font’s. The logo uses the display weight and tracking and is
					never scaled. The toolbar above still sets the logo layout and icon.
				</p>
			</div>

			<PairingContext value={styles}>
				<PairingScreens />
			</PairingContext>
		</div>
	);
}
