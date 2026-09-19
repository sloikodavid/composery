import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import {
	inputControlClassName,
	inputFrameClassName,
} from "@/components/ui/input";

export const inputGroupClassName = `${inputFrameClassName} flex h-9 w-full items-stretch aria-invalid:border-danger data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[invalid=true]:border-danger data-[invalid=true]:focus-within:border-danger [&>input]:min-w-0 [&>input]:flex-1 [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-1.5 [&>input]:shadow-none [&>input]:focus:border-0 [&>span]:flex [&>span]:shrink-0 [&>span]:select-none [&>span]:items-center [&>span]:px-1.5 [&>span]:text-muted [&>span]:text-sm [&>span:first-child]:ps-3 [&>span:last-child]:pe-3`;
export const inputGroupControlClassName = `${inputControlClassName} min-w-0 flex-1 px-1.5 text-sm disabled:opacity-100`;

type InputGroupProps = Omit<ComponentProps<"input">, "className" | "prefix"> & {
	className?: string | undefined;
	controlClassName?: string | undefined;
	prefix?: ReactNode | undefined;
	suffix?: ReactNode | undefined;
};

export function InputGroup({
	"aria-invalid": ariaInvalid,
	className,
	controlClassName,
	disabled,
	prefix,
	ref,
	suffix,
	type = "text",
	...props
}: InputGroupProps) {
	const isInvalid = ariaInvalid === true || ariaInvalid === "true";
	return (
		<div
			data-disabled={disabled || undefined}
			data-invalid={isInvalid || undefined}
			className={clsx(inputGroupClassName, className)}
		>
			{prefix !== undefined && prefix !== null ? <span>{prefix}</span> : null}
			<input
				ref={ref}
				aria-invalid={ariaInvalid}
				disabled={disabled}
				type={type}
				className={clsx(inputGroupControlClassName, controlClassName)}
				{...props}
			/>
			{suffix !== undefined && suffix !== null ? <span>{suffix}</span> : null}
		</div>
	);
}
