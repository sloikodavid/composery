import { lstat } from "node:fs/promises";

// characters-ignore-start: replacement table
const replacements = new Map([
	["‘", "'"],
	["’", "'"],
	["“", '"'],
	["”", '"'],
	["…", "..."],
	["–", "-"],
	["—", "-"],
	["−", "-"],
	[" ", " "],
	["​", ""],
]);
// characters-ignore-end
const characterPattern = new RegExp(
	`[${[...replacements.keys()].join("")}]`,
	"gu",
);
const directivePattern =
	/^\s*(?:\/\/|\/\*|<!--|#)\s*characters-ignore(-start|-end)?(?::\s*(.*?))?\s*(?:\*\/|-->)?\s*$/;
const excludedPathspecs = [
	":!bun.lock",
	":!convex/_generated",
	":!docs/sessions",
	// These generated OpenAPI documents keep the external publishers' text unchanged.
	":!contracts/clerk.json",
	":!contracts/hetzner.json",
];
const usage = "Usage: bun scripts/characters.ts check|fix";

type Finding = { line: number; column: number; message: string };
type Scan = { text: string; findings: Finding[] };
type Ignore = { line: number; isUsed: boolean };

function listFiles() {
	const result = Bun.spawnSync(
		[
			"git",
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			"--",
			".",
			...excludedPathspecs,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if (!result.success) {
		throw new Error(result.stderr.toString().trim());
	}
	const paths = result.stdout.toString().split("\0").filter(Boolean);
	return [...new Set(paths)].sort();
}

async function readText(path: string) {
	const stats = await lstat(path).catch(() => null);
	if (stats === null || !stats.isFile()) {
		return null;
	}
	const bytes = await Bun.file(path).bytes();
	if (bytes.includes(0)) {
		return null;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

function toMessage(character: string) {
	return `Replace ${JSON.stringify(character)} with ${JSON.stringify(replacements.get(character))}.`;
}

function readDirective(line: string, lineNumber: number, findings: Finding[]) {
	const match = directivePattern.exec(line);
	if (match === null) {
		return null;
	}
	const kind = match[1] ?? "";
	if (kind !== "-end" && !match[2]) {
		findings.push({
			line: lineNumber,
			column: 1,
			message: "Give the ignore a reason after a colon.",
		});
	}
	return kind;
}

function scanLine(line: string, lineNumber: number, isFix: boolean): Scan {
	const findings: Finding[] = [];
	const text = line.replace(characterPattern, (character, index: number) => {
		if (isFix && replacements.has(character)) {
			return replacements.get(character) ?? character;
		}
		const column = Array.from(line.slice(0, index)).length + 1;
		findings.push({ line: lineNumber, column, message: toMessage(character) });
		return character;
	});
	return { text, findings };
}

type Ignores = {
	next: Ignore | null;
	range: Ignore | null;
	all: Ignore[];
	findings: Finding[];
};

function applyDirective(
	ignores: Ignores,
	directive: string | null,
	lineNumber: number,
) {
	switch (directive) {
		case null:
			return false;
		case "-start":
			ignores.range = { line: lineNumber, isUsed: false };
			ignores.all.push(ignores.range);
			return true;
		case "-end":
			if (ignores.range === null) {
				ignores.findings.push({
					line: lineNumber,
					column: 1,
					message: "Remove the ignore end that has no start.",
				});
			}
			ignores.range = null;
			return true;
		default:
			ignores.next = { line: lineNumber, isUsed: false };
			ignores.all.push(ignores.next);
			return true;
	}
}

function scanText(source: string, isFix: boolean): Scan {
	const lines = source.split("\n");
	const ignores: Ignores = { next: null, range: null, all: [], findings: [] };
	for (const [index, line] of lines.entries()) {
		const lineNumber = index + 1;
		const directive = readDirective(line, lineNumber, ignores.findings);
		if (applyDirective(ignores, directive, lineNumber)) {
			continue;
		}
		const active = ignores.range ?? ignores.next;
		const scan = scanLine(line, lineNumber, isFix && active === null);
		ignores.next = null;
		if (active !== null && scan.findings.length > 0) {
			active.isUsed = true;
			continue;
		}
		lines[index] = scan.text;
		ignores.findings.push(...scan.findings);
	}
	if (ignores.range !== null) {
		ignores.findings.push({
			line: ignores.range.line,
			column: 1,
			message: "Close the ignore range.",
		});
	}
	for (const ignore of ignores.all.filter(({ isUsed }) => !isUsed)) {
		ignores.findings.push({
			line: ignore.line,
			column: 1,
			message: "Remove the unused ignore.",
		});
	}
	return { text: lines.join("\n"), findings: ignores.findings };
}

async function main() {
	const command = Bun.argv[2];
	if (command !== "check" && command !== "fix") {
		throw new Error(usage);
	}
	const isFix = command === "fix";
	let findingCount = 0;
	for (const path of listFiles()) {
		const source = await readText(path);
		if (source === null) {
			continue;
		}
		const scan = scanText(source, isFix);
		if (isFix && scan.text !== source) {
			await Bun.write(path, scan.text);
		}
		for (const finding of scan.findings) {
			console.error(
				`${path}:${finding.line}:${finding.column} ${finding.message}`,
			);
		}
		findingCount += scan.findings.length;
	}
	if (findingCount > 0) {
		console.error(`Found ${findingCount} character problems.`);
		process.exitCode = 1;
	}
}

await main();
