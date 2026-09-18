import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * The look of a panel: the surface color inside a border. Name it where the panel is another library's element and
 * cannot be a `Card`, such as a floating message.
 */
export const cardSurface = "border border-border bg-surface";

/** A panel that holds content on the page background. */
export function Card({
	padding = "default",
	className,
	children,
}: {
	padding?: "default" | "none" | undefined;
	/** Do not set the surface, the border, or the padding here. The card sets them. */
	className?: string | undefined;
	children: ReactNode;
}) {
	return (
		<div
			className={clsx(cardSurface, padding === "default" && "p-8", className)}
		>
			{children}
		</div>
	);
}
