import { createContractChecker, readContract } from "../check";
import { hetznerSelection } from "./selection";
import { hetznerWaivers } from "./waivers";

/** Holds Composery's requests, and the Hetzner fake's replies, to Hetzner's own description. */
export function createHetznerContractChecker() {
	return createContractChecker({
		system: hetznerSelection.system,
		contract: readContract(import.meta.url),
		waivers: hetznerWaivers,
	});
}

/** The one a run shares, so every request reaches the same record. */
export const hetznerContract = createHetznerContractChecker();
