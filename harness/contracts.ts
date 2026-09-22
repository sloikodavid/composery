import type { Fake } from "./fake";

/** Checks requests, replies, and waivers against each external contract. */
export function requireContractsKept(fakes: readonly Fake[]) {
	const problems = fakes.flatMap((fake) => fake.problems());
	if (problems.length > 0) {
		throw new Error(
			["A system and its own description disagree:", ...problems].join("\n"),
		);
	}
}
