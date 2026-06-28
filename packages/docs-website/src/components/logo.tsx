"use client";

import { useId, type ComponentProps } from "react";
import { usePathname } from "next/navigation";
import Link from "fumadocs-core/link";
import { LOGO_INNER, LOGO_VIEWBOX } from "./logo-data";

export function LogoLockup({ className }: { className?: string }) {
	// Scope gradient ids per instance: Chrome drops a paint server inside the display:none mobile copy, blanking the visible icon.
	const uid = useId().replace(/[^a-z0-9]/gi, "");
	const inner = LOGO_INNER.replace(/icon-(\d)/g, `icon-${uid}-$1`);
	return (
		<svg
			aria-label="Composery"
			className={className}
			dangerouslySetInnerHTML={{ __html: inner }}
			fill="none"
			viewBox={LOGO_VIEWBOX}
			xmlns="http://www.w3.org/2000/svg"
		/>
	);
}

export function NavLogoLink(props: ComponentProps<"a">) {
	const onHome = usePathname() === "/";
	return (
		<Link {...props} href={onHome ? "https://www.composery.io" : "/"}>
			<LogoLockup className="h-6 w-auto" />
		</Link>
	);
}
