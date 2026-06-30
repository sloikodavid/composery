"use client";

import type { VariantProps } from "class-variance-authority";
import type { buttonVariants } from "@/components/button";
import { OpenInDashboard } from "@/components/open-in-dashboard";
import { vercelDashboardUrl, type VercelView } from "@/lib/vercel-dashboard";

export function OpenInVercel({
	className,
	iconOnly = false,
	label = "Open in Vercel",
	size = "sm",
	view = "analytics"
}: {
	className?: string;
	iconOnly?: boolean;
	label?: string;
	size?: VariantProps<typeof buttonVariants>["size"];
	view?: VercelView;
}) {
	return (
		<OpenInDashboard
			className={className}
			href={vercelDashboardUrl(view)}
			icon="vercel"
			iconOnly={iconOnly}
			label={label}
			size={size}
		/>
	);
}
