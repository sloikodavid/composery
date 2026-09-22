import { readFileSync } from "node:fs";
import {
	type Contract,
	type ContractProblem,
	findOpenApiPath,
	listOpenApiBodyProblems,
	listOpenApiParameterProblems,
	type OpenApiOperation,
	readOpenApiOperations,
} from "./openapi";

const statusesPerRange = 100;
const moduleSuffix = /\.ts$/;

/** Limits an observed contract difference to the values the external system accepts. */
export type Waiver = Readonly<{
	operation: string;
	at: string;
	keyword: string;
	claims: string;
	accepts: (value: unknown) => boolean;
	reason: string;
	evidence: string;
}>;

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

export function toWaiverKey(
	place: Pick<Waiver, "operation" | "at" | "keyword">,
) {
	return `${place.operation} ${place.at} ${place.keyword}`;
}

export function readContract(moduleUrl: string): Contract {
	return JSON.parse(
		readFileSync(
			new URL(moduleUrl.replace(moduleSuffix, ".json"), moduleUrl),
			"utf8",
		),
	) as Contract;
}

/** Checks stay synchronous so an unobserved promise cannot hide a failed check. */
export function createContractChecker(
	options: Readonly<{
		system: string;
		contract: Contract;
		waivers: readonly Waiver[];
		annotationFormats?: readonly string[];
	}>,
): ContractChecker {
	const { system, contract, waivers } = options;
	const paths = new Map<string, Map<string, OpenApiOperation>>();
	for (const source of contract.sources) {
		for (const { path, method, described } of readOpenApiOperations(
			source,
			options.annotationFormats,
		)) {
			let methods = paths.get(path);
			if (methods === undefined) {
				methods = new Map();
				paths.set(path, methods);
			}
			if (methods.has(method)) {
				throw new Error(`The contract repeats ${method} ${path}.`);
			}
			methods.set(method, described);
		}
	}
	const templates = [...paths.keys()];
	const seen = new Set<string>();
	const used = new Set<string>();
	const ranOperations = new Set<string>();
	const exceptions = new Map(
		waivers.map((waiver) => [toWaiverKey(waiver), waiver]),
	);
	if (exceptions.size !== waivers.length) {
		throw new Error("A contract waiver is repeated.");
	}
	const keep = (problems: readonly string[]) => {
		for (const problem of problems) {
			seen.add(problem);
		}
		return [...problems];
	};
	const report = (problems: readonly ContractProblem[]) =>
		keep(
			problems.flatMap((problem) => {
				const key = toWaiverKey(problem);
				const waiver = exceptions.get(key);
				if (waiver !== undefined) {
					if (waiver.claims !== problem.claims) {
						return [
							`The waiver for ${key} has changed: ${system} now describes ${problem.claims}. Review or delete the waiver.`,
						];
					}
					if (waiver.accepts(problem.value)) {
						used.add(key);
						return [];
					}
				}
				return [`${problem.operation} ${problem.at} ${problem.message}`];
			}),
		);
	const find = (method: string, requested: string) => {
		const template = findOpenApiPath(templates, requested);
		const operation = `${method.toUpperCase()} ${template ?? requested}`;
		const described =
			template === undefined
				? undefined
				: paths.get(template)?.get(method.toUpperCase());
		if (described !== undefined) {
			ranOperations.add(operation);
		}
		return { operation, described };
	};
	const missing = (operation: string) =>
		keep([`${system} does not describe ${operation}`]);
	return {
		listRequestProblems: (method, requested, body) => {
			const found = find(method, requested);
			if (found.described === undefined) {
				return missing(found.operation);
			}
			return report([
				...listOpenApiParameterProblems(
					found.operation,
					found.described.parameters,
					requested,
				),
				...listOpenApiBodyProblems({
					operation: found.operation,
					at: "body",
					body: found.described.request,
					value: body,
					isReply: false,
				}),
			]);
		},
		listReplyProblems: (method, requested, status, body) => {
			const found = find(method, requested);
			if (found.described === undefined) {
				return missing(found.operation);
			}
			const responses = found.described.responses;
			const described =
				responses.get(String(status)) ??
				responses.get(`${Math.floor(status / statusesPerRange)}XX`) ??
				responses.get("DEFAULT");
			if (described === undefined) {
				return keep([
					`${system} does not describe a ${status} for ${found.operation}`,
				]);
			}
			return report(
				listOpenApiBodyProblems({
					operation: found.operation,
					at: String(status),
					body: described,
					value: body,
					isReply: true,
				}),
			);
		},
		noteProblem: (problem) => {
			seen.add(problem);
		},
		listProblems: () => [
			...seen,
			...waivers
				.filter(
					(waiver) =>
						ranOperations.has(waiver.operation) &&
						!used.has(toWaiverKey(waiver)),
				)
				.map(
					(waiver) =>
						`The waiver for ${toWaiverKey(waiver)} is stale: its operation ran without the allowed difference. Delete the waiver.`,
				),
		],
	};
}
