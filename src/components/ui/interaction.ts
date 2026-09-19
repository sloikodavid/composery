export const controlTransitionClassName =
	"transition-[background-color,border-color,color]";

export const controlRadiusClassNames = {
	small: "rounded-control-small",
	medium: "rounded-control",
	large: "rounded-control-large",
} as const;

export const controlRadiusClassName = controlRadiusClassNames.medium;

export const checkboxRadiusClassName = "rounded-checkbox";

export const fullRadiusClassName = "rounded-full";
