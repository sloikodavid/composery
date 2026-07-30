import type { ComponentProps, PropsWithChildren, ReactElement } from "react";

export function Dialog({
	children,
	open
}: PropsWithChildren<{ open: boolean }>) {
	return open ? <div role="dialog">{children}</div> : null;
}

export function DialogClose({ render }: { render: ReactElement }) {
	return render;
}

export function DialogContent({ children }: PropsWithChildren) {
	return <div>{children}</div>;
}

export function DialogDescription({ children }: PropsWithChildren) {
	return <p>{children}</p>;
}

export function DialogFooter({ children }: PropsWithChildren) {
	return <div>{children}</div>;
}

export function DialogHeader({ children }: PropsWithChildren) {
	return <div>{children}</div>;
}

export function DialogTitle({ children }: PropsWithChildren) {
	return <h2>{children}</h2>;
}

export function Button({
	size: _size,
	variant: _variant,
	...props
}: ComponentProps<"button"> & { size?: string; variant?: string }) {
	void _size;
	void _variant;
	return <button {...props} />;
}

export function AnimatedIconButton({
	icon: _icon,
	iconPosition: _iconPosition,
	size: _size,
	variant: _variant,
	...props
}: ComponentProps<"button"> & {
	icon: string;
	iconPosition?: string;
	size?: string;
	variant?: string;
}) {
	void _icon;
	void _iconPosition;
	void _size;
	void _variant;
	return <button {...props} />;
}

export function Input(props: ComponentProps<"input">) {
	return <input {...props} />;
}

export function Badge({ children }: PropsWithChildren<{ variant?: string }>) {
	return <span>{children}</span>;
}

export function ToneIcon({ tone }: { tone: string }) {
	return <span data-tone={tone} />;
}

export function StatusButton({
	action,
	status
}: {
	action?: {
		disabled?: boolean;
		label: string;
		onClick: () => void;
	};
	status: string;
}) {
	return (
		<button
			disabled={action ? action.disabled : true}
			onClick={action?.onClick}
		>
			{action?.label ?? status}
		</button>
	);
}
