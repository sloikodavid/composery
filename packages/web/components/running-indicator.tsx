"use client";

import { useEffect, useRef } from "react";
import {
	WashingMachineIcon,
	type WashingMachineIconHandle
} from "@/components/icons/washing-machine";
import { cn } from "@/lib/utils";

// The "running" status chip's spinning drum. Unlike the hover-driven button
// icons, this one starts its (already infinite) animation on mount and keeps
// tumbling, so a running box always reads as live.
export function RunningIndicator({ className }: { className?: string }) {
	const ref = useRef<WashingMachineIconHandle>(null);

	useEffect(() => {
		ref.current?.startAnimation();
	}, []);

	return (
		<WashingMachineIcon
			className={cn("size-3.5 text-success", className)}
			ref={ref}
		/>
	);
}
