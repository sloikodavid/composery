// Generates the operator's schedule table in docs/developing/web/maintenance.md
// from packages/web/convex/crons.ts, so the runbook cannot drift from what actually runs.
//
// That table used to be maintained by hand, with the doc itself instructing
// contributors to "update this table in the same commit". Nothing checked it, so
// the promise held only as long as everyone remembered - and a runbook that is
// quietly wrong about when a job fires is worse than no runbook, because an
// operator reads it precisely when something has gone wrong at 03:00.
//
// A test would have been the cheaper fix and the wrong one: it would still make
// every schedule change a two-file edit and simply shout when someone forgot.
// Deriving the table removes the duty instead of policing it.
//
// The job names are Convex's own, verbatim apart from an initial capital. That
// is deliberate: the name in this table is the name in the Convex dashboard and
// in the logs, so an operator can grep for exactly what they read here.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatContent, writeFormatted } from "./write-formatted.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CRONS_FILE = "packages/web/convex/crons.ts";
const CONVEX_DIR = "packages/web/convex";
const DOC_FILE = "docs/developing/web/maintenance.md";
const START = "<!-- cron-schedule:start -->";
const FINISH = "<!-- cron-schedule:finish -->";

const write = process.argv.includes("--write");

function read(path) {
	return readFileSync(join(REPO_ROOT, path), "utf8");
}

// Every `export const NAME = <number expression>` under convex/, so a schedule
// written as a named constant (`{ minutes: METRICS_POLL_INTERVAL_MINUTES }`)
// resolves to the same value the code uses rather than being reported as an
// unknown. Sharing the constant is the better way to write a cron, so the
// generator must not punish it.
function numericConstants() {
	const constants = new Map();
	const visit = (relative) => {
		const absolute = join(REPO_ROOT, relative);
		if (statSync(absolute).isDirectory()) {
			for (const entry of readdirSync(absolute).sort()) {
				visit(`${relative}/${entry}`);
			}
			return;
		}
		if (!relative.endsWith(".ts") || relative.includes("_generated")) return;
		for (const [, name, expression] of readFileSync(absolute, "utf8").matchAll(
			/export const ([A-Z][A-Z0-9_]*) =\s*([^;]+);/g
		)) {
			const value = evaluateNumber(expression);
			if (value !== undefined) constants.set(name, value);
		}
	};
	visit(CONVEX_DIR);
	return constants;
}

// Arithmetic over number literals only. Anything else - a call, a template
// string, a reference we have not resolved - returns undefined so the caller can
// fail loudly rather than invent a schedule.
function evaluateNumber(expression) {
	const source = expression.trim();
	if (!/^[\d\s*+/()_.-]+$/.test(source)) return undefined;
	try {
		const value = Function(`"use strict"; return (${source});`)();
		return typeof value === "number" && Number.isFinite(value)
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

function resolveValue(raw, constants) {
	const source = raw.trim();
	const direct = evaluateNumber(source);
	if (direct !== undefined) return direct;
	return constants.get(source);
}

function pad(value) {
	return String(value).padStart(2, "0");
}

// One row's schedule text, in the vocabulary the table already used.
function scheduleText(kind, options, constants, name) {
	const field = (key) => {
		const match = new RegExp(`${key}\\s*:\\s*([^,}]+)`).exec(options);
		return match ? resolveValue(match[1], constants) : undefined;
	};

	if (kind === "interval") {
		const minutes = field("minutes");
		if (minutes === undefined) return undefined;
		return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
	}
	if (kind === "hourly") {
		const minute = field("minuteUTC");
		if (minute === undefined) return undefined;
		return `Hourly at :${pad(minute)}`;
	}
	if (kind === "daily") {
		const hour = field("hourUTC");
		const minute = field("minuteUTC");
		if (hour === undefined || minute === undefined) return undefined;
		return `Daily at ${pad(hour)}:${pad(minute)}`;
	}
	throw new Error(`Unsupported cron kind "${kind}" for "${name}".`);
}

export function readCronRows() {
	const constants = numericConstants();
	const source = read(CRONS_FILE);
	const rows = [];

	for (const [, kind, name, options] of source.matchAll(
		/crons\.(interval|hourly|daily)\(\s*"([^"]+)",\s*(\{[^}]*\})/g
	)) {
		const schedule = scheduleText(kind, options, constants, name);
		if (schedule === undefined) {
			throw new Error(
				`Could not read the schedule for cron "${name}". Its timing must be a number or a constant exported from convex/, so the runbook can state it.`
			);
		}
		rows.push({ job: name.charAt(0).toUpperCase() + name.slice(1), schedule });
	}

	if (rows.length === 0) {
		// A regex that silently stops matching would otherwise empty the table and
		// report success, which is the failure this whole file exists to prevent.
		throw new Error(`No crons found in ${CRONS_FILE}.`);
	}
	return rows;
}

export function renderTable(rows) {
	const jobWidth = Math.max(3, ...rows.map((row) => row.job.length));
	const scheduleWidth = Math.max(8, ...rows.map((row) => row.schedule.length));
	const line = (left, right) =>
		`| ${left.padEnd(jobWidth)} | ${right.padEnd(scheduleWidth)} |`;

	return [
		line("Job", "Schedule"),
		`| ${"-".repeat(jobWidth)} | ${"-".repeat(scheduleWidth)} |`,
		...rows.map((row) => line(row.job, row.schedule))
	].join("\n");
}

export function renderDoc(current, table) {
	const start = current.indexOf(START);
	const finish = current.indexOf(FINISH);
	if (start === -1 || finish === -1 || finish < start) {
		throw new Error(
			`${DOC_FILE} must contain ${START} and ${FINISH} around the schedule table.`
		);
	}
	return `${current.slice(0, start + START.length)}\n\n${table}\n\n${current.slice(finish)}`;
}

async function expectedDoc() {
	return await formatContent(
		DOC_FILE,
		renderDoc(read(DOC_FILE), renderTable(readCronRows()))
	);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const file = join(REPO_ROOT, DOC_FILE);
	if (!existsSync(file)) throw new Error(`${DOC_FILE} is missing.`);

	const expected = await expectedDoc();
	const actual = read(DOC_FILE);

	if (write) {
		if (actual !== expected) {
			await writeFormatted(file, expected);
			console.log(`Updated the schedule table in ${DOC_FILE}`);
		}
	} else if (actual !== expected) {
		// Name the drifting rows: on a CI runner "out of date" alone cannot tell a
		// forgotten regeneration from a schedule someone changed on purpose, and
		// the runner is gone by the time anyone reads the log.
		const actualLines = new Set(actual.split("\n"));
		console.error(
			[
				`${DOC_FILE} schedule table is out of date. Run 'pnpm fix:runbook'.`,
				...expected
					.split("\n")
					.filter(
						(line) => line.trim().startsWith("|") && !actualLines.has(line)
					)
					.map((line) => `+${line}`)
			].join("\n")
		);
		process.exitCode = 1;
	}
}
