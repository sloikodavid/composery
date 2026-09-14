"use client";

import { UserButton, useAuth, useClerk } from "@clerk/nextjs";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";

// The sign-in button and Clerk's user button share one grid cell, so the header keeps its size while Clerk loads and when the user signs in or out.
export function UserControl() {
	const { isLoaded, isSignedIn } = useAuth();
	const clerk = useClerk();

	function redirectToSignIn() {
		clerk.redirectToSignIn().catch((error: unknown) => {
			console.error("Could not open the sign-in page.", error);
			toastManager.add({
				title: "Could not open the sign-in page",
				description: "Try again.",
			});
		});
	}

	return (
		<div className="grid items-center justify-items-end *:[grid-area:1/1]">
			<Button
				disabled={!isLoaded}
				aria-busy={!isLoaded}
				onClick={redirectToSignIn}
				className={clsx(isSignedIn && "invisible")}
			>
				Sign in
			</Button>
			<div className={clsx("flex", !isSignedIn && "invisible")}>
				<UserButton />
			</div>
		</div>
	);
}
