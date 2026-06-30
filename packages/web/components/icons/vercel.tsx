"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface VercelIconHandle {
	startAnimation: () => void;
	stopAnimation: () => void;
}

interface VercelIconProps extends HTMLAttributes<HTMLDivElement> {
	size?: number;
}

// Vercel's triangle brandmark. Monochrome, so it draws in `currentColor` to
// follow the button's foreground in light and dark. It lifts on hover with the
// same spring as the other "Open in" marks.
const VercelIcon = forwardRef<VercelIconHandle, VercelIconProps>(
	({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
		const controls = useAnimation();
		const isControlledRef = useRef(false);

		useImperativeHandle(ref, () => {
			isControlledRef.current = true;
			return {
				startAnimation: () => controls.start("animate"),
				stopAnimation: () => controls.start("normal")
			};
		});

		const handleMouseEnter = useCallback(
			(e: React.MouseEvent<HTMLDivElement>) => {
				if (isControlledRef.current) onMouseEnter?.(e);
				else controls.start("animate");
			},
			[controls, onMouseEnter]
		);

		const handleMouseLeave = useCallback(
			(e: React.MouseEvent<HTMLDivElement>) => {
				if (isControlledRef.current) onMouseLeave?.(e);
				else controls.start("normal");
			},
			[controls, onMouseLeave]
		);

		return (
			<div
				className={cn(className)}
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}
				{...props}
			>
				<motion.svg
					animate={controls}
					fill="currentColor"
					height={size}
					transition={{ type: "spring", stiffness: 250, damping: 25 }}
					variants={{
						normal: { y: 0 },
						animate: { y: -2.5 }
					}}
					viewBox="0 0 24 24"
					width={size}
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d="M12 2 L23 21 H1 Z" />
				</motion.svg>
			</div>
		);
	}
);

VercelIcon.displayName = "VercelIcon";

export { VercelIcon };
