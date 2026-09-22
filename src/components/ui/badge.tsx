import clsx from "clsx";
import type { ComponentProps } from "react";
import { controlRadiusClassName } from "@/components/ui/interaction";

export const badgeClassName = `${controlRadiusClassName} inline-flex shrink-0 items-center border px-1.5 py-0.5 font-brand text-xs leading-none shadow-none`;

export const badgeVariantClassNames = {
	neutral: "badge-neutral",
	primary: "badge-primary",
	danger: "badge-danger",
	success: "badge-success",
	warning: "badge-warning",
} as const;

export type BadgeVariant = keyof typeof badgeVariantClassNames;

type BadgeProps = ComponentProps<"span"> & {
	variant?: BadgeVariant | undefined;
};

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
