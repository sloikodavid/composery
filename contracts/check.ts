import { readFileSync } from "node:fs";
import {
	type Contract,
	type ContractProblem,
	findPathTemplate,
	listSchemaProblems,
	listUnreadFieldProblems,
	listUnreadQueryProblems,
	type Schema,
	toProblemText,
} from "./schema";

const statusesPerRange = 100;
const moduleSuffix = /\.ts$/;

/**
 * Holds what we send, and what a fake answers, to an outside system's own published description.
 * Checking is synchronous on purpose: a test oracle that resolves later can be lost when a run
 * ends, and an oracle that might not have run is worse than none.
 */

/** Where a system publishes what it does, and which of it we depend on. */
export type Described = Readonly<{
	/** Where the published description is fetched from. */
	source: string;
	/**
	 * The member that holds the operations. OpenAPI puts them in `paths`; a system may publish its
	 * events elsewhere, as Clerk does in `x-webhooks`.
	 */
	holder: string;
	/** Every operation we depend on, by the path and method the description names. */
	operations: Record<string, readonly string[]>;
}>;

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

export type ContractChecker = Readonly<{
	/** What is wrong with a request we send. This is the half that checks our own code. */
	listRequestProblems: (
		method: string,
		requested: string,
		body: unknown,
	) => string[];
	/** What is wrong with a reply, against the description of that request. */
	listReplyProblems: (
		method: string,
		requested: string,
		status: number,
		body: unknown,
	) => string[];
	/** Anything else a caller noticed about this system, such as a promise its own client makes. */
	noteProblem: (problem: string) => void;
	/**
	 * Everything this run found, including every way a waiver stopped holding. The checker keeps
	 * what it sees, because the caller that makes a request is rarely the one that would read the
	 * answer. Read once, after everything has run.
	 */
	listProblems: () => string[];
}>;

/**
 * Reads the pinned description that `scripts/contracts.ts` wrote beside this file. The caller
 * gives its own `import.meta.url`, so nothing depends on one runtime's way of naming a folder.
 */
export function readContract(moduleUrl: string): Contract {
	return JSON.parse(
		readFileSync(
			new URL(moduleUrl.replace(moduleSuffix, ".json"), moduleUrl),
			"utf8",
		),
	) as Contract;
}

/**
 * The description of one reply. OpenAPI names a status exactly, or a range such as `4xx`, or
 * `default` for everything it does not name, and the narrowest of those wins.
 */
function findResponse(responses: Record<string, Schema>, status: number) {
	const exact = responses[String(status)];
	if (exact !== undefined) {
		return exact;
	}
	const range = responses[`${Math.floor(status / statusesPerRange)}xx`];
	return range ?? responses.default;
}

export function createContractChecker(
	options: Readonly<{
		system: string;
		contract: Contract;
		waivers: readonly Waiver[];
	}>,
): ContractChecker {
	const { system, contract, waivers } = options;
	const templates = Object.keys(contract.paths);
	const seen = new Set<string>();
	const used = new Set<string>();
	const ranOperations = new Set<string>();

	const keep = (problems: readonly string[]) => {
		for (const problem of problems) {
			seen.add(problem);
		}
		return [...problems];
	};

	const find = (method: string, requested: string) => {
		const template = findPathTemplate(templates, requested);
		if (template === undefined) {
			return { operation: `${method} ${requested}` } as const;
		}
		const operation = `${method} ${template}`;
		const described = contract.paths[template]?.[method.toLowerCase()];
		return described === undefined
			? ({ operation } as const)
			: ({ operation, described } as const);
	};

	/**
	 * True when a waiver already accounts for this problem. A waiver that names a claim the
	 * description no longer makes excuses nothing, and says so instead.
	 */
	const isWaived = (problem: ContractProblem) => {
		const waiver = findWaiver(waivers, problem);
		if (waiver === undefined) {
			return false;
		}
		if (waiver.claims !== problem.claims) {
			keep([toMovedClaimProblem(system, waiver, problem.claims)]);
			return false;
		}
		used.add(toWaiverKey(waiver));
		return true;
	};

	const report = (problems: readonly ContractProblem[]) =>
		keep(problems.filter((problem) => !isWaived(problem)).map(toProblemText));

	const missing = (operation: string) =>
		keep([`${system} does not describe ${operation}`]);

	return {
		listRequestProblems: (method, requested, body) => {
			const found = find(method, requested);
			if (found.described === undefined) {
				return missing(found.operation);
			}
			ranOperations.add(found.operation);
			const subject = { system, operation: found.operation };
			const query = new URLSearchParams(requested.split("?")[1] ?? "");
			const problems = listUnreadQueryProblems(
				subject,
				found.described.parameters,
				query,
			);
			if (body !== undefined) {
				const { request } = found.described;
				problems.push(
					...listSchemaProblems(subject, request, body, "body"),
					...listUnreadFieldProblems(subject, request, body),
				);
			}
			return report(problems);
		},

		listReplyProblems: (method, requested, status, body) => {
			const found = find(method, requested);
			if (found.described === undefined) {
				return missing(found.operation);
			}
			ranOperations.add(found.operation);
			const schema = findResponse(found.described.responses, status);
			if (schema === undefined) {
				return keep([
					`${system} does not describe a ${status} for ${found.operation}`,
				]);
			}
			return report(
				listSchemaProblems(
					{ system, operation: found.operation },
					schema,
					body,
					String(status),
				),
			);
		},

		noteProblem: (problem) => {
			seen.add(problem);
		},

		listProblems: () => [
			...seen,
			...listStaleWaiverProblems({ waivers, system, used, ranOperations }),
		],
	};
}
