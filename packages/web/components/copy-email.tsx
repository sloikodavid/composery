"use client";

import { toast } from "sonner";
import { SUPPORT_EMAIL } from "@/lib/links";
import { cn } from "@/lib/utils";

// Copies the support email instead of opening a mail client - mailto links
// dead-end on machines without one configured, and copying feeds whichever
// mail app the visitor actually uses.
export function CopyEmail({
	className,
	label = SUPPORT_EMAIL,
	message = "Email copied"
}: {
	className?: string;
	label?: string;
	message?: string;
}) {
	return (
		<button
			className={cn("cursor-pointer", className)}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(SUPPORT_EMAIL);
					toast.success(message);
				} catch {
					toast.error("Couldn't copy");
				}
			}}
			type="button"
		>
			{label}
		</button>
	);
}
