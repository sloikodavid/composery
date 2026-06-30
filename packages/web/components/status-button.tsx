"use client";

import type { ComponentType, Ref } from "react";
import { useRef } from "react";
import { StatusText } from "@/components/status-text";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";

type ActionIconHandle = {
	startAnimation: () => void;
	stopAnimation: () => void;
};

export type StatusAction = {
	disabled?: boolean;
	icon: ComponentType<{ className?: string; ref?: Ref<ActionIconHandle> }>;
	iconClassName?: string;
	label: string;
	onClick: () => void;
};

export function StatusButton({
	action,
	status
}: {
	action?: StatusAction;
	status: string;
}) {
	const iconRef = useRef<ActionIconHandle>(null);

	if (!action) {
		return (
			<Button disabled variant="outline">
				<StatusText status={status} />
			</Button>
		);
	}

	return (
		<Button
			aria-label={action.label}
			className="relative"
			disabled={action.disabled}
			onBlur={() => iconRef.current?.stopAnimation()}
			onClick={action.onClick}
			onFocus={() => iconRef.current?.startAnimation()}
			onMouseEnter={() => iconRef.current?.startAnimation()}
			onMouseLeave={() => iconRef.current?.stopAnimation()}
			variant="outline"
		>
			<span className="inline-flex items-center gap-1.5 transition-opacity group-hover/button:opacity-0 group-focus-visible/button:opacity-0">
				<StatusText status={status} />
			</span>
			<span className="absolute inset-0 inline-flex items-center justify-center gap-1.5 rounded-[inherit] opacity-0 transition-opacity group-hover/button:opacity-100 group-focus-visible/button:opacity-100">
				<action.icon
					className={cn("size-4", action.iconClassName)}
					ref={iconRef}
				/>
				{action.label}
			</span>
		</Button>
	);
}
