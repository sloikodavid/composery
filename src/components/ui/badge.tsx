import clsx from "clsx";
import type { ComponentProps } from "react";
import { controlRadiusClassName } from "@/components/ui/interaction";

export const badgeClassName = `${controlRadiusClassName} inline-flex shrink-0 items-center border px-1.5 py-0.5 font-brand text-xs leading-none shadow-none`;

export const badgeVariantClassNames = {
	neutral: "border-border bg-muted-surface text-foreground",
	primary: "border-primary bg-primary text-primary-foreground",
	danger: "border-danger-border bg-danger-surface text-danger-text",
	success: "border-success-border bg-success-surface text-success-text",
	warning: "border-warning-border bg-warning-surface text-warning-text",
} as const;

export type BadgeVariant = keyof typeof badgeVariantClassNames;

type BadgeProps = ComponentProps<"span"> & {
	variant?: BadgeVariant | undefined;
};

/** A short status or category label. */
export function Badge({
	variant = "neutral",
	className,
	...props
}: BadgeProps) {
	return (
		<span
			data-variant={variant}
			className={clsx(
				badgeClassName,
				badgeVariantClassNames[variant],
				className,
			)}
			{...props}
		/>
	);
}
