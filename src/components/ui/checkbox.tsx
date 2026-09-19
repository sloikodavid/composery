import { IconCheck } from "@tabler/icons-react";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { FieldDescription, FieldMessage } from "@/components/ui/field";

export const checkboxLabelClassName =
	"flex w-fit items-start gap-2 text-sm [&:has(:disabled)]:cursor-default [&:has(:disabled)>span]:opacity-50";
export const checkboxTextClassName = "grid min-w-0 gap-1";
const checkboxBoxClassName = "relative mt-0.5 size-4 shrink-0";
const checkboxInputClassName =
	"peer size-full appearance-none border border-border bg-background shadow-none checked:border-primary checked:bg-primary focus:ring-0 focus-visible:ring-0 disabled:pointer-events-none aria-invalid:border-danger aria-invalid:checked:border-danger";
const checkboxIconClassName =
	"pointer-events-none absolute inset-0.5 size-3 text-primary-foreground opacity-0 peer-checked:opacity-100";

type CheckboxProps = Omit<
	ComponentProps<"input">,
	"children" | "id" | "type"
> & {
	description?: ReactNode | undefined;
	error?: ReactNode | undefined;
	id: string;
	label: ReactNode;
};

/** A native checkbox with a label, optional help, and a stable message row. */
export function Checkbox({
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	className,
	description,
	error,
	id,
	label,
	...props
}: CheckboxProps) {
	const hasError = error !== undefined && error !== null;
	const hasDescription = description !== undefined && description !== null;
	const descriptionId = hasDescription ? `${id}-description` : undefined;
	const errorId = `${id}-error`;
	const describedBy = [
		ariaDescribedBy,
		descriptionId,
		hasError ? errorId : undefined,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div className="grid content-start gap-2">
			<label className={checkboxLabelClassName}>
				<span className={checkboxBoxClassName}>
					<input
						id={id}
						type="checkbox"
						aria-describedby={describedBy || undefined}
						aria-invalid={hasError ? true : ariaInvalid}
						className={clsx(checkboxInputClassName, className)}
						{...props}
					/>
					<IconCheck aria-hidden="true" className={checkboxIconClassName} />
				</span>
				<span className={checkboxTextClassName}>
					<span>{label}</span>
					{hasDescription ? (
						<FieldDescription id={descriptionId}>
							{description}
						</FieldDescription>
					) : null}
				</span>
			</label>
			<FieldMessage id={errorId} reserveSpace variant="error">
				{error}
			</FieldMessage>
		</div>
	);
}
