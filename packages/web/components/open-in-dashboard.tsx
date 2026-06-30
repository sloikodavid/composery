"use client";

import type { VariantProps } from "class-variance-authority";
import { AnimatedIconAnchor } from "@/components/animated-icon";
import type { AnimatedIconName } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";
import { cn } from "@/lib/utils";

// The shared shell behind every Open-in-<provider> button. Each provider wrapper
// just resolves an href and picks its icon/label; the icon-only vs labelled split
// lives here so it can't drift between providers.
export function OpenInDashboard({
	className,
	href,
	icon,
	iconOnly = false,
	label,
	size = "sm"
}: {
	className?: string;
	href: string | null;
	icon: AnimatedIconName;
	iconOnly?: boolean;
	label: string;
	size?: VariantProps<typeof buttonVariants>["size"];
}) {
	if (!href) return null;

	if (iconOnly) {
		return (
			<AnimatedIconAnchor
				aria-label={label}
				className={cn(
					buttonVariants({ size: "icon-sm", variant: "ghost" }),
					className
				)}
				href={href}
				icon={icon}
				iconPosition="only"
				rel="noreferrer"
				target="_blank"
			/>
		);
	}

	return (
		<AnimatedIconAnchor
			className={cn(buttonVariants({ size, variant: "outline" }), className)}
			href={href}
			icon={icon}
			iconPosition="start"
			rel="noreferrer"
			target="_blank"
		>
			{label}
		</AnimatedIconAnchor>
	);
}
