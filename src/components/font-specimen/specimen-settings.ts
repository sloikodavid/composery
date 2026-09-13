import type { SpecimenAxis, SpecimenFont } from "./fonts";

export const textCases = [
	{ value: "none", label: "As typed" },
	{ value: "lowercase", label: "lowercase" },
	{ value: "uppercase", label: "UPPERCASE" },
] as const;

export const lockupLayouts = [
	{ value: "left", label: "Icon left" },
	{ value: "right", label: "Icon right" },
	{ value: "above", label: "Icon above" },
	{ value: "none", label: "Wordmark only" },
] as const;

export const iconScales = [
	{ value: "cap", label: "Cap height" },
	{ value: "ex", label: "x-height" },
] as const;

export type TextCase = (typeof textCases)[number]["value"];
export type LockupLayout = (typeof lockupLayouts)[number]["value"];
export type IconScale = (typeof iconScales)[number]["value"];

export type SpecimenSettings = {
	text: string;
	weight: number;
	italic: boolean;
	textCase: TextCase;
	/** Letter spacing in em. */
	tracking: number;
	/** Font size in px. */
	size: number;
	lockup: LockupLayout;
	iconScale: IconScale;
	/** Space between the icon and the wordmark in em. */
	gap: number;
};

export const defaultSettings: SpecimenSettings = {
	text: "Composery",
	weight: 600,
	italic: false,
	textCase: "none",
	tracking: -0.02,
	size: 56,
	lockup: "left",
	iconScale: "cap",
	gap: 0.3,
};

/** Returns the nearest weight that the font can show without synthesis. */
export function resolveWeight(font: SpecimenFont, weight: number) {
	const min = font.weights[0] ?? 400;
	const max = font.weights.at(-1) ?? 400;
	if (font.variable) {
		return Math.min(max, Math.max(min, weight));
	}
	let nearest = min;
	for (const candidate of font.weights) {
		if (Math.abs(candidate - weight) < Math.abs(nearest - weight)) {
			nearest = candidate;
		}
	}
	return nearest;
}

export type AxisValues = Readonly<Record<string, number>>;

export function defaultAxisValues(axes: readonly SpecimenAxis[]): AxisValues {
	return Object.fromEntries(axes.map((axis) => [axis.tag, axis.defaultValue]));
}

export function fontVariationSettings(axisValues: AxisValues) {
	const entries = Object.entries(axisValues);
	if (entries.length === 0) {
		return undefined;
	}
	return entries.map(([tag, value]) => `"${tag}" ${value}`).join(", ");
}
