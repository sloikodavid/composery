"use client";

import { useTheme } from "next-themes";
import { useRef } from "react";
import { Button } from "@/components/button";
import {
	SunMoonIcon,
	type SunMoonIconHandle
} from "@/components/icons/sun-moon";

export function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	const iconRef = useRef<SunMoonIconHandle>(null);

	return (
		<Button
			aria-label="Toggle theme"
			onClick={() => {
				iconRef.current?.startAnimation();
				setTheme(resolvedTheme === "dark" ? "light" : "dark");
			}}
			size="icon"
			type="button"
			variant="ghost"
		>
			<SunMoonIcon className="size-4" ref={iconRef} size={16} />
		</Button>
	);
}
