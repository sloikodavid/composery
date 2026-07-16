"use client";

import type { ComponentProps } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";

export function DismissButton({
	...props
}: Omit<ComponentProps<typeof AnimatedIconButton>, "children" | "icon">) {
	return (
		<AnimatedIconButton
			{...props}
			icon="x"
			iconPosition="start"
			size="sm"
			variant="ghost"
		>
			Dismiss
		</AnimatedIconButton>
	);
}
