import { clerkContract } from "../../contracts/clerk";
import { hetznerContract } from "../../contracts/hetzner";

/**
 * Fails the run when a fake answered in a shape the system never would, when Composery spoke to a
 * system in a way that system describes otherwise, or when a waiver stopped holding. It is read
 * once for the whole run, because the test that makes a request is rarely the one that would read
 * the answer.
 */
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
