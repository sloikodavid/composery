import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

/** Clerk's own theme variables are set in app/clerk.css. */
export function ClerkClientProvider({ children }: { children: ReactNode }) {
	return (
		<ClerkProvider
			appearance={{
				cssLayerName: "clerk",
				elements: {
					avatarBox: "rounded-none",
					userButtonTrigger: "rounded-none",
				},
			}}
			localization={{
				userProfile: {
					deletePage: {
						messageLine2:
							"All owned servers will be deleted. You cannot undo this.",
					},
				},
			}}
		>
			{children}
		</ClerkProvider>
	);
}
