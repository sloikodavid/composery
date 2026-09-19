import {
	createContractChecker,
	type Described,
	readContract,
	type Waiver,
} from "./check";

// Must match @clerk/backend; the fake rejects requests for another API version.
export const clerkApiVersion = "2026-05-12";

export const clerkDescribed: readonly Described[] = [
	{
		source: `https://raw.githubusercontent.com/clerk/openapi-specs/main/bapi/${clerkApiVersion}.yml`,
		holder: "paths",
		operations: {
			"/users/count": ["get"],
			"/users/{user_id}": ["get"],
			"/jwks": ["get"],
			"/users": ["get", "post"],
			"/sessions": ["post"],
			"/sessions/{session_id}/tokens": ["post"],
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
];

export const clerkWaivers: readonly Waiver[] = [];

export function createClerkContractChecker() {
	return createContractChecker({
		system: "Clerk",
		contract: readContract(import.meta.url),
		waivers: clerkWaivers,
	});
}

export const clerkContract = createClerkContractChecker();
