import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
const CONVEX_BIN = join(
	dirname(require.resolve("convex/package.json")),
	"bin",
	"main.js"
);

const TARGETS = [
	{ name: "Vercel Production", example: ".env.example.next.prod" },
	{ name: "Convex Production", example: ".env.example.convex.prod" }
];

// Vercel exposes project variables in the same process namespace as its own
// system variables and the build container's environment. Its project API can
// distinguish them, but requires a separate access token. These are therefore
// infrastructure, not application drift. Anything else is reported but never
// blocks, so a newly injected build name can be noisy without stopping a deploy.
const BUILD_NAMES = new Set([
	"CI",
	"COLORTERM",
	"HOME",
	"HOSTNAME",
	"LANG",
	"LC_ALL",
	"LOGNAME",
	"PATH",
	"PWD",
	"SHELL",
	"TERM",
	"TMP",
	"TMPDIR",
	"USER",
	"XDG_CACHE_HOME"
]);
const BUILD_PREFIXES = [
	"COREPACK_",
	"NODE_",
	"NPM_",
	"npm_",
	"PNPM_",
	"pnpm_",
	"VERCEL_"
];

export function envNames(contents, source) {
	const names = new Set();
	for (const [index, line] of contents.split(/\r?\n/).entries()) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed);
		if (!match?.[1]) {
			throw new Error(`${source}:${index + 1} is not a NAME=value line.`);
		}
		if (names.has(match[1])) {
			throw new Error(`${source}:${index + 1} repeats ${match[1]}.`);
		}
		names.add(match[1]);
	}
	if (names.size === 0) throw new Error(`${source} contains no variables.`);
	return names;
}

export function nameLines(contents, source) {
	const names = new Set();
	for (const [index, line] of contents.split(/\r?\n/).entries()) {
		const name = line.trim();
		if (!name) continue;
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
			throw new Error(`${source}:${index + 1} is not an environment name.`);
		}
		if (names.has(name)) {
			throw new Error(`${source}:${index + 1} repeats ${name}.`);
		}
		names.add(name);
	}
	return names;
}

export function isBuildName(name) {
	return (
		BUILD_NAMES.has(name) ||
		name === "VERCEL" ||
		name.includes("_VERCEL_") ||
		BUILD_PREFIXES.some((prefix) => name.startsWith(prefix))
	);
}

export function compareNames({ expected, actual, ignore = () => false }) {
	return {
		missing: [...expected].filter((name) => !actual.has(name)).sort(),
		extra: [...actual]
			.filter((name) => !expected.has(name) && !ignore(name))
			.sort()
	};
}

export function listConvexNames({ run = spawnSync } = {}) {
	const result = run(
		process.execPath,
		[CONVEX_BIN, "env", "list", "--names-only"],
		{
			cwd: WEB_DIR,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"]
		}
	);
	if (
		result.error ||
		result.status !== 0 ||
		typeof result.stdout !== "string"
	) {
		throw new Error(
			"[env] Convex environment names could not be listed; deployment blocked."
		);
	}
	return nameLines(result.stdout, "convex env list --names-only");
}

export function checkDeployment({
	environment,
	convexNames,
	read = (file) => readFileSync(join(WEB_DIR, file), "utf8")
}) {
	const vercelTarget = TARGETS[0];
	const convexTarget = TARGETS[1];
	return [
		{
			...vercelTarget,
			...compareNames({
				expected: envNames(read(vercelTarget.example), vercelTarget.example),
				actual: new Set(Object.keys(environment)),
				ignore: isBuildName
			})
		},
		{
			...convexTarget,
			...compareNames({
				expected: envNames(read(convexTarget.example), convexTarget.example),
				actual: convexNames
			})
		}
	];
}

export function formatResult(result) {
	const details = [];
	if (result.missing.length) {
		details.push(`missing required names: ${result.missing.join(", ")}`);
	}
	if (result.extra.length) {
		details.push(`additional names (drift): ${result.extra.join(", ")}`);
	}
	if (!details.length) {
		return `[env] ${result.name} matches ${result.example}. Values were not read.`;
	}
	const outcome = result.missing.length
		? "Deployment blocked."
		: "Deployment continues.";
	return `[env] ${result.name} — ${details.join("; ")}. ${outcome} Values were not read.`;
}

export function main({
	environment = process.env,
	convexNames = listConvexNames(),
	read,
	write = console.log,
	writeError = console.error
} = {}) {
	const results = checkDeployment({ environment, convexNames, read });
	for (const result of results) {
		(result.missing.length || result.extra.length ? writeError : write)(
			formatResult(result)
		);
	}
	return {
		blocked: results.some((result) => result.missing.length > 0),
		results
	};
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		const result = main();
		if (result.blocked) process.exitCode = 1;
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "[env] Check failed."
		);
		process.exitCode = 1;
	}
}
