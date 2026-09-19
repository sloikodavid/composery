import clsx from "clsx";
import type { ComponentProps } from "react";

export const separatorLineClassName = "shrink-0 bg-border";
export const separatorBorderClassName = "border-border";

type SeparatorProps = Omit<ComponentProps<"div">, "children" | "ref"> & {
	orientation?: "horizontal" | "vertical" | undefined;
};

export function Separator({
	orientation = "horizontal",
	className,
	...props
}: SeparatorProps) {
	if (orientation === "horizontal") {
		return (
			<hr
				{...props}
				className={clsx(
					separatorLineClassName,
					"h-px w-full border-0",
					className,
				)}
			/>
		);
	}

	return (
		<hr
			{...props}
			aria-orientation={orientation}
			className={clsx(
				separatorLineClassName,
				"h-full w-px border-0",
				className,
			)}
		/>
	);
}
