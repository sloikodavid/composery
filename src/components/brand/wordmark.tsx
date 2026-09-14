import clsx from "clsx";
import type { CSSProperties } from "react";

/** Chakra Petch glyph measurements for "Composery", in em. */
export const wordmarkMetrics = {
	/** Top of the font's line box, above the baseline. */
	ascent: 0.992,
	/** Bottom of the font's line box, below the baseline. */
	descent: 0.308,
	/** Top of the "C", above the baseline. */
	capHeight: 0.703125,
	/** Bottom of the "p" and "y", below the baseline. */
	descender: 0.21875,
	/** Space before the ink of the "C". */
	inkStart: 0.0625,
	/** Width of the ink, with the display letter spacing. */
	inkWidth: 5.119125,
} as const;

export function Wordmark({
	className,
	style,
}: {
	className?: string | undefined;
	style?: CSSProperties | undefined;
}) {
	return (
		<span
			className={clsx(
				// The negative end margin removes the letter spacing after the last letter.
				"font-brand tracking-display [margin-inline-end:calc(-1*var(--tracking-display))]",
				className,
			)}
			style={style}
		>
			Composery
		</span>
	);
}
