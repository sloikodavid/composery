import clsx from "clsx";
import Image from "next/image";
import type { CSSProperties } from "react";
import icon from "@/app/icon.svg";
import { Link } from "@/components/ui/link";
import { Wordmark, wordmarkMetrics } from "./wordmark";

const { capHeight, inkStart } = wordmarkMetrics;

const frame = (capHeight * 8) / 6;
const border = frame / 8;
const gap = capHeight / 2;

// The square is as tall as the "C", sits on the baseline, and is half its height away from the "C" ink.
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
			className={clsx("inline-block whitespace-nowrap font-brand", className)}
		>
			<Image src={icon} alt="" style={iconStyle} />
			<Wordmark />
		</Link>
	);
}
