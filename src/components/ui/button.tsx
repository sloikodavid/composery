import clsx from "clsx";
import type { ComponentProps } from "react";

export const buttonVariants = {
	brand:
		"bg-brand text-brand-foreground hover:bg-brand-hover active:bg-brand-active",
	primary:
		"bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
	secondary:
		"border border-border bg-surface text-foreground hover:border-border-hover hover:bg-surface-hover active:border-border-active active:bg-surface-active",
	ghost: "text-foreground hover:bg-surface-hover active:bg-surface-active",
} as const;

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
				"inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-brand tracking-display transition-colors disabled:pointer-events-none disabled:opacity-50",
				buttonVariants[variant],
				buttonSizes[size],
				className,
			)}
			{...props}
		/>
	);
}
