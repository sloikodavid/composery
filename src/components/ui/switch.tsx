import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import {
	controlRadiusClassName,
	controlRadiusClassNames,
	controlTransitionClassName,
} from "@/components/ui/interaction";

export const switchRootClassName =
	"relative inline-flex w-fit items-center gap-2 [&:has(:disabled)]:cursor-default [&:has(:disabled)]:opacity-50 [&:has(input:disabled)>span]:cursor-default [&:has(input:focus-visible)>input+span]:outline [&:has(input:focus-visible)>input+span]:outline-1 [&:has(input:focus-visible)>input+span]:outline-focus [&:has(input:focus-visible)>input+span]:outline-offset-2";
export const switchIndicatorClassName = `${controlTransitionClassName} ${controlRadiusClassName} relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center border border-border bg-muted-surface p-px shadow-none peer-checked:switch-checked`;
export const switchThumbClassName = `${controlRadiusClassNames.small} pointer-events-none relative inset-auto m-0 size-3 transform-none bg-foreground shadow-none transition-[background-color,margin-inline-start] motion-reduce:transition-none`;
export const switchLabelClassName =
	"cursor-pointer select-none text-sm peer-disabled:cursor-default";

type SwitchProps = Omit<
	ComponentProps<"input">,
	"children" | "className" | "role" | "type"
> & {
	className?: string | undefined;
	label: ReactNode;
};

export function Switch({ className, label, ...props }: SwitchProps) {
	// biome-ignore-start lint/a11y/useAriaPropsForRole: native checkbox supplies switch state
	return (
		<label className={clsx(switchRootClassName, className)}>
			<input
				type="checkbox"
				role="switch"
				className="peer sr-only"
				{...props}
			/>
			<span className={switchIndicatorClassName}>
				<span className={switchThumbClassName} />
			</span>
			<span className={switchLabelClassName}>{label}</span>
		</label>
	);
	// biome-ignore-end lint/a11y/useAriaPropsForRole: native checkbox supplies switch state
}
