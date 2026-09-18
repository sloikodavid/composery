import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";

const whitespacePattern = /\s+/;

type InputFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
	id: string;
	label: ReactNode;
	description?: string | undefined;
	error?: string | undefined;
};

/** A labeled input with one stable message row for help or validation. */
export function InputField({
	id,
	label,
	description,
	error,
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	...inputProps
}: InputFieldProps) {
	const hasError = Boolean(error);
	const hasDescription = Boolean(description);
	const hasMessage = hasError || hasDescription;
	const messageId = `${id}Message`;
	const describedBy = [
		...new Set(
			[ariaDescribedBy, hasMessage ? messageId : undefined].flatMap(
				(value) => value?.split(whitespacePattern).filter(Boolean) ?? [],
			),
		),
	].join(" ");

	return (
		<div className="grid content-start gap-2">
			<label htmlFor={id} className="text-sm">
				{label}
			</label>
			<Input
				{...inputProps}
				id={id}
				aria-describedby={describedBy || undefined}
				aria-invalid={hasError ? true : ariaInvalid}
			/>
			<p
				id={hasMessage ? messageId : undefined}
				aria-atomic="true"
				aria-live="polite"
				className={clsx(
					"min-h-4 text-xs",
					hasError ? "text-danger" : "text-muted",
				)}
			>
				{hasError ? error : description}
			</p>
		</div>
	);
}
