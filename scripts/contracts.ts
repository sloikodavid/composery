import { createHash } from "node:crypto";
import path from "node:path";
import { clerkDescribed, createClerkContractChecker } from "../contracts/clerk";
import {
	createHetznerContractChecker,
	hetznerDescribed,
} from "../contracts/hetzner";
import {
	type Contract,
	type ContractSource,
	type Described,
	selectOpenApiDocument,
} from "../contracts/openapi";

const yamlPattern = /\.ya?ml$/;
const requestTimeoutMs = 30_000;
const dateLength = 10;

async function readSource(selected: Described): Promise<ContractSource> {
	const reply = await fetch(selected.source, {
		signal: AbortSignal.timeout(requestTimeoutMs),
	});
	if (!reply.ok) {
		throw new Error(`${selected.source} answered ${reply.status}.`);
	}
	const text = await reply.text();
	const document: unknown = yamlPattern.test(new URL(selected.source).pathname)
		? Bun.YAML.parse(text)
		: JSON.parse(text);
	return {
		source: selected.source,
		readAt: new Date().toISOString().slice(0, dateLength),
		digest: createHash("sha256").update(text).digest("hex"),
		holder: selected.holder,
		document: selectOpenApiDocument(document, selected),
	};
}

async function readPinnedContract(
	described: readonly Described[],
): Promise<Contract> {
	return {
		sources: await Promise.all(described.map(readSource)),
	};
}

async function writePinnedContract(
	system: string,
	contract: Contract,
	output: string,
) {
	const text = `${JSON.stringify(contract, null, "\t")}\n`;
	await Bun.write(output, text);
	console.log(
		`${output} records ${system}'s current contract. Review the difference.`,
	);
}

const here = path.join(import.meta.dir, "..", "contracts");
const [hetznerContract, clerkContract] = await Promise.all([
	readPinnedContract([hetznerDescribed]),
	readPinnedContract(clerkDescribed),
]);
createHetznerContractChecker(hetznerContract);
createClerkContractChecker(clerkContract);
await writePinnedContract(
	"Hetzner",
	hetznerContract,
	path.join(here, "hetzner.json"),
);
await writePinnedContract(
	"Clerk",
	clerkContract,
	path.join(here, "clerk.json"),
);
