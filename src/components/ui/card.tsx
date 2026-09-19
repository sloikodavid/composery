import clsx from "clsx";
import type { ReactNode } from "react";

export const surfaceClassName = "bg-surface shadow-none";
export const panelClassName = "rounded-panel";
export const cardSurface = `border border-border ${panelClassName} ${surfaceClassName}`;
export const menuSurfaceClassName = `border border-border rounded-menu ${surfaceClassName}`;

export function Card({
	padding = "default",
	className,
	children,
}: {
	padding?: "default" | "none" | undefined;
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
