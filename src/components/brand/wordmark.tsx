import clsx from "clsx";
import type { CSSProperties } from "react";

/** Measured Chakra Petch geometry used to align the logo with the wordmark. */
export const wordmarkMetrics = {
	ascent: 0.992,
	descent: 0.308,
	capHeight: 0.703_125,
	descender: 0.218_75,
	inkStart: 0.0625,
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
				// Remove tracking after the final glyph.
				"font-wordmark tracking-display [margin-inline-end:calc(-1*var(--tracking-display))]",
				className,
			)}
			style={style}
		>
			Composery
		</span>
	);
}
