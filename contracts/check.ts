import { readFileSync } from "node:fs";
import {
	type Contract,
	type ContractProblem,
	findPathTemplate,
	listMissingQueryProblems,
	listQueryValueProblems,
	listSchemaProblems,
	listUnreadFieldProblems,
	listUnreadQueryProblems,
	type Schema,
	toProblemText,
} from "./schema";

const statusesPerRange = 100;
const moduleSuffix = /\.ts$/;

/** Validates fake traffic against pinned external descriptions and checks waiver staleness. */
// Checks stay synchronous so a dropped async oracle cannot make a run pass silently.
export type Described = Readonly<{
	source: string;
	holder: string;
	operations: Record<string, readonly string[]>;
}>;

/** A waiver is a named, evidence-backed exception that must fail when its claim moves. */
export type Waiver = Readonly<{
	operation: string;
	at: string;
	claims: string;
	reason: string;
	evidence: string;
}>;

export function toWaiverKey(
	place: Readonly<{ operation: string; at: string }>,
) {
	return `${place.operation} ${place.at}`;
}

export function findWaiver(
	waivers: readonly Waiver[],
	problem: ContractProblem,
) {
	return waivers.find((waiver) => toWaiverKey(waiver) === toWaiverKey(problem));
}

export function toMovedClaimProblem(
	system: string,
	waiver: Waiver,
	claims: string,
) {
	return `The waiver for ${toWaiverKey(waiver)} says ${system} describes it as ${waiver.claims}, but the pinned contract now says ${claims}. Read the difference and rewrite or delete the waiver.`;
}

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
	listRequestProblems: (
		method: string,
		requested: string,
		body: unknown,
	) => string[];
	listReplyProblems: (
		method: string,
		requested: string,
		status: number,
		body: unknown,
	) => string[];
	noteProblem: (problem: string) => void;
	listProblems: () => string[];
}>;

export function readContract(moduleUrl: string): Contract {
	return JSON.parse(
		readFileSync(
			new URL(moduleUrl.replace(moduleSuffix, ".json"), moduleUrl),
			"utf8",
		),
	) as Contract;
}

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
			const problems = [
				...listMissingQueryProblems(subject, found.described.parameters, query),
				...listUnreadQueryProblems(subject, found.described.parameters, query),
				...listQueryValueProblems(subject, found.described.parameters, query),
			];
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
