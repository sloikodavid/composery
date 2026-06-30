"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface HetznerIconHandle {
	startAnimation: () => void;
	stopAnimation: () => void;
}

interface HetznerIconProps extends HTMLAttributes<HTMLDivElement> {
	size?: number;
}

// Hetzner's round brandmark: the white H (wide stems, thin crossbar) cut out
// of the red disc. It spins a quarter turn on hover with the same spring as
// the other "Open in" marks.
const HetznerIcon = forwardRef<HetznerIconHandle, HetznerIconProps>(
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
					fill="#D50C2D"
					height={size}
					transition={{ type: "spring", stiffness: 250, damping: 25 }}
					variants={{
						normal: { rotate: "0deg" },
						animate: { rotate: "90deg" }
					}}
					viewBox="0 0 24 24"
					width={size}
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						clipRule="evenodd"
						d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24ZM5.47 5.55h2.98v5.17h7.21V5.55h2.98v12.97h-2.98v-5.25H8.45v5.25H5.47z"
						fillRule="evenodd"
					/>
				</motion.svg>
			</div>
		);
	}
);

HetznerIcon.displayName = "HetznerIcon";

export { HetznerIcon };
