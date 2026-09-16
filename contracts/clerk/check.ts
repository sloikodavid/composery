import { createContractChecker, readContract } from "../check";
import { clerkSelection } from "./selection";
import { clerkWaivers } from "./waivers";

/**
 * Holds the Clerk fake's replies, and the webhook bodies a test signs, to Clerk's own
 * descriptions. Clerk's SDK builds our requests, so the half worth checking is what we accept:
 * the SDK reads a reply without validating it, and an invented field would never be refused.
 */
export function createClerkContractChecker() {
	return createContractChecker({
		system: clerkSelection.system,
		contract: readContract(import.meta.url),
		waivers: clerkWaivers,
	});
}

/** The one a run shares, so every request reaches the same record. */
export const clerkContract = createClerkContractChecker();
