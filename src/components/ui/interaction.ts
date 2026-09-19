/** Color properties that can animate without delaying or changing the keyboard-focus outline. */
export const controlTransitionClassName =
	"transition-[background-color,border-color,color]";

export const controlRadiusClassNames = {
	small: "rounded-control-small",
	medium: "rounded-control",
	large: "rounded-control-large",
} as const;

/** The provisional radius shared by medium interactive controls. */
export const controlRadiusClassName = controlRadiusClassNames.medium;

export const checkboxRadiusClassName = "rounded-checkbox";

/** The radius for circular controls and indicators. */
export const fullRadiusClassName = "rounded-full";
