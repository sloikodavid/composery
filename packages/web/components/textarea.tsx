import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const textareaVariants = cva(
	"field-sizing-content min-h-16 w-full min-w-0 resize-none rounded-2xl text-base transition-[color,box-shadow,border-color] duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
	{
		variants: {
			variant: {
				outline:
					"border border-border bg-background px-2.5 py-1.5 dark:bg-input/30",
				secondary:
					"border border-transparent bg-input/50 px-2.5 py-1.5 dark:bg-input/30"
			}
		},
		defaultVariants: {
			variant: "outline"
		}
	}
);

function Textarea({
	className,
	variant,
	...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(textareaVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Textarea, textareaVariants };
