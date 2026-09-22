import { createContractChecker, readContract, type Waiver } from "./check";
import type { Contract, Described } from "./openapi";

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
		"/firewalls": ["get", "post"],
		"/firewalls/{id}": ["get"],
		"/firewalls/{id}/actions/set_rules": ["post"],
		"/firewalls/{id}/actions/apply_to_resources": ["post"],
		"/server_types": ["get"],
		"/images": ["get"],
	},
};

export const hetznerWaivers: readonly Waiver[] = [
	{
		operation: "POST /servers",
		at: "body.image",
		keyword: "type",
		claims: '"string"',
		accepts: (value) =>
			typeof value === "number" && Number.isSafeInteger(value) && value > 0,
		reason: "Hetzner reads an ID here as well as a name",
		evidence:
			"Hetzner's own Go client marshals an ID as a number (IDOrName.MarshalJSON), and servers were created this way against real Hetzner from this repository",
	},
];

export function createHetznerContractChecker(
	contract: Contract = readContract(import.meta.url),
) {
	return createContractChecker({
		system: "Hetzner",
		contract,
		waivers: hetznerWaivers,
		// Hetzner publishes decimal as a format annotation without a validation rule.
		annotationFormats: ["decimal"],
	});
}
