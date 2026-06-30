"use client";

import type { VariantProps } from "class-variance-authority";
import type { buttonVariants } from "@/components/button";
import { OpenInDashboard } from "@/components/open-in-dashboard";
import { convexFilterUrl, convexTableUrl } from "@/lib/convex-dashboard";

export function OpenInConvex({
	className,
	field,
	iconOnly = false,
	label = "Open in Convex",
	size = "sm",
	table,
	value
}: {
	className?: string;
	field?: string;
	iconOnly?: boolean;
	label?: string;
	size?: VariantProps<typeof buttonVariants>["size"];
	table: string;
	value?: string;
}) {
	return (
		<OpenInDashboard
			className={className}
			href={
				value ? convexFilterUrl(table, value, field) : convexTableUrl(table)
			}
			icon="convex"
			iconOnly={iconOnly}
			label={label}
			size={size}
		/>
	);
}
