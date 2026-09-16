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
import {
	findWaiver,
	listStaleWaiverProblems,
	toMovedClaimProblem,
	toWaiverKey,
	type Waiver,
} from "./waiver";

const statusesPerRange = 100;

/**
 * Holds what we send, and what a fake answers, to an outside system's own published description.
 * Checking is synchronous on purpose: a test oracle that resolves later can be lost when a run
 * ends, and an oracle that might not have run is worse than none.
 */

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
 * Reads the pinned description that `scripts/contracts/` wrote beside a checker. The caller gives
 * its own `import.meta.url`, so nothing here depends on one runtime's way of naming a folder.
 */
export function readContract(moduleUrl: string): Contract {
	return JSON.parse(
		readFileSync(new URL("contract.json", moduleUrl), "utf8"),
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
