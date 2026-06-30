"use client";

import Link from "next/link";
import { type ComponentProps, useId } from "react";
import { LOGO_INNER, LOGO_VIEWBOX } from "@/components/logo-data";
import { cn } from "@/lib/utils";

export function LogoLockup({ className }: { className?: string }) {
	const uid = useId().replace(/:/g, "");
	const html = LOGO_INNER.replace(/icon-/g, `${uid}-icon-`);

	return (
		<svg
			aria-hidden
			className={className}
			dangerouslySetInnerHTML={{ __html: html }}
			fill="none"
			viewBox={LOGO_VIEWBOX}
			xmlns="http://www.w3.org/2000/svg"
		/>
	);
}

export function Logo() {
	return (
		<Link
			aria-label="Composery"
			className="inline-flex text-foreground transition-colors hover:text-foreground/80"
			href="/"
		>
			<LogoLockup className="h-8 w-auto" />
		</Link>
	);
}

// fumadocs DocsLayout nav-title slot: spread its props so the `me-auto` it passes
// reaches the link (keeps the collapse button pushed to the end).
export function NavLogoLink({ className, ...props }: ComponentProps<"a">) {
	return (
		<Link
			{...props}
			aria-label="Composery"
			href="/"
			className={cn(
				"inline-flex text-foreground transition-colors hover:text-foreground/80",
				className
			)}
		>
			<LogoLockup className="h-7.5 w-auto" />
		</Link>
	);
}
