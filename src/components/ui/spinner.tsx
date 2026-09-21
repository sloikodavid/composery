import clsx from "clsx";
import type { ComponentProps } from "react";

const spinnerSizes = {
	extraSmall: {
		box: 12,
		stroke: 1,
		radiusClassName: "[rx:var(--radius-control-small)]",
	},
	small: {
		box: 16,
		stroke: 1,
		radiusClassName: "[rx:var(--radius-control-small)]",
	},
	medium: {
		box: 20,
		stroke: 2,
		radiusClassName: "[rx:var(--radius-control-large)]",
	},
	large: {
		box: 24,
		stroke: 2,
		radiusClassName: "[rx:var(--radius-control-large)]",
	},
} as const;

const spinnerVariants = {
	neutral: "text-foreground",
	primary: "text-primary",
} as const;

type SpinnerProps = Omit<ComponentProps<"svg">, "children"> & {
	label?: string | undefined;
	size?: keyof typeof spinnerSizes | undefined;
	variant?: keyof typeof spinnerVariants | undefined;
};

export function Spinner({
	className,
	label = "Loading",
	size = "small",
	variant = "neutral",
	...props
}: SpinnerProps) {
	const { box, stroke, radiusClassName } = spinnerSizes[size];
	return (
		<svg
			aria-busy="true"
			aria-label={label}
			className={clsx(
				"inline-block shrink-0",
				spinnerVariants[variant],
				className,
			)}
			height={box}
			role="status"
			viewBox={`0 0 ${box} ${box}`}
			width={box}
			{...props}
		>
			<rect
				className={clsx(
					"spinner-track motion-reduce:animate-none",
					radiusClassName,
				)}
				height={box - stroke}
				pathLength={100}
				strokeWidth={stroke}
				width={box - stroke}
				x={stroke / 2}
				y={stroke / 2}
			/>
		</svg>
	);
}
