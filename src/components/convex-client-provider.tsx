"use client";

import { useAuth } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import {
	ConvexReactClient,
	useAction,
	useConvexAuth,
	useQuery,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { type ReactNode, useEffect } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
	throw new Error("NEXT_PUBLIC_CONVEX_URL is not set.");
}

const convex = new ConvexReactClient(convexUrl);

// Creates the signed-in user's row when the Clerk webhook has not done so yet.
function CurrentUserSync() {
	const { isAuthenticated } = useConvexAuth();
	const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");
	const syncCurrentUser = useAction(api.users.syncCurrentUser);

	useEffect(() => {
		if (user === null) {
			syncCurrentUser().catch((error: unknown) => {
				console.error("Could not sync the signed-in user.", error);
			});
		}
	}, [user, syncCurrentUser]);

	return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
	return (
		// biome-ignore lint/nursery/useReactCompiler: Convex's Clerk adapter takes the hook itself and calls it at its own top level.
		<ConvexProviderWithClerk client={convex} useAuth={useAuth}>
			<CurrentUserSync />
			{children}
		</ConvexProviderWithClerk>
	);
}
