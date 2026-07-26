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
		colorModalBackdrop: "var(--overlay)",
		// Form controls match the full-page auth form (new-box): rounded-lg
		// (var(--radius)), 15px text. Card/popover radius is overridden per-element
		// to the 24px card curve below.
		borderRadius: "var(--radius)",
		spacing: "1rem",
		fontSize: "0.9375rem",
		fontFamily:
			"-apple-system, BlinkMacSystemFont, var(--font-inter), 'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif"
	},
	elements: {
		popoverBox:
			"rounded-[min(var(--radius-4xl),24px)] border border-border shadow-lg!",
		userButtonPopoverCard:
			"rounded-[min(var(--radius-4xl),24px)] border border-border shadow-lg!",
		headerTitle: "font-heading text-lg font-medium text-foreground",
		headerSubtitle: "text-[15px] text-muted-foreground",
		// Primary/outline buttons mirror components/button.tsx (default + outline
		// variants): color-mix hovers rather than opacity, ring-1 focus, the
		// active nudge. Sized like new-box's h-12 rounded-lg controls.
		button:
			"rounded-lg font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px",
		formButtonPrimary:
			"h-12 w-full rounded-lg text-[15px] font-medium bg-primary text-primary-foreground shadow-none! transition-all outline-none hover:bg-[color-mix(in_oklab,var(--primary)_88%,var(--background))]! active:bg-[color-mix(in_oklab,var(--primary)_78%,var(--background))]! focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px",
		formButtonReset:
			"rounded-lg font-medium transition-all active:translate-y-px",
		socialButtons: "gap-2",
		// Hover wash stays lighter than --border so the fill reads as a
		// soft surface inside the outline instead of blending into it. dark: keeps
		// its stronger lift since the border there is barely visible.
		socialButtonsBlockButton:
			"h-12 rounded-lg text-[15px] font-medium border border-border bg-background text-foreground transition-all outline-none hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)]! hover:text-foreground active:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]! focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px dark:bg-transparent dark:hover:bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)]! dark:active:bg-[color-mix(in_oklab,var(--foreground)_18%,transparent)]!",
		socialButtonsBlockButtonText: "text-[15px] font-medium text-foreground!",
		socialButtonsIconButton:
			"h-12 rounded-lg border border-border bg-background transition-all outline-none hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)]! active:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]! focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px dark:bg-transparent dark:hover:bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)]! dark:active:bg-[color-mix(in_oklab,var(--foreground)_18%,transparent)]!",
		// Inputs mirror components/input.tsx (outline variant) at new-box's
		// h-12 rounded-lg px-5 scale, with the ring-1 focus treatment.
		input:
			"h-12 rounded-lg border border-border bg-background! px-5 text-[15px] shadow-xs transition-[color,box-shadow,border-color] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30!",
		formFieldInput:
			"h-12 rounded-lg border border-border bg-background! px-5 text-[15px] shadow-xs transition-[color,box-shadow,border-color] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30!",
		formFieldLabel: "text-[15px] font-medium text-foreground",
		otpCodeFieldInput:
			"rounded-lg border border-border focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring",
		dividerLine: "bg-border",
		dividerText: "text-[15px] text-muted-foreground",
		footerActionLink:
			"text-primary transition-colors hover:text-[color-mix(in_oklab,var(--primary)_80%,var(--background))]",
		badge: "rounded-lg text-xs font-medium",
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

// The route embeds SignIn directly in the page, so its outer card should sit
// flush with the page. Keep that choice component-local: Clerk deliberately
// renders modal flows as raised even when an embedded component is flush.
// `!` because Clerk sizes both boxes off the viewport (min(25rem, 100vw-2.5rem)),
// which ignores the page's own padding and spills the card past the right edge
// on a phone; a plain `w-full` loses to it.
export const signInAppearance = {
	...clerkAppearance,
	options: { elevation: "flush" },
	elements: {
		...clerkAppearance.elements,
		rootBox: "w-full!",
		cardBox: "w-full!"
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
