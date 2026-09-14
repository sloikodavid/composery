import clsx from "clsx";
import type { Route } from "next";
import NextLink from "next/link";
import type { ReactNode } from "react";

/** An internal link. Hover fades the content, which works for text, the logo, and any background. */
export function Link({
	href,
	className,
	children,
}: {
	href: Route;
	className?: string | undefined;
	children: ReactNode;
}) {
	return (
		<NextLink
			href={href}
			className={clsx("transition-opacity hover:opacity-80", className)}
		>
			{children}
		</NextLink>
	);
}
