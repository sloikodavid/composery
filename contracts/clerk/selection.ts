import type { Selection } from "../selection";

/**
 * What Composery depends on at Clerk. The backend version is the one `@clerk/backend` sends in
 * its `Clerk-API-Version` header, so the pin follows the installed package rather than a guess;
 * the fake refuses a request that carries a different version.
 */
export const clerkApiVersion = "2026-05-12";

export const clerkSelection: Selection = {
	system: "Clerk",
	documents: [
		{
			source: `https://raw.githubusercontent.com/clerk/openapi-specs/main/bapi/${clerkApiVersion}.yml`,
			holder: "paths",
			operations: {
				// `getUserList` asks for the page and the count together, so both are ours.
				"/users": ["get"],
				"/users/count": ["get"],
				"/users/{user_id}": ["get"],
			},
		},
		{
			source:
				"https://raw.githubusercontent.com/clerk/openapi-specs/main/webhooks/2025-04-15.yml",
			holder: "x-webhooks",
			operations: {
				"user.created": ["post"],
				"user.updated": ["post"],
				"user.deleted": ["post"],
			},
		},
	],
};
