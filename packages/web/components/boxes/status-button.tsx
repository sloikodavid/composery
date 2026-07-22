"use client";

import {
	AnimatedIcon,
	type AnimatedIconName,
	useAnimatedIconHandlers
} from "@/components/animated-icon";
import { StatusText } from "@/components/boxes/status-text";
import { Button } from "@/components/base/button";

type StatusAction = {
	disabled?: boolean;
	icon: AnimatedIconName;
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
	const { handlers, iconRef } = useAnimatedIconHandlers<HTMLButtonElement>({});

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
			onClick={action.onClick}
			variant="outline"
			{...handlers}
		>
			<span className="inline-flex items-center gap-1.5 transition-opacity group-hover/button:opacity-0 group-focus-visible/button:opacity-0">
				<StatusText status={status} />
			</span>
			<span className="absolute inset-0 inline-flex items-center justify-center gap-1.5 rounded-[inherit] opacity-0 transition-opacity group-hover/button:opacity-100 group-focus-visible/button:opacity-100">
				<AnimatedIcon
					className={action.iconClassName}
					icon={action.icon}
					iconRef={iconRef}
				/>
				{action.label}
			</span>
		</Button>
	);
}
