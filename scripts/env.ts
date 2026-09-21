import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

// Every working variable must have a non-empty example with the same value shape.

const repositoryRoot = path.resolve(import.meta.dir, "..");
const checkerPath = path.resolve(import.meta.dir, "env.ts");
const exampleSuffix = ".example";
const sourceFilePattern = /\.(?:mjs|ts|tsx)$/;
const booleanPattern = /^(?:0|1|true|false)$/;
const deploymentPattern = /^[a-z][a-z0-9-]*:[^\s]+$/;
const controllerPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,61}[a-zA-Z0-9]$/;
const locationPattern = /^[a-z0-9-]+(?:,[a-z0-9-]+)*$/;
const nonWhitespacePattern = /^[^\s]+$/;

function toValues(file: string) {
	const full = path.isAbsolute(file) ? file : path.join(repositoryRoot, file);
	if (!existsSync(full)) {
		return new Map<string, string>();
	}
	return new Map(
		readFileSync(full, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"))
			.map((line) => {
				const [name, ...rest] = line.split("=");
				return [name?.trim() ?? "", rest.join("=").trim()] as const;
			}),
	);
}

function listFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	return readdirSync(root, { withFileTypes: true }).flatMap((entry: Dirent) => {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) {
			return listFiles(full);
		}
		return sourceFilePattern.test(entry.name) ? [full] : [];
	});
}

const systemNames = new Set([
	"HOME",
	"PATH",
	"USERPROFILE",
	"TEMP",
	"TMP",
	"TMPDIR",
	"SYSTEMROOT",
	"WINDIR",
	"COMSPEC",
	"PATHEXT",
	"NODE_ENV",
	"CONVEX_SITE_URL",
	"CONVEX_CLOUD_URL",
]);

function listSourceNames(root = repositoryRoot) {
	const files = [
		path.join(root, "next.config.ts"),
		...["convex", "harness", "scripts", "src"].flatMap((name) =>
			listFiles(path.join(root, name)),
		),
	].filter((file) => existsSync(file));
	const names = new Set<string>();
	for (const file of files) {
		if (
			path.resolve(file) === checkerPath ||
			file.includes(`${path.sep}_generated${path.sep}`)
		) {
			continue;
		}
		const source = parse(readFileSync(file, "utf8"), {
			sourceType: "unambiguous",
			plugins: ["typescript", "jsx"],
		});
		visitAst(source, (node) => {
			const name = readEnvironmentName(node);
			if (name !== undefined && !systemNames.has(name)) {
				names.add(name);
			}
		});
	}
	return names;
}

type AstNode = Readonly<Record<string, unknown>>;

function isAstNode(value: unknown): value is AstNode {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function visitAst(value: unknown, visit: (node: AstNode) => void) {
	if (Array.isArray(value)) {
		for (const child of value) {
			visitAst(child, visit);
		}
		return;
	}
	if (!isAstNode(value)) {
		return;
	}
	visit(value);
	for (const child of Object.values(value)) {
		visitAst(child, visit);
	}
}

function readEnvironmentName(node: AstNode) {
	if (node.type !== "MemberExpression") {
		return undefined;
	}
	const object = node.object;
	const property = node.property;
	if (!isAstNode(object) || !isAstNode(property)) {
		return undefined;
	}
	let propertyName: unknown;
	if (property.type === "Identifier" && node.computed !== true) {
		propertyName = property.name;
	} else if (property.type === "StringLiteral") {
		propertyName = property.value;
	}
	if (typeof propertyName !== "string") {
		return undefined;
	}
	if (object.type === "Identifier" && object.name === "env") {
		return propertyName;
	}
	if (object.type !== "MemberExpression") {
		return undefined;
	}
	const process = object.object;
	const environment = object.property;
	return isAstNode(process) &&
		isAstNode(environment) &&
		process.type === "Identifier" &&
		process.name === "process" &&
		environment.type === "Identifier" &&
		environment.name === "env"
		? propertyName
		: undefined;
}

function isUrl(value: string) {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.hostname !== ""
		);
	} catch {
		return false;
	}
}

const fixedShapeChecks = new Map<string, (value: string) => boolean>([
	["NEXT_PUBLIC_CLERK_SIGN_IN_URL", (value) => value.startsWith("/")],
	["HCLOUD_MODE", (value) => value === "fake" || value === "real"],
	["CLERK_MODE", (value) => value === "fake" || value === "real"],
	[
		"NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED",
		(value) => booleanPattern.test(value),
	],
	["CONVEX_DEPLOYMENT", (value) => deploymentPattern.test(value)],
	["HCLOUD_CONTROLLER_ID", (value) => controllerPattern.test(value)],
	["HCLOUD_LOCATIONS", (value) => locationPattern.test(value)],
]);

function hasExpectedShape(name: string, value: string) {
	const fixed = fixedShapeChecks.get(name);
	if (fixed !== undefined) {
		return fixed(value);
	}
	return name.endsWith("_URL")
		? isUrl(value)
		: nonWhitespacePattern.test(value);
}

function listExampleProblems(
	root: string,
	examplePath: string,
	exampleNames: Set<string>,
) {
	const example = path.relative(root, examplePath);
	const named = toValues(examplePath);
	const problems: string[] = [];
	for (const [name, value] of named) {
		exampleNames.add(name);
		if (value === "") {
			problems.push(`${example} leaves ${name} blank, which is not a value.`);
		} else if (!hasExpectedShape(name, value)) {
			problems.push(`${example} gives ${name} a value with the wrong shape.`);
		}
	}
	const source = toValues(examplePath.slice(0, -exampleSuffix.length));
	for (const name of source.keys()) {
		if (!named.has(name)) {
			problems.push(
				`${example} does not name ${name}, which is set beside it.`,
			);
		}
	}
	return problems;
}

function listSourceProblems(root: string, exampleNames: ReadonlySet<string>) {
	return [...listSourceNames(root)]
		.filter((name) => !exampleNames.has(name))
		.map(
			(name) =>
				`No environment example names ${name}, which source code reads.`,
		);
}

export function listEnvironmentProblems(root = repositoryRoot) {
	const examples = readdirSync(root)
		.filter((file) => file.endsWith(exampleSuffix))
		.map((file) => path.join(root, file));
	const exampleNames = new Set<string>();
	return [
		...examples.flatMap((examplePath) =>
			listExampleProblems(root, examplePath, exampleNames),
		),
		...listSourceProblems(root, exampleNames),
	].sort();
}

if (import.meta.main) {
	const problems = listEnvironmentProblems();
	for (const problem of problems) {
		console.error(problem);
	}
	if (problems.length > 0) {
		process.exit(1);
	}
}
