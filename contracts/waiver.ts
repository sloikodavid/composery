import type { ContractProblem } from "./schema";

/**
 * A named, falsifiable exception to a contract. A published description is a system's word about
 * itself, not the system: where running it says otherwise, running wins. A waiver records that one
 * disagreement with its evidence, and it must be able to fail.
 *
 * It fails in two ways, so it can never quietly become a permanent ignore: the description at that
 * place stops saying what the waiver says it says, or the operation runs and the difference no
 * longer appears. A waiver whose operation did not run is not judged, because a run of part of the
 * suite proves nothing about it; that a waiver is still needed at all is proved separately, by the
 * reproducer each one carries in `tests/contracts/`.
 */
export type Waiver = Readonly<{
	/** The operation the description names: `POST /servers`. */
	operation: string;
	/** The place inside it, as a problem words it: `body.image`. */
	at: string;
	/** What the description says there. When this stops matching, the waiver is reviewed. */
	claims: string;
	/** Why the system disagrees with its own description. */
	reason: string;
	/** What proves it: a run, the system's own client, a published issue. */
	evidence: string;
}>;

/** How one place inside one operation is named, so a waiver and a problem meet exactly. */
export function toWaiverKey(
	place: Readonly<{ operation: string; at: string }>,
) {
	return `${place.operation} ${place.at}`;
}

/** The waiver written for the place a problem is about, if there is one. */
export function findWaiver(
	waivers: readonly Waiver[],
	problem: ContractProblem,
) {
	return waivers.find((waiver) => toWaiverKey(waiver) === toWaiverKey(problem));
}

/** What to say when a waiver names a claim the pinned description no longer makes. */
export function toMovedClaimProblem(
	system: string,
	waiver: Waiver,
	claims: string,
) {
	return `The waiver for ${toWaiverKey(waiver)} says ${system} describes it as ${waiver.claims}, but the pinned contract now says ${claims}. Read the difference and rewrite or delete the waiver.`;
}

/** Every waiver whose operation ran without the difference it excuses appearing. */
export function listStaleWaiverProblems(
	options: Readonly<{
		waivers: readonly Waiver[];
		system: string;
		used: ReadonlySet<string>;
		ranOperations: ReadonlySet<string>;
	}>,
) {
	return options.waivers
		.filter(
			(waiver) =>
				!options.used.has(toWaiverKey(waiver)) &&
				options.ranOperations.has(waiver.operation),
		)
		.map(
			(waiver) =>
				`The waiver for ${toWaiverKey(waiver)} is stale: ${waiver.operation} ran and ${options.system} no longer disagrees with its description. Delete the waiver.`,
		);
}
