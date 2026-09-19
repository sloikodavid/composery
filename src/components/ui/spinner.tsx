import clsx from "clsx";
import type { ComponentProps } from "react";
import { controlRadiusClassNames } from "@/components/ui/interaction";

export const spinnerClassName =
	"inline-block shrink-0 animate-spin border-current border-b-transparent border-l-transparent motion-reduce:animate-none";

export const spinnerSizes = {
	extraSmall: `${controlRadiusClassNames.small} size-3 border`,
	small: `${controlRadiusClassNames.small} size-4 border`,
	medium: `${controlRadiusClassNames.large} size-5 border-2`,
	large: `${controlRadiusClassNames.large} size-6 border-2`,
} as const;

export const spinnerDefaultClassName = `${spinnerClassName} ${controlRadiusClassNames.medium}`;

export const spinnerVariants = {
	neutral: "text-foreground",
	primary: "text-primary",
} as const;

type SpinnerProps = Omit<ComponentProps<"span">, "children"> & {
	label?: string | undefined;
	size?: keyof typeof spinnerSizes | undefined;
	variant?: keyof typeof spinnerVariants | undefined;
};

/** An indicator for work with no measurable completion value. */
export function Spinner({
	className,
	label = "Loading",
	size = "small",
	variant = "neutral",
	...props
}: SpinnerProps) {
	return (
		<span
			aria-busy="true"
			aria-label={label}
			role="status"
			className={clsx(
				spinnerClassName,
				spinnerSizes[size],
				spinnerVariants[variant],
				className,
			)}
			{...props}
		/>
	);
}
