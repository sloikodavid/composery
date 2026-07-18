"use client";

import { useId } from "react";
import { ICON_SVG, ICON_VIEWBOX } from "shared";

export { ICON_SVG };

export function Icon({ className }: { className?: string }) {
	const maskId = useId().replace(/[^A-Za-z0-9_-]/g, "");
	const inner = ICON_SVG.replaceAll("composery-icon-holes", maskId);

	return (
		<svg
			className={className}
			dangerouslySetInnerHTML={{ __html: inner }}
			fill="none"
			viewBox={ICON_VIEWBOX}
			xmlns="http://www.w3.org/2000/svg"
		/>
	);
}
