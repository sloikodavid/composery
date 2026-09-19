import clsx from "clsx";
import type { Route } from "next";
import NextLink from "next/link";
import type { ReactNode } from "react";

export const linkClassName = "transition-opacity hover:opacity-80";

export function Link({
	href,
	font = "body",
	className,
	children,
}: {
	href: Route;
	font?: "body" | "brand" | undefined;
	className?: string | undefined;
	children: ReactNode;
}) {
	return (
		<NextLink
			href={href}
			className={clsx(
				linkClassName,
				font === "brand" && "font-brand",
				className,
			)}
		>
			{children}
		</NextLink>
	);
}
