import { homedir } from "node:os";
import { basename, join } from "node:path";

type JsonObject = Record<string, unknown>;

type Transcript = {
	file: string;
	sessionId: string;
	rows: JsonObject[];
};

type SessionExport = {
	markdown: string;
	sessionIds: string[];
};

const continuationPrefix =
	"This session is being continued from a previous conversation that ran out of context.";
const secretAssignment =
	/^(\s*[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*[=:]\s*)(.+)$/gm;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function redactSecrets(text: string): string {
	return text.replace(secretAssignment, "$1[redacted]");
}

async function readTranscript(file: string): Promise<Transcript> {
	const rows = (await Bun.file(file).text())
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as JsonObject);
	const sessionId = basename(file, ".jsonl");
	return { file, sessionId, rows };
}

async function findTranscriptFiles(
	configDirectories: string[],
): Promise<string[]> {
	const files = new Set<string>();
	const pattern = new Bun.Glob("projects/*/*.jsonl");
	for (const directory of configDirectories) {
		for await (const file of pattern.scan({ cwd: directory, absolute: true })) {
			files.add(file);
		}
	}
	return [...files];
}

async function findChain(
	files: string[],
	finalSessionId: string,
): Promise<Transcript[]> {
	const chain: Transcript[] = [];
	const visited = new Set<string>();
	let sessionId: string | undefined = finalSessionId;
	while (sessionId) {
		if (visited.has(sessionId)) {
			throw new Error(
				`Claude Code session chain contains a cycle at ${sessionId}.`,
			);
		}
		visited.add(sessionId);
		const file = files.find(
			(candidate) => basename(candidate, ".jsonl") === sessionId,
		);
		if (!file) {
			throw new Error(`Claude Code session ${sessionId} was not found.`);
		}
		const transcript = await readTranscript(file);
		chain.unshift(transcript);
		const continuationNeedle = `"continuedInSessionId":"${sessionId}"`;
		sessionId = undefined;
		for (const candidate of files) {
			if ((await Bun.file(candidate).text()).includes(continuationNeedle)) {
				sessionId = basename(candidate, ".jsonl");
				break;
			}
		}
	}
	return chain;
}

function renderFence(text: string, language = "text"): string {
	let fence = "```";
	while (text.includes(fence)) {
		fence += "`";
	}
	return `${fence}${language}\n${redactSecrets(text)}\n${fence}`;
}

function renderToolUse(block: JsonObject): string {
	const name = readString(block.name) ?? "unknown";
	const input = JSON.stringify(block.input ?? {}, null, 2);
	return `**Tool: ${name}**\n\n${renderFence(input, "json")}`;
}

function renderToolResult(block: JsonObject): string {
	const toolUseId = readString(block.tool_use_id) ?? "unknown";
	const content = block.content;
	const text =
		typeof content === "string"
			? content
			: JSON.stringify(content ?? "", null, 2);
	return `**Tool result: ${toolUseId}**\n\n${renderFence(text)}`;
}

function renderBlocks(
	content: unknown,
): { kind: "message" | "toolResult"; text: string }[] {
	if (typeof content === "string") {
		return [{ kind: "message", text: redactSecrets(content) }];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const rendered: { kind: "message" | "toolResult"; text: string }[] = [];
	for (const value of content) {
		if (!isObject(value)) {
			continue;
		}
		switch (value.type) {
			case "text": {
				const text = readString(value.text);
				if (text) {
					rendered.push({ kind: "message", text: redactSecrets(text) });
				}
				break;
			}
			case "tool_use":
			case "server_tool_use":
				rendered.push({ kind: "message", text: renderToolUse(value) });
				break;
			case "tool_result":
				rendered.push({ kind: "toolResult", text: renderToolResult(value) });
				break;
			case "thinking":
				break;
			default:
				rendered.push({
					kind: "message",
					text: renderFence(JSON.stringify(value, null, 2), "json"),
				});
		}
	}
	return rendered;
}

function renderTimestamp(row: JsonObject): string {
	const timestamp = readString(row.timestamp);
	return timestamp ? ` · ${timestamp}` : "";
}

function isContinuationSummary(
	blocks: { kind: "message" | "toolResult"; text: string }[],
): boolean {
	return blocks.some(
		(block) =>
			block.kind === "message" && block.text.startsWith(continuationPrefix),
	);
}

function renderCompactBoundary(row: JsonObject): string[] {
	if (row.type === "system" && row.subtype === "compact_boundary") {
		const metadata = isObject(row.compactMetadata) ? row.compactMetadata : {};
		const trigger = readString(metadata.trigger) ?? "unknown";
		return [
			`---\n\n> Conversation compacted (${trigger})${renderTimestamp(row)}.`,
		];
	}
	return [];
}

function renderMessageRow(row: JsonObject, hasPredecessor: boolean): string[] {
	if (row.type !== "user" && row.type !== "assistant") {
		return [];
	}
	const message = isObject(row.message) ? row.message : undefined;
	if (!message) {
		return [];
	}
	const blocks = renderBlocks(message.content);
	if (hasPredecessor && isContinuationSummary(blocks)) {
		return [];
	}
	const onlyToolResults =
		blocks.length > 0 && blocks.every((block) => block.kind === "toolResult");
	const role = row.type === "assistant" ? "Assistant" : "User";
	const heading = onlyToolResults ? "Tool" : role;
	const body = blocks.map((block) => block.text).join("\n\n");
	return body ? [`---\n\n## ${heading}${renderTimestamp(row)}\n\n${body}`] : [];
}

function renderRow(row: JsonObject, hasPredecessor: boolean): string[] {
	if (row.isSidechain === true) {
		return [];
	}
	return [
		...renderCompactBoundary(row),
		...renderMessageRow(row, hasPredecessor),
	];
}

export async function exportClaudeCodeSession(
	finalSessionId: string,
	configDirectories = [
		join(homedir(), ".claude"),
		join(homedir(), ".claude2"),
		join(homedir(), ".claude3"),
	],
): Promise<SessionExport> {
	const chain = await findChain(
		await findTranscriptFiles(configDirectories),
		finalSessionId,
	);
	const seen = new Set<string>();
	const rows: string[] = [];
	for (const [index, transcript] of chain.entries()) {
		for (const row of transcript.rows) {
			const uuid = readString(row.uuid);
			if (uuid && seen.has(uuid)) {
				continue;
			}
			if (uuid) {
				seen.add(uuid);
			}
			rows.push(...renderRow(row, index > 0));
		}
	}
	const titleRow = chain
		.flatMap((transcript) => transcript.rows)
		.find((row) => row.type === "ai-title");
	const title = readString(titleRow?.aiTitle) ?? "Claude Code session";
	const sessionIds = chain.map((transcript) => transcript.sessionId);
	const header = [
		`# ${title}`,
		"",
		`Source: \`claude-code://${finalSessionId}\``,
		`Session chain: ${sessionIds.map((id) => `\`${id}\``).join(" → ")}`,
		"",
		"This export contains the complete visible user, assistant, tool, and compaction transcript from Claude Code's official local JSONL records. It omits hidden context attachments, internal reasoning, signatures, token accounting, and other runtime telemetry. Secret-like environment assignments are redacted.",
	];
	return {
		markdown: `${header.join("\n")}\n\n${rows.join("\n\n")}\n`,
		sessionIds,
	};
}
