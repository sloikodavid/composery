import {
	createContractChecker,
	type Described,
	readContract,
	type Waiver,
} from "./check";

/** Every request Composery sends to Hetzner, by the path and method it sends it with. */
export const hetznerDescribed: Described = {
	source: "https://docs.hetzner.cloud/cloud.spec.json",
	holder: "paths",
	operations: {
		"/servers": ["get", "post"],
		"/servers/{id}": ["get", "delete"],
		"/servers/{id}/actions/poweron": ["post"],
		"/servers/{id}/actions/shutdown": ["post"],
		"/servers/{id}/actions/poweroff": ["post"],
		"/primary_ips": ["get", "post"],
		"/primary_ips/{id}": ["get", "delete"],
		"/actions/{id}": ["get"],
		"/firewalls/{id}": ["get"],
		"/server_types": ["get"],
		"/images": ["get"],
	},
};

/**
 * Where Hetzner and Hetzner's description of itself disagree. Each entry must be able to fail:
 * `claims` is what the pinned contract says today, so a correction upstream stops the waiver from
 * applying and asks for review.
 */
export const hetznerWaivers: readonly Waiver[] = [
	{
		operation: "POST /servers",
		at: "body.image",
		claims: "string",
		reason: "Hetzner reads an ID here as well as a name",
		evidence:
			"Hetzner's own Go client marshals an ID as a number (IDOrName.MarshalJSON), and servers were created this way against real Hetzner from this repository",
	},
];

/** Holds Composery's requests, and the Hetzner fake's replies, to Hetzner's own description. */
export function createHetznerContractChecker() {
	return createContractChecker({
		system: "Hetzner",
		contract: readContract(import.meta.url),
		waivers: hetznerWaivers,
	});
}

/** The one a run shares, so every request reaches the same record. */
export const hetznerContract = createHetznerContractChecker();
