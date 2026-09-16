import {
	createContractChecker,
	type Described,
	readContract,
	type Waiver,
} from "./check";

/**
 * The version of Clerk's backend API that `@clerk/backend` speaks, read from the installed
 * package. The fake refuses a request carrying any other, so an upgrade that moves it says so
 * instead of quietly leaving the pinned description behind.
 */
export const clerkApiVersion = "2026-05-12";

/** What Composery depends on at Clerk: what it reads, and the events it is sent. */
export const clerkDescribed: readonly Described[] = [
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
];

/**
 * Empty is the honest state until a run shows otherwise: a waiver is a claim about the running
 * system, and it is only written with the evidence that proves it.
 */
export const clerkWaivers: readonly Waiver[] = [];

/**
 * Holds the Clerk fake's replies, and the webhook bodies a test signs, to Clerk's own
 * descriptions. Clerk's SDK builds our requests, so the half worth checking is what we accept:
 * the SDK reads a reply without validating it, and an invented field would never be refused.
 */
export function createClerkContractChecker() {
	return createContractChecker({
		system: "Clerk",
		contract: readContract(import.meta.url),
		waivers: clerkWaivers,
	});
}

/** The one a run shares, so every request reaches the same record. */
export const clerkContract = createClerkContractChecker();
