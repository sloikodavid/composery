import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { buttonLinkClassName } from "@/components/ui/button";
import { panelClassName } from "@/components/ui/card";

export const alertClassName = `${panelClassName} flex items-start gap-3 border-0 px-4 py-3 text-sm shadow-none`;

export const alertVariantClassNames = {
	neutral: "bg-muted-surface text-foreground",
	primary: "bg-primary text-primary-foreground",
	success: "bg-success-surface text-success-text",
	warning: "bg-warning-surface text-warning-text",
	danger: "bg-danger-surface text-danger-text",
} as const;

export type AlertVariant = keyof typeof alertVariantClassNames;

type AlertBaseProps = Omit<ComponentProps<"div">, "title"> & {
	description?: ReactNode | undefined;
	icon?: ReactNode | undefined;
	title?: ReactNode | undefined;
	variant?: AlertVariant | undefined;
};

type AlertDismissProps =
	| {
			dismissLabel?: string | undefined;
			onDismiss: () => void;
	  }
	| {
			dismissLabel?: never;
			onDismiss?: undefined;
	  };

type AlertProps = AlertBaseProps & AlertDismissProps;

export function Alert({
	children,
	className,
	description,
	dismissLabel = "Close",
	icon,
	onDismiss,
	title,
	variant = "neutral",
	...props
}: AlertProps) {
	return (
		<div
			data-variant={variant}
			className={clsx(
				alertClassName,
				alertVariantClassNames[variant],
				className,
			)}
			{...props}
		>
			{icon !== undefined && icon !== null ? (
				<span className="mt-0.5 shrink-0">{icon}</span>
			) : null}
			<div className="min-w-0 flex-1">
				{title !== undefined && title !== null ? (
					<p className="font-brand">{title}</p>
				) : null}
				{description !== undefined && description !== null ? (
					<p className={clsx(title !== undefined && title !== null && "mt-1")}>
						{description}
					</p>
				) : null}
				{children}
			</div>
			{onDismiss ? (
				<button
					type="button"
					className={buttonLinkClassName}
					onClick={onDismiss}
				>
					{dismissLabel}
				</button>
			) : null}
		</div>
	);
}
