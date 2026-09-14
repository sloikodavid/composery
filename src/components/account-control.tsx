"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import clsx from "clsx";
import { AuthButton } from "@/components/auth-button";

// Both controls share one grid cell, so the header keeps its size while Clerk loads and when the user signs in or out.
export function AccountControl() {
	const { isSignedIn } = useAuth();

	return (
		<div className="grid items-center justify-items-end *:[grid-area:1/1]">
			<div className={clsx(isSignedIn && "invisible")}>
				<AuthButton intent="sign-in" />
			</div>
			<div className={clsx("flex", !isSignedIn && "invisible")}>
				<UserButton />
			</div>
		</div>
	);
}
