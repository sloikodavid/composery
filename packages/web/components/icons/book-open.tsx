"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface BookOpenIconHandle {
	startAnimation: () => void;
	stopAnimation: () => void;
}

interface BookOpenIconProps extends HTMLAttributes<HTMLDivElement> {
	size?: number;
}

const VARIANTS: Variants = {
	normal: {
		y: 0,
		rotate: 0,
		transition: {
			duration: 0.3,
			ease: "easeOut"
		}
	},
	animate: {
		y: [0, -2, 0],
		rotate: [0, -5, 0],
		transition: {
			duration: 0.55,
			ease: "easeInOut",
			times: [0, 0.45, 1]
		}
	}
};

const BookOpenIcon = forwardRef<BookOpenIconHandle, BookOpenIconProps>(
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
				if (isControlledRef.current) {
					onMouseEnter?.(e);
				} else {
					controls.start("animate");
				}
			},
			[controls, onMouseEnter]
		);

		const handleMouseLeave = useCallback(
			(e: React.MouseEvent<HTMLDivElement>) => {
				if (isControlledRef.current) {
					onMouseLeave?.(e);
				} else {
					controls.start("normal");
				}
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
					fill="none"
					height={size}
					initial="normal"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
					style={{ transformOrigin: "12px 12px" }}
					variants={VARIANTS}
					viewBox="0 0 24 24"
					width={size}
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d="M12 7v14" />
					<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
				</motion.svg>
			</div>
		);
	}
);

BookOpenIcon.displayName = "BookOpenIcon";

export { BookOpenIcon };
