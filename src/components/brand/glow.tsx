import clsx from "clsx";

export function Glow({ className }: { className?: string | undefined }) {
	return (
		<div
			aria-hidden="true"
			className={clsx("pointer-events-none overflow-hidden", className)}
		>
			<div className="glow absolute -inset-24" />
		</div>
	);
}
