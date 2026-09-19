import clsx from "clsx";
import Image from "next/image";
import type { CSSProperties } from "react";
import icon from "@/app/icon.svg";
import { Link } from "@/components/ui/link";
import { Wordmark, wordmarkMetrics } from "./wordmark";

const { capHeight, inkStart } = wordmarkMetrics;

// Scale the 8-unit icon to the wordmark's measured cap height.
const iconUnits = 8;
const squareUnits = 6;

const frame = (capHeight * iconUnits) / squareUnits;
const border = frame / iconUnits;
const gap = capHeight / 2;

// The icon sits on the baseline with a half-cap-height gap.
const iconStyle: CSSProperties = {
	display: "inline-block",
	width: `${frame}em`,
	height: `${frame}em`,
	verticalAlign: `${-border}em`,
	marginInlineStart: `${-border}em`,
	marginInlineEnd: `${gap - border - inkStart}em`,
};

export function Logo({ className }: { className?: string | undefined }) {
	return (
		<Link
			href="/"
			className={clsx(
				"inline-block whitespace-nowrap font-wordmark",
				className,
			)}
		>
			<Image src={icon} alt="" style={iconStyle} />
			<Wordmark />
		</Link>
	);
}
