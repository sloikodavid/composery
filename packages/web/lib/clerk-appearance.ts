import { shadcn } from "@clerk/ui/themes";

// `!` beats @clerk/ui's emotion styles drawn in @layer components; our Tailwind
// strings append in @layer utilities, which outranks it, so the theme's own
// resets need `!` to win the in-layer tie.
export const clerkAppearance = {
	theme: shadcn,
	variables: {
		colorPrimary: "var(--primary)",
		colorPrimaryForeground: "var(--primary-foreground)",
		colorForeground: "var(--foreground)",
		colorMutedForeground: "var(--muted-foreground)",
		colorBackground: "var(--card)",
		colorInput: "var(--background)",
		colorInputForeground: "var(--foreground)",
		colorDanger: "var(--destructive)",
		colorSuccess: "var(--success)",
		colorWarning: "var(--warning)",
		colorNeutral: "var(--foreground)",
		colorRing: "color-mix(in oklab, var(--ring) 30%, transparent)",
		colorShimmer: "var(--muted)",
		colorModalBackdrop: "rgba(0, 0, 0, 0.4)",
		borderRadius: "1.125rem",
		spacing: "1rem",
		fontSize: "0.875rem",
		fontFamily:
			"-apple-system, BlinkMacSystemFont, var(--font-inter), 'Segoe UI', system-ui, sans-serif"
	},
	elements: {
		rootBox: "w-full",
		cardBox:
			"w-full rounded-[min(var(--radius-4xl),24px)] border border-border shadow-none!",
		card: "bg-transparent! shadow-none!",
		popoverBox:
			"rounded-[min(var(--radius-4xl),24px)] border border-border shadow-lg!",
		userButtonPopoverCard:
			"rounded-[min(var(--radius-4xl),24px)] border border-border shadow-lg!",
		modalContent:
			"rounded-[min(var(--radius-4xl),24px)] border border-border shadow-lg!",
		headerTitle: "font-heading text-base font-medium text-foreground",
		headerSubtitle: "text-sm text-muted-foreground",
		button: "rounded-2xl font-medium transition-all active:translate-y-px",
		formButtonPrimary:
			"h-11 w-full rounded-2xl text-sm font-medium bg-primary text-primary-foreground shadow-none! transition-all hover:bg-primary/80 active:translate-y-px",
		formButtonReset:
			"rounded-2xl font-medium transition-all active:translate-y-px",
		socialButtons: "gap-2",
		socialButtonsBlockButton:
			"h-11 rounded-2xl text-sm font-medium bg-background text-foreground transition-all hover:bg-muted hover:text-foreground active:translate-y-px dark:bg-transparent dark:hover:bg-input/30",
		socialButtonsBlockButtonText: "text-sm font-medium text-foreground!",
		socialButtonsIconButton:
			"h-11 rounded-2xl bg-background transition-all hover:bg-muted active:translate-y-px dark:bg-transparent dark:hover:bg-input/30",
		input:
			"h-11 rounded-2xl bg-background! px-3 text-base placeholder:text-muted-foreground md:text-sm dark:bg-input/30!",
		formFieldInput:
			"h-11 rounded-2xl bg-background! px-3 text-base placeholder:text-muted-foreground md:text-sm dark:bg-input/30!",
		formFieldLabel: "text-sm font-medium text-foreground",
		otpCodeFieldInput: "rounded-2xl",
		dividerLine: "bg-border",
		dividerText: "text-sm text-muted-foreground",
		footer: "bg-transparent! text-muted-foreground",
		footerActionLink: "text-primary hover:text-primary/80",
		badge: "rounded-2xl text-xs font-medium",
		modalCloseButton: {
			color: "var(--muted-foreground)",
			opacity: 0.7,
			transition: "opacity 150ms",
			"&:hover": {
				opacity: 1,
				color: "var(--muted-foreground)",
				backgroundColor: "transparent"
			},
			"&:focus": { opacity: 1, backgroundColor: "transparent" }
		}
	}
} as const;

export const headerUserButtonAppearance = {
	...clerkAppearance,
	elements: {
		...clerkAppearance.elements,
		userButtonTrigger: { animation: "var(--header-auth-animation)" },
		userButtonAvatarBox: {
			animation: "var(--header-auth-animation)",
			width: "2rem",
			height: "2rem"
		}
	}
} as const;

export const clerkLocalization = {
	userProfile: {
		navbar: {
			description: "Manage your auth."
		}
	}
} as const;
