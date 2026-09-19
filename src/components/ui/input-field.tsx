import type { ComponentProps, ReactNode } from "react";
import { Field, FieldLabel, FieldMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const whitespacePattern = /\s+/;

type InputFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
	id: string;
	label: ReactNode;
	description?: ReactNode | undefined;
	error?: ReactNode | undefined;
};

export function InputField({
	id,
	label,
	description,
	error,
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	...inputProps
}: InputFieldProps) {
	const hasError = error !== undefined && error !== null;
	const hasDescription = description !== undefined && description !== null;
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
		<Field>
			<FieldLabel data-disabled={inputProps.disabled || undefined} htmlFor={id}>
				{label}
			</FieldLabel>
			<Input
				{...inputProps}
				id={id}
				aria-describedby={describedBy || undefined}
				aria-invalid={hasError ? true : ariaInvalid}
			/>
			<FieldMessage
				id={hasMessage ? messageId : undefined}
				reserveSpace
				variant={hasError ? "error" : "info"}
			>
				{hasError ? error : description}
			</FieldMessage>
		</Field>
	);
}
