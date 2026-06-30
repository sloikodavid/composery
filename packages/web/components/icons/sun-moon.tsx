"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface SunMoonIconHandle {
	startAnimation: () => void;
	stopAnimation: () => void;
}

interface SunMoonIconProps extends HTMLAttributes<HTMLDivElement> {
	size?: number;
}

const SUN_VARIANTS: Variants = {
	normal: {
		rotate: 0
	},
	animate: {
		rotate: [0, -5, 5, -2, 2, 0],
		transition: {
			duration: 1.5,
			ease: "easeInOut"
		}
	}
};

const MOON_VARIANTS: Variants = {
	normal: { opacity: 1 },
	animate: (index: number) => ({
		opacity: [0, 1],
		transition: { delay: index * 0.1, duration: 0.3 }
	})
};

const RAY_PATHS = [
	"M12 2v2",
	"M12 20v2",
	"m4.9 4.9 1.4 1.4",
	"m17.7 17.7 1.4 1.4",
	"M2 12h2",
	"M20 12h2",
	"m6.3 17.7-1.4 1.4",
	"m19.1 4.9-1.4 1.4"
];

const SunMoonIcon = forwardRef<SunMoonIconHandle, SunMoonIconProps>(
	({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
		const sunControls = useAnimation();
		const moonControls = useAnimation();
		const isControlledRef = useRef(false);

		useImperativeHandle(ref, () => {
			isControlledRef.current = true;

			return {
				startAnimation: () => {
					sunControls.start("animate");
					moonControls.start("animate");
				},
				stopAnimation: () => {
					sunControls.start("normal");
					moonControls.start("normal");
				}
			};
		});

		const handleMouseEnter = useCallback(
			(e: React.MouseEvent<HTMLDivElement>) => {
				if (isControlledRef.current) {
					onMouseEnter?.(e);
				} else {
					sunControls.start("animate");
					moonControls.start("animate");
				}
			},
			[moonControls, onMouseEnter, sunControls]
		);

		const handleMouseLeave = useCallback(
			(e: React.MouseEvent<HTMLDivElement>) => {
				if (isControlledRef.current) {
					onMouseLeave?.(e);
				} else {
					sunControls.start("normal");
					moonControls.start("normal");
				}
			},
			[moonControls, onMouseLeave, sunControls]
		);

		return (
			<div
				className={cn(className)}
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}
				{...props}
			>
				<svg
					fill="none"
					height={size}
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
					viewBox="0 0 24 24"
					width={size}
					xmlns="http://www.w3.org/2000/svg"
				>
					<motion.g
						animate={sunControls}
						initial="normal"
						variants={SUN_VARIANTS}
					>
						<path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4" />
					</motion.g>
					{RAY_PATHS.map((path, index) => (
						<motion.path
							animate={moonControls}
							custom={index + 1}
							d={path}
							initial="normal"
							key={path}
							variants={MOON_VARIANTS}
						/>
					))}
				</svg>
			</div>
		);
	}
);

SunMoonIcon.displayName = "SunMoonIcon";

export { SunMoonIcon };
