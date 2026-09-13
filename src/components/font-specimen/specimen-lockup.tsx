import Image from "next/image";
import type { CSSProperties } from "react";
import icon from "@/app/icon.svg";
import type { SpecimenFont } from "./fonts";
import {
	type AxisValues,
	fontVariationSettings,
	resolveWeight,
	type SpecimenSettings,
} from "./specimen-settings";

type SpecimenLockupProps = {
	font: SpecimenFont;
	settings: SpecimenSettings;
	axisValues: AxisValues;
	size: number;
	weight?: number;
	italic?: boolean;
	textCase?: SpecimenSettings["textCase"];
};

export function SpecimenLockup({
	font,
	settings,
	axisValues,
	size,
	weight = settings.weight,
	italic = settings.italic,
	textCase = settings.textCase,
}: SpecimenLockupProps) {
	const unit = settings.iconScale;
	// The square fills 6/8 of the icon frame. The 1/8 border on each side is
	// removed with negative margins, so the visible square sets the alignment.
	const frame = `calc(1${unit} * 4 / 3)`;
	const border = `calc(1${unit} / 6)`;
	const gap = `calc(${settings.gap}em - ${border})`;
	const negativeBorder = `calc(-1${unit} / 6)`;

	const iconStyle: CSSProperties =
		settings.lockup === "above"
			? {
					display: "block",
					width: frame,
					height: frame,
					marginInlineStart: negativeBorder,
					marginBlockStart: negativeBorder,
					marginBlockEnd: gap,
				}
			: {
					display: "inline-block",
					width: frame,
					height: frame,
					verticalAlign: negativeBorder,
					marginInlineStart: settings.lockup === "left" ? negativeBorder : gap,
					marginInlineEnd: settings.lockup === "left" ? gap : negativeBorder,
				};

	const iconElement =
		settings.lockup === "none" ? null : (
			<Image src={icon} alt="" style={iconStyle} />
		);

	return (
		<span
			className={
				settings.lockup === "above"
					? "inline-flex flex-col items-start"
					: "inline-block whitespace-nowrap"
			}
			style={{
				fontFamily: font.fontFamily,
				fontSize: `${size}px`,
				fontWeight: resolveWeight(font, weight),
				fontStyle: italic && font.italic ? "italic" : "normal",
				fontVariationSettings: fontVariationSettings(axisValues),
				textTransform: textCase,
				lineHeight: 1.1,
			}}
		>
			{settings.lockup === "right" ? null : iconElement}
			{/* Letter spacing also follows the last letter, so the end margin removes it. */}
			<span
				style={{
					letterSpacing: `${settings.tracking}em`,
					marginInlineEnd: `${-settings.tracking}em`,
				}}
			>
				{settings.text}
			</span>
			{settings.lockup === "right" ? iconElement : null}
		</span>
	);
}
