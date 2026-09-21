import clsx from "clsx";
import Image from "next/image";
import type { CSSProperties } from "react";
import icon from "@/app/icon.svg";
import { Link } from "@/components/ui/link";
import { Wordmark, wordmarkMetrics } from "./wordmark";

const { capHeight, inkStart } = wordmarkMetrics;

const gap = capHeight / 2;

// Matches the wordmark's cap height exactly, so it lines up with the "C".
const iconStyle: CSSProperties = {
	display: "inline-block",
	width: `${capHeight}em`,
	height: `${capHeight}em`,
	// Tailwind's preflight sets img { vertical-align: middle }; pin it to the baseline instead.
	verticalAlign: "baseline",
	marginInlineEnd: `${gap - inkStart}em`,
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
