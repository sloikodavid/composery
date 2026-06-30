import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const inputVariants = cva(
	"h-8 w-full min-w-0 rounded-2xl text-base shadow-xs transition-[color,box-shadow,border-color] duration-200 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
	{
		variants: {
			variant: {
				outline:
					"border border-border bg-background px-3 py-1 dark:bg-input/30",
				secondary:
					"border border-transparent bg-input/50 px-3 py-1 dark:bg-input/30"
			}
		},
		defaultVariants: {
			variant: "outline"
		}
	}
);

function Input({
	className,
	type,
	variant,
	...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(inputVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Input, inputVariants };
