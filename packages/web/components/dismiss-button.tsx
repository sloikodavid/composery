"use client";

import type { ComponentProps } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";

export function DismissButton({
	children = "Dismiss",
	...props
}: Omit<ComponentProps<typeof AnimatedIconButton>, "icon">) {
	return (
		<AnimatedIconButton
			{...props}
			icon="x"
			iconPosition="start"
			size="sm"
			variant="ghost"
		>
			{children}
		</AnimatedIconButton>
	);
}
