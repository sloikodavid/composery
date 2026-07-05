import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"group/button inline-flex shrink-0 items-center justify-center rounded-2xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary)_88%,var(--background))] active:bg-[color-mix(in_oklab,var(--primary)_78%,var(--background))]",
				outline:
					"border-border bg-background hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] hover:text-foreground active:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] aria-expanded:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)] dark:active:bg-[color-mix(in_oklab,var(--foreground)_18%,transparent)] dark:aria-expanded:bg-[color-mix(in_oklab,var(--foreground)_18%,transparent)]",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary)_94%,var(--foreground))] active:bg-[color-mix(in_oklab,var(--secondary)_92%,var(--foreground))] aria-expanded:bg-[color-mix(in_oklab,var(--secondary)_92%,var(--foreground))] aria-expanded:text-secondary-foreground dark:hover:bg-[color-mix(in_oklab,var(--secondary)_88%,var(--foreground))] dark:active:bg-[color-mix(in_oklab,var(--secondary)_78%,var(--foreground))] dark:aria-expanded:bg-[color-mix(in_oklab,var(--secondary)_78%,var(--foreground))]",
				ghost:
					"hover:bg-[var(--ghost-hover)] hover:text-foreground focus-visible:bg-[var(--ghost-active)] active:bg-[var(--ghost-active)] aria-expanded:bg-[var(--ghost-active)] aria-expanded:text-foreground",
				destructive:
					"bg-destructive/10 text-destructive hover:bg-destructive/16 active:bg-destructive/24 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/18 dark:hover:bg-destructive/26 dark:active:bg-destructive/34 dark:focus-visible:ring-destructive/40",
				warning:
					"bg-warning/10 text-warning hover:bg-warning/16 active:bg-warning/24 focus-visible:border-warning/40 focus-visible:ring-warning/20 dark:bg-warning/18 dark:hover:bg-warning/26 dark:active:bg-warning/34 dark:focus-visible:ring-warning/40",
				link: "text-primary link-underline"
			},
			size: {
				default:
					"h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
				nav: "h-8 gap-1.5 rounded-full px-3",
				xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
				lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
				icon: "size-8",
				"icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-7",
				"icon-lg": "size-9"
			}
		},
		defaultVariants: {
			variant: "default",
			size: "default"
		}
	}
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
