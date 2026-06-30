"use client";

import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { CheckIcon, type CheckIconHandle } from "@/components/icons/check";
import { CopyIcon, type CopyIconHandle } from "@/components/icons/copy";

type ButtonProps = ComponentProps<typeof Button>;

// Copies a value to the clipboard. The label never changes - only the icon swaps
// to a check on success - so the button keeps its width and nothing shifts when
// clicked. Outline by default; pass-through props let callers match the
// surrounding button size/variant.
export function CopyLinkButton({
	label = "Copy link",
	onBlur,
	onFocus,
	onMouseEnter,
	onMouseLeave,
	value,
	...props
}: { label?: string; value: string } & Omit<
	ButtonProps,
	"children" | "value" | "onClick"
>) {
	const [copied, setCopied] = useState(false);
	const check = useRef<CheckIconHandle>(null);
	const copy = useRef<CopyIconHandle>(null);

	// Play the draw once the check has mounted (it replaces the copy glyph).
	useEffect(() => {
		if (copied) check.current?.startAnimation();
	}, [copied]);

	const handleFocus: NonNullable<ButtonProps["onFocus"]> = (event) => {
		if (!copied) copy.current?.startAnimation();
		onFocus?.(event);
	};

	const handleBlur: NonNullable<ButtonProps["onBlur"]> = (event) => {
		if (!copied) copy.current?.stopAnimation();
		onBlur?.(event);
	};

	const handleMouseEnter: NonNullable<ButtonProps["onMouseEnter"]> = (
		event
	) => {
		if (!copied) copy.current?.startAnimation();
		onMouseEnter?.(event);
	};

	const handleMouseLeave: NonNullable<ButtonProps["onMouseLeave"]> = (
		event
	) => {
		if (!copied) copy.current?.stopAnimation();
		onMouseLeave?.(event);
	};

	return (
		<Button
			variant="outline"
			{...props}
			onBlur={handleBlur}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
					toast.success("Link copied");
					setTimeout(() => setCopied(false), 1500);
				} catch {
					toast.error("Couldn't copy link");
				}
			}}
			onFocus={handleFocus}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<span className="relative size-4 shrink-0" aria-hidden>
				<AnimatePresence initial={false}>
					<motion.span
						animate={{ opacity: 1, scale: 1, rotate: 0 }}
						className="absolute inset-0 flex items-center justify-center"
						exit={{ opacity: 0, scale: 0.78, rotate: copied ? -8 : 8 }}
						initial={{ opacity: 0, scale: 0.78, rotate: copied ? 8 : -8 }}
						key={copied ? "check" : "copy"}
						transition={{
							duration: 0.16,
							ease: [0.16, 1, 0.3, 1]
						}}
					>
						{copied ? (
							<CheckIcon ref={check} size={16} />
						) : (
							<CopyIcon ref={copy} size={16} />
						)}
					</motion.span>
				</AnimatePresence>
			</span>
			{label}
		</Button>
	);
}
