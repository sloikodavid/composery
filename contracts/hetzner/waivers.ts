import type { Waiver } from "../waiver";

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
