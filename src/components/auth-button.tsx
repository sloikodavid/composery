"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import {
	Button,
	type ButtonSize,
	type ButtonVariant,
} from "@/components/ui/button";

const signedOutLabels = {
	"sign-in": "Sign in",
	"sign-up": "Get started",
} as const;

type AuthButtonProps = {
	intent: keyof typeof signedOutLabels;
	variant?: ButtonVariant | undefined;
	size?: ButtonSize | undefined;
	className?: string | undefined;
};

export function AuthButton({
	intent,
	variant,
	size,
	className,
}: AuthButtonProps) {
	const { isLoaded, isSignedIn } = useAuth();
	const clerk = useClerk();

	function open() {
		if (isSignedIn) {
			clerk.openUserProfile();
			return;
		}
		// The sign-in page also signs up new users, so both intents open it.
		clerk.redirectToSignIn().catch((error: unknown) => {
			console.error("Could not open the sign-in page.", error);
		});
	}

	return (
		<Button
			variant={variant}
			size={size}
			disabled={!isLoaded}
			aria-busy={!isLoaded}
			onClick={open}
			className={className}
		>
			<span className="grid *:[grid-area:1/1]">
				<span className={isSignedIn ? "invisible" : undefined}>
					{signedOutLabels[intent]}
				</span>
				<span className={isSignedIn ? undefined : "invisible"}>Account</span>
			</span>
		</Button>
	);
}
