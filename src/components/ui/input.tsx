import clsx from "clsx";
import type { ComponentProps } from "react";
import { controlTransitionClassName } from "@/components/ui/interaction";

/** The static surface shared by input elements and composite input frames. */
export const inputSurfaceClassName = `${controlTransitionClassName} border border-control-border bg-background text-foreground`;

/** The focus state for a frame that contains more than one input element. */
export const inputFrameClassName = `${inputSurfaceClassName} focus-within:border-input-border-focus`;

export const inputControlClassName = `${inputSurfaceClassName} focus:border-input-border-focus placeholder:text-muted focus:ring-0 focus-visible:outline-none focus-visible:ring-0 aria-invalid:border-danger disabled:pointer-events-none disabled:opacity-50`;

export const inputClassName = `${inputControlClassName} h-9 w-full px-3 text-sm`;

export function Input({
	type = "text",
	className,
	...props
}: ComponentProps<"input">) {
	return (
		<input type={type} className={clsx(inputClassName, className)} {...props} />
	);
}
