import clsx from "clsx";
import { type ComponentProps, type ReactNode, useId } from "react";
import { panelClassName } from "@/components/ui/card";
import { FieldDescription, FieldMessage } from "@/components/ui/field";
import { fullRadiusClassName } from "@/components/ui/interaction";

export const radioGroupClassName =
	"grid gap-3 [&>div:has(:disabled)]:opacity-50";
export const radioGroupItemClassName = `${panelClassName} flex items-start border border-border bg-background p-3 shadow-none`;
export const radioInputClassName = `${fullRadiusClassName} peer relative mt-0.5 size-4 shrink-0 appearance-none border border-border bg-background text-primary shadow-none before:absolute before:inset-[0.1875rem] before:rounded-full before:bg-current before:opacity-0 before:content-[''] checked:border-control-border-active checked:bg-background checked:text-primary checked:before:opacity-100 focus:ring-0 focus-visible:ring-0 disabled:pointer-events-none aria-invalid:border-danger aria-invalid:checked:border-danger`;
export const radioLabelClassName =
	"grid min-w-0 flex-1 cursor-pointer gap-1 ps-2 text-sm peer-disabled:cursor-default";
export const radioLabelTitleClassName = "font-brand text-foreground";

export type RadioOption = {
	description?: ReactNode | undefined;
	disabled?: boolean | undefined;
	label: ReactNode;
	value: string;
};

type RadioGroupBaseProps = Omit<
	ComponentProps<"fieldset">,
	"children" | "defaultValue" | "onChange"
> & {
	error?: ReactNode | undefined;
	label: ReactNode;
	name: string;
	options: readonly RadioOption[];
};

type RadioGroupSelectionProps =
	| {
			defaultValue?: string | undefined;
			onChange?: ComponentProps<"input">["onChange"] | undefined;
			value?: never;
	  }
	| {
			defaultValue?: never;
			onChange: NonNullable<ComponentProps<"input">["onChange"]>;
			value: string;
	  };

type RadioGroupProps = RadioGroupBaseProps & RadioGroupSelectionProps;

/** A native radio group whose label and error apply to every option. */
export function RadioGroup({
	className,
	defaultValue,
	disabled,
	error,
	id,
	label,
	name,
	onChange,
	options,
	value,
	...props
}: RadioGroupProps) {
	const generatedId = useId();
	const groupId = id ?? generatedId;
	const errorId = `${groupId}-error`;
	const hasError = error !== undefined && error !== null;
	return (
		<fieldset
			aria-describedby={hasError ? errorId : undefined}
			aria-invalid={hasError}
			className={clsx("grid content-start gap-2", className)}
			disabled={disabled}
			{...props}
		>
			<legend className="mb-2 text-sm">{label}</legend>
			<div className={radioGroupClassName}>
				{options.map((option, index) => {
					const optionId = `${groupId}-option-${index}`;
					return (
						<div key={option.value} className={radioGroupItemClassName}>
							<input
								id={optionId}
								name={name}
								type="radio"
								aria-invalid={hasError}
								checked={
									value === undefined ? undefined : value === option.value
								}
								defaultChecked={
									value === undefined
										? defaultValue === option.value
										: undefined
								}
								disabled={option.disabled}
								value={option.value}
								className={radioInputClassName}
								onChange={onChange}
							/>
							<label htmlFor={optionId} className={radioLabelClassName}>
								<span className={radioLabelTitleClassName}>{option.label}</span>
								{option.description !== undefined &&
								option.description !== null ? (
									<FieldDescription>{option.description}</FieldDescription>
								) : null}
							</label>
						</div>
					);
				})}
			</div>
			<FieldMessage id={errorId} reserveSpace variant="error">
				{error}
			</FieldMessage>
		</fieldset>
	);
}
