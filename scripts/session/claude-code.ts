import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Session, SessionItem } from "./markdown";

type Row = Record<string, unknown>;

type Transcript = {
	sessionId: string;
	rows: Row[];
};

type IndexedRows = {
	rows: Row[];
	indexesByUuid: Map<string, number>;
};

export const claudeCodeSessionId =
	/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// These rows describe harness activity, not user messages.
const harnessTag =
	/^<(local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|task-notification)>/;
const commandPattern =
	/^<command-name>([^<]*)<\/command-name>(?:[\s\S]*?<command-args>([\s\S]*?)<\/command-args>)?/;
const interruptionPrefix = "[Request interrupted by user";

function isRow(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readTimestamp(row: Row): Date | undefined {
	const timestamp = readString(row.timestamp);
	return timestamp === undefined ? undefined : new Date(timestamp);
}

function getClaudeCodeConfigDirectory(): string {
	return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

async function readTranscript(file: string): Promise<Transcript> {
	const rows = (await Bun.file(file).text())
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Row);
	return { sessionId: basename(file, ".jsonl"), rows };
}

async function findTranscriptFile(
	configDirectory: string,
	sessionId: string,
): Promise<string> {
	const files = await Array.fromAsync(
		new Bun.Glob(`projects/*/${sessionId}.jsonl`).scan({
			cwd: configDirectory,
			absolute: true,
		}),
	);
	const [file, ...others] = files;
	if (!file) {
		throw new Error(
			`Claude Code session ${sessionId} was not found in ${configDirectory}.`,
		);
	}
	if (others.length > 0) {
		throw new Error(
			`Claude Code session ${sessionId} exists in more than one project.`,
		);
	}
	return file;
}

async function findPredecessors(
	projectDirectory: string,
): Promise<Map<string, string>> {
	const predecessors = new Map<string, string>();
	for await (const file of new Bun.Glob("*.jsonl").scan({
		cwd: projectDirectory,
		absolute: true,
	})) {
		const lines = (await Bun.file(file).text())
			.split("\n")
			.filter((line) => line.includes('"continued-in"'));
		for (const line of lines) {
			const row = JSON.parse(line) as Row;
			const successor = readString(row.continuedInSessionId);
			if (row.type === "continued-in" && successor) {
				predecessors.set(successor, basename(file, ".jsonl"));
			}
		}
	}
	return predecessors;
}

async function readSessionChain(
	configDirectory: string,
	finalSessionId: string,
): Promise<Transcript[]> {
	const finalFile = await findTranscriptFile(configDirectory, finalSessionId);
	const projectDirectory = dirname(finalFile);
	const predecessors = await findPredecessors(projectDirectory);
	const chain = [await readTranscript(finalFile)];
	const visited = new Set([finalSessionId]);
	for (
		let sessionId = predecessors.get(finalSessionId);
		sessionId !== undefined;
		sessionId = predecessors.get(sessionId)
	) {
		if (visited.has(sessionId)) {
			throw new Error(`Claude Code session chain repeats ${sessionId}.`);
		}
		visited.add(sessionId);
		chain.unshift(
			await readTranscript(join(projectDirectory, `${sessionId}.jsonl`)),
		);
	}
	return chain;
}

function isMessageRow(row: Row): boolean {
	return (
		readString(row.uuid) !== undefined &&
		row.isSidechain !== true &&
		(row.type === "user" ||
			row.type === "assistant" ||
			row.type === "system" ||
			row.type === "attachment")
	);
}

function indexMessageRows(chain: Transcript[]): IndexedRows {
	const rows: Row[] = [];
	const indexesByUuid = new Map<string, number>();
	for (const row of chain.flatMap((transcript) => transcript.rows)) {
		const uuid = readString(row.uuid);
		if (uuid && isMessageRow(row) && !indexesByUuid.has(uuid)) {
			indexesByUuid.set(uuid, rows.length);
			rows.push(row);
		}
	}
	return { rows, indexesByUuid };
}

function findPreviousIndex(
	{ rows, indexesByUuid }: IndexedRows,
	index: number,
	visited: Set<number>,
): number | undefined {
	const row = rows[index];
	const parentUuid = readString(row?.parentUuid);
	if (parentUuid !== undefined) {
		const parentIndex = indexesByUuid.get(parentUuid);
		if (parentIndex === undefined) {
			throw new Error(
				`Claude Code session refers to missing message ${parentUuid}.`,
			);
		}
		return parentIndex;
	}
	if (row?.subtype !== "compact_boundary") {
		return undefined;
	}
	for (let before = index - 1; before >= 0; before -= 1) {
		if (!visited.has(before)) {
			return before;
		}
	}
	return undefined;
}

/** Follows the active parent chain across rewinds and compaction boundaries. */
function findActivePath(chain: Transcript[]): Row[] {
	const indexed = indexMessageRows(chain);
	const finalUuids = new Set(chain.at(-1)?.rows.map((row) => row.uuid));
	const leaf = indexed.rows.findLastIndex((row) => finalUuids.has(row.uuid));
	const path: Row[] = [];
	const visited = new Set<number>();
	for (
		let index: number | undefined = leaf === -1 ? undefined : leaf;
		index !== undefined;
		index = findPreviousIndex(indexed, index, visited)
	) {
		const row = indexed.rows[index];
		if (!row || visited.has(index)) {
			throw new Error(
				`Claude Code session repeats message ${String(row?.uuid)}.`,
			);
		}
		visited.add(index);
		path.unshift(row);
	}
	return path;
}

function renderAskUserOption(option: unknown): string | undefined {
	const label = isRow(option) ? readString(option.label) : undefined;
	if (!(isRow(option) && label)) {
		return undefined;
	}
	const description = readString(option.description);
	return `- ${label}${description ? `: ${description}` : ""}`;
}

function renderAskUserQuestion(value: unknown): string | undefined {
	const question = isRow(value) ? readString(value.question) : undefined;
	if (!(isRow(value) && question)) {
		return undefined;
	}
	const header = readString(value.header);
	const options = (Array.isArray(value.options) ? value.options : [])
		.map(renderAskUserOption)
		.filter((option) => option !== undefined);
	return [
		header ? `**${header}**\n\n${question}` : question,
		options.join("\n"),
	]
		.filter((part) => part.length > 0)
		.join("\n\n");
}

function renderAskUserQuestions(input: unknown): string | undefined {
	const values =
		isRow(input) && Array.isArray(input.questions) ? input.questions : [];
	const questions = values
		.map(renderAskUserQuestion)
		.filter((question) => question !== undefined);
	return questions.length > 0 ? questions.join("\n\n") : undefined;
}

function renderAskUserAnswer(row: Row, fallback: string): string {
	const result = isRow(row.toolUseResult) ? row.toolUseResult : undefined;
	const answers = result && isRow(result.answers) ? result.answers : undefined;
	if (!answers) {
		return fallback;
	}
	return Object.entries(answers)
		.map(([question, answer]) => `${question}\n\n**Answer:** ${String(answer)}`)
		.join("\n\n");
}

function readCommandEvent(text: string): string | undefined {
	const match = commandPattern.exec(text);
	if (!match) {
		return undefined;
	}
	const args = match[2]?.trim();
	return args ? `${match[1]} ${args}` : match[1];
}

function readUserText(text: string): SessionItem | undefined {
	if (harnessTag.test(text)) {
		return undefined;
	}
	const command = readCommandEvent(text);
	if (command !== undefined) {
		return { kind: "event", text: `Command: ${command}` };
	}
	if (text.startsWith(interruptionPrefix)) {
		return { kind: "event", text: "Interrupted by the user" };
	}
	return { kind: "turn", author: "user", text };
}

function readUserBlock(
	row: Row,
	block: unknown,
	questionIds: Set<string>,
): SessionItem | undefined {
	if (!isRow(block)) {
		return undefined;
	}
	const text = readString(block.text);
	if (block.type === "text" && text) {
		return readUserText(text);
	}
	if (block.type === "image") {
		return { kind: "turn", author: "user", text: "_(image not exported)_" };
	}
	const toolUseId = readString(block.tool_use_id);
	if (block.type === "tool_result" && toolUseId && questionIds.has(toolUseId)) {
		const answer = renderAskUserAnswer(row, readString(block.content) ?? "");
		return { kind: "turn", author: "user", text: answer };
	}
	return undefined;
}

function readUserRow(row: Row, questionIds: Set<string>): SessionItem[] {
	if (row.isMeta === true || row.isCompactSummary === true) {
		return [];
	}
	const content = isRow(row.message) ? row.message.content : undefined;
	const blocks =
		typeof content === "string" ? [{ type: "text", text: content }] : content;
	return (Array.isArray(blocks) ? blocks : [])
		.map((block) => readUserBlock(row, block, questionIds))
		.filter((item) => item !== undefined);
}

function readAssistantBlock(
	block: unknown,
	questionIds: Set<string>,
): SessionItem | undefined {
	if (!isRow(block)) {
		return undefined;
	}
	const text = readString(block.text);
	if (block.type === "text" && text) {
		return { kind: "turn", author: "assistant", text };
	}
	const id = readString(block.id);
	const question =
		block.type === "tool_use" && block.name === "AskUserQuestion"
			? renderAskUserQuestions(block.input)
			: undefined;
	if (!(question && id)) {
		return undefined;
	}
	questionIds.add(id);
	return { kind: "turn", author: "assistant", text: question };
}

function readAssistantRow(row: Row, questionIds: Set<string>): SessionItem[] {
	const content = isRow(row.message) ? row.message.content : undefined;
	return (Array.isArray(content) ? content : [])
		.map((block) => readAssistantBlock(block, questionIds))
		.filter((item) => item !== undefined);
}

function readSystemRow(row: Row): SessionItem[] {
	if (row.subtype === "compact_boundary") {
		const metadata = isRow(row.compactMetadata) ? row.compactMetadata : {};
		const trigger = readString(metadata.trigger) ?? "unknown";
		return [{ kind: "event", text: `Compacted (${trigger})` }];
	}
	const content = readString(row.content);
	if (row.subtype === "local_command" && content) {
		const item = readUserText(content);
		return item?.kind === "event" ? [item] : [];
	}
	return [];
}

function readRow(row: Row, questionIds: Set<string>): SessionItem[] {
	switch (row.type) {
		case "user":
			return readUserRow(row, questionIds);
		case "assistant":
			return readAssistantRow(row, questionIds);
		case "system":
			return readSystemRow(row);
		default:
			return [];
	}
}

function mergeSessionItems(items: SessionItem[]): SessionItem[] {
	const merged: SessionItem[] = [];
	for (const item of items) {
		const previous = merged.at(-1);
		if (
			item.kind === "turn" &&
			previous?.kind === "turn" &&
			previous.author === item.author
		) {
			previous.text = `${previous.text}\n\n${item.text}`;
		} else {
			merged.push({ ...item });
		}
	}
	return merged;
}

export async function readClaudeCodeSession(
	finalSessionId: string,
	configDirectory = getClaudeCodeConfigDirectory(),
): Promise<Session> {
	const chain = await readSessionChain(configDirectory, finalSessionId);
	const path = findActivePath(chain);
	const questionIds = new Set<string>();
	const items: SessionItem[] = [];
	let sessionId: string | undefined;
	for (const row of path) {
		const rowSessionId = readString(row.sessionId);
		if (sessionId && rowSessionId && rowSessionId !== sessionId) {
			items.push({
				kind: "event",
				text: `Continued as Claude Code session \`${rowSessionId}\``,
			});
		}
		sessionId = rowSessionId ?? sessionId;
		const timestamp = readTimestamp(row);
		for (const item of readRow(row, questionIds)) {
			items.push(timestamp ? { ...item, timestamp } : item);
		}
	}
	const createdAt = path.map(readTimestamp).find((date) => date !== undefined);
	if (!createdAt) {
		throw new Error(`Claude Code session ${finalSessionId} has no messages.`);
	}
	const title = chain
		.flatMap((transcript) => transcript.rows)
		.findLast((row) => row.type === "ai-title");
	return {
		title: readString(title?.aiTitle) ?? "Claude Code session",
		createdAt,
		assistant: "Claude",
		sources: chain.map(
			(transcript) => `Claude Code session \`${transcript.sessionId}\``,
		),
		items: mergeSessionItems(items),
	};
}
