import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export const fieldClassName = "grid content-start gap-2";
export const fieldLabelClassName =
	"text-sm disabled:opacity-50 data-[disabled=true]:opacity-50";
export const fieldDescriptionClassName = "text-muted text-xs";

export const fieldMessageClassNames = {
	info: "text-muted",
	success: "text-success-text",
	warning: "text-warning-text",
	error: "text-danger-text",
} as const;

export type FieldMessageVariant = keyof typeof fieldMessageClassNames;

export function Field({ className, ...props }: ComponentProps<"div">) {
	return <div className={clsx(fieldClassName, className)} {...props} />;
}

export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
	// biome-ignore lint/a11y/noLabelWithoutControl: callers provide the control
	return <label className={clsx(fieldLabelClassName, className)} {...props} />;
}

export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
	return (
		<p className={clsx(fieldDescriptionClassName, className)} {...props} />
	);
}

type FieldMessageProps = ComponentProps<"p"> & {
	children?: ReactNode | undefined;
	reserveSpace?: boolean | undefined;
	variant?: FieldMessageVariant | undefined;
};

export function FieldMessage({
	children,
	className,
	reserveSpace = false,
	variant = "info",
	...props
}: FieldMessageProps) {
	const isUrgent = variant === "error";
	return (
		<p
			aria-atomic={isUrgent ? "true" : undefined}
			aria-live={isUrgent ? "polite" : undefined}
			className={clsx(
				"text-xs",
				reserveSpace && "min-h-4",
				fieldMessageClassNames[variant],
				className,
			)}
			{...props}
		>
			{children}
		</p>
	);
}
