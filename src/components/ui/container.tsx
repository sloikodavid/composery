import clsx from "clsx";
import type { ReactNode } from "react";

const widths = {
	wide: "max-w-6xl",
	narrow: "max-w-2xl",
} as const;

export function Container({
	width = "wide",
	className,
	children,
}: {
	width?: keyof typeof widths | undefined;
	/** Do not set width or horizontal padding here. The container sets them. */
	className?: string | undefined;
	children: ReactNode;
}) {
	return (
		<div className={clsx("mx-auto w-full px-6", widths[width], className)}>
			{children}
		</div>
	);
}
