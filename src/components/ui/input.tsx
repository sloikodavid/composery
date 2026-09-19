import clsx from "clsx";
import type { ComponentProps } from "react";
import {
	controlRadiusClassName,
	controlTransitionClassName,
} from "@/components/ui/interaction";

/** The static surface shared by input elements and composite input frames. */
export const inputSurfaceClassName = `${controlRadiusClassName} ${controlTransitionClassName} border border-border bg-background text-foreground shadow-none`;

/** The focus state for a frame that contains more than one input element. */
export const inputFrameClassName = `${inputSurfaceClassName} focus-within:border-input-border-focus`;

export const inputControlClassName = `${inputSurfaceClassName} placeholder:text-muted focus:border-input-border-focus focus:ring-0 focus-visible:outline-none focus-visible:ring-0 aria-invalid:border-danger disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50`;
export const inputClassName = `${inputControlClassName} h-9 w-full px-3 text-sm`;
export const textareaClassName = `${inputControlClassName} min-h-24 w-full resize-y px-3 py-2 text-sm`;

export function Input({
	type = "text",
	className,
	...props
}: ComponentProps<"input">) {
	return (
		<input type={type} className={clsx(inputClassName, className)} {...props} />
	);
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
	return <textarea className={clsx(textareaClassName, className)} {...props} />;
}
