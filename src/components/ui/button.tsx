import clsx from "clsx";
import type { ComponentProps } from "react";
import { controlTransitionClassName } from "@/components/ui/interaction";

export const buttonVariants = {
	brand: `${controlTransitionClassName} border border-brand bg-brand text-brand-foreground enabled:hover:border-brand-hover enabled:hover:bg-brand-hover enabled:active:border-brand-active enabled:active:bg-brand-active`,
	primary: `${controlTransitionClassName} border border-primary bg-primary text-primary-foreground enabled:hover:border-primary-hover enabled:hover:bg-primary-hover enabled:active:border-primary-active enabled:active:bg-primary-active`,
	danger: `${controlTransitionClassName} border border-danger bg-danger text-danger-foreground enabled:hover:border-danger-hover enabled:hover:bg-danger-hover enabled:active:border-danger-active enabled:active:bg-danger-active`,
	dangerGhost: `${controlTransitionClassName} text-danger-text enabled:hover:bg-danger-surface-hover enabled:active:bg-danger-surface-active`,
	secondary: `${controlTransitionClassName} border border-control-border bg-surface text-foreground enabled:hover:border-control-border-hover enabled:hover:bg-surface-hover enabled:active:border-control-border-active enabled:active:bg-surface-active`,
	ghost: `${controlTransitionClassName} text-foreground enabled:hover:bg-surface-hover enabled:active:bg-surface-active`,
} as const;

export const buttonClassName =
	"inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-brand tracking-display disabled:pointer-events-none disabled:opacity-50";

export const buttonSizes = {
	small: "h-8 px-3 text-xs",
	medium: "h-9 px-4 text-sm",
	large: "h-11 px-5 text-base",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;

type ButtonProps = ComponentProps<"button"> & {
	variant?: ButtonVariant | undefined;
	size?: ButtonSize | undefined;
};

export function Button({
	variant = "brand",
	size = "medium",
	type = "button",
	className,
	...props
}: ButtonProps) {
	return (
		<button
			type={type}
			className={clsx(
				buttonClassName,
				buttonVariants[variant],
				buttonSizes[size],
				className,
			)}
			{...props}
		/>
	);
}
