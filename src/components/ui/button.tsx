import clsx from "clsx";
import type { ComponentProps, ReactElement } from "react";
import {
	controlRadiusClassName,
	controlRadiusClassNames,
	controlTransitionClassName,
} from "@/components/ui/interaction";
import { linkClassName } from "@/components/ui/link";

export const buttonVariants = {
	brand: `${controlTransitionClassName} border border-brand bg-brand text-brand-foreground enabled:hover:border-brand-hover enabled:hover:bg-brand-hover enabled:active:border-brand-active enabled:active:bg-brand-active`,
	primary: `${controlTransitionClassName} border border-primary bg-primary text-primary-foreground enabled:hover:border-primary-hover enabled:hover:bg-primary-hover enabled:active:border-primary-active enabled:active:bg-primary-active`,
	danger: `${controlTransitionClassName} border border-danger bg-danger text-danger-foreground enabled:hover:border-danger-hover enabled:hover:bg-danger-hover enabled:active:border-danger-active enabled:active:bg-danger-active`,
	dangerGhost: `${controlTransitionClassName} text-danger-text enabled:hover:bg-danger-surface-hover enabled:active:bg-danger-surface-active`,
	secondary: `${controlTransitionClassName} border border-border bg-surface text-foreground enabled:hover:border-control-border-hover enabled:hover:bg-surface-hover enabled:active:border-control-border-active enabled:active:bg-surface-active`,
	ghost: `${controlTransitionClassName} text-foreground enabled:hover:bg-surface-hover enabled:active:bg-surface-active`,
} as const;

export const buttonClassName =
	"inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-brand tracking-display shadow-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

export const buttonLinkClassName = `${buttonClassName} ${controlRadiusClassName} ${linkClassName} px-1 text-muted text-xs leading-5`;

export const buttonSizes = {
	small: `${controlRadiusClassNames.medium} h-8 px-3 text-xs`,
	medium: `${controlRadiusClassNames.large} h-9 px-4 text-sm`,
	large: `${controlRadiusClassNames.large} h-11 px-5 text-base`,
} as const;

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;

const iconOnlyButtonSizes: Record<ButtonSize, string> = {
	small: `${controlRadiusClassNames.medium} size-8 p-0 text-xs [&>svg]:size-4`,
	medium: `${controlRadiusClassNames.large} size-9 p-0 text-sm [&>svg]:size-4`,
	large: `${controlRadiusClassNames.large} size-11 p-0 text-base [&>svg]:size-5`,
};

type ButtonBaseProps = ComponentProps<"button"> & {
	variant?: ButtonVariant | undefined;
	size?: ButtonSize | undefined;
};

type ButtonWithTextProps = ButtonBaseProps & {
	iconOnly?: false | undefined;
};

type ButtonWithIconProps = Omit<ButtonBaseProps, "aria-label" | "children"> & {
	"aria-label": string;
	children: ReactElement;
	iconOnly: true;
};

export type ButtonProps = ButtonWithTextProps | ButtonWithIconProps;

export function Button({
	iconOnly = false,
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
				iconOnly ? iconOnlyButtonSizes[size] : buttonSizes[size],
				className,
			)}
			{...props}
		/>
	);
}
