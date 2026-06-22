"use client";

import { useId, type ComponentProps } from "react";
import { usePathname } from "next/navigation";
import Link from "fumadocs-core/link";
import { LOGO_INNER, LOGO_VIEWBOX } from "./logo-data";

// The Composery lockup as a bare SVG, matching composery-web. The wordmark is
// fill="currentColor", so it follows the surrounding text color; the icon keeps
// its amber gradient. Sized by height, width follows the viewBox aspect ratio.
export function LogoLockup({ className }: { className?: string }) {
	// fumadocs renders the lockup twice (mobile nav + desktop sidebar), so the
	// shared "icon-1/2/3" gradient ids collide. The first copy lives in the
	// md:hidden mobile nav, and Chrome drops a paint server inside display:none -
	// so the visible copy's amber icon vanishes. Scope the ids per instance.
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

// The nav lockup links home from any docs page, and only leaves for the
// marketing site once you're already on the docs home - so the first click
// never drops you out of the docs.
export function NavLogoLink(props: ComponentProps<"a">) {
	const onHome = usePathname() === "/";
	return (
		<Link {...props} href={onHome ? "https://www.composery.io" : "/"}>
			<LogoLockup className="h-6 w-auto" />
		</Link>
	);
}
