import { clerkContract } from "../contracts/clerk";
import { hetznerContract } from "../contracts/hetzner";

/** Checks requests, replies, and waivers against each external contract. */
export function requireContractsKept() {
	const problems = [
		...hetznerContract.listProblems(),
		...clerkContract.listProblems(),
	];
	if (problems.length > 0) {
		throw new Error(
			["A system and its own description disagree:", ...problems].join("\n"),
		);
	}
}
