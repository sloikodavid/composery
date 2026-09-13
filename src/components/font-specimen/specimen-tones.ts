// Neutral greys for the specimen only, so the specimen does not suggest a palette.
export const tones = {
	page: "bg-neutral-50 dark:bg-neutral-950",
	surface: "bg-white dark:bg-neutral-900",
	sunken: "bg-neutral-100 dark:bg-neutral-800",
	border: "border-neutral-200 dark:border-neutral-800",
	strongBorder: "border-neutral-300 dark:border-neutral-700",
	text: "text-neutral-900 dark:text-neutral-100",
	muted: "text-neutral-600 dark:text-neutral-400",
	faint: "text-neutral-400 dark:text-neutral-500",
	inverse:
		"bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
	danger: "text-red-600 dark:text-red-400",
	dangerBorder: "border-red-600 dark:border-red-400",
} as const;
