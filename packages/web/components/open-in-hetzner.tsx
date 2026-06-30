"use client";

import type { VariantProps } from "class-variance-authority";
import type { buttonVariants } from "@/components/button";
import { OpenInDashboard } from "@/components/open-in-dashboard";
import { hetznerServersUrl, hetznerServerUrl } from "@/lib/hetzner-dashboard";

export function OpenInHetzner({
	className,
	iconOnly = false,
	label = "Open in Hetzner",
	serverId,
	size = "sm"
}: {
	className?: string;
	iconOnly?: boolean;
	label?: string;
	serverId?: number | null;
	size?: VariantProps<typeof buttonVariants>["size"];
}) {
	return (
		<OpenInDashboard
			className={className}
			href={
				serverId === undefined
					? hetznerServersUrl()
					: hetznerServerUrl(serverId)
			}
			icon="hetzner"
			iconOnly={iconOnly}
			label={label}
			size={size}
		/>
	);
}
