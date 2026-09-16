import { afterAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { readClaudeCodeSession } from "../../../scripts/sessions/claude-code";

const configDirectory = join(
	process.cwd(),
	"tmp",
	"tests",
	`claude-code-${process.pid}`,
);
const projectDirectory = join(configDirectory, "projects", "project");

afterAll(async () => {
	await rm(configDirectory, { recursive: true, force: true });
});

type Row = Record<string, unknown>;

/** Rows in the shape Claude Code writes them, each linked to the row before it unless it says otherwise. */
function linkRows(sessionId: string, rows: Row[]): Row[] {
	let parentUuid: string | null = null;
	return rows.map((row, index) => {
		const linked = {
			parentUuid,
			sessionId,
			timestamp: `2026-09-15T10:${String(index).padStart(2, "0")}:00.000Z`,
			...row,
		};
		parentUuid = String(row.uuid);
		return linked;
	});
}

async function writeTranscript(sessionId: string, rows: Row[]) {
	await Bun.write(
		join(projectDirectory, `${sessionId}.jsonl`),
		rows.map((row) => JSON.stringify(row)).join("\n"),
	);
}

function createUserRow(uuid: string, content: unknown): Row {
	return { type: "user", uuid, message: { role: "user", content } };
}

function createAssistantRow(uuid: string, content: unknown[]): Row {
	return { type: "assistant", uuid, message: { role: "assistant", content } };
}

test("reads the active path of continued sessions, across rewinds and compactions", async () => {
	const first = linkRows("first", [
		createUserRow(
			"clear",
			"<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>",
		),
		createUserRow("question", "First question"),
		createAssistantRow("answer", [
			{ type: "thinking", thinking: "private" },
			{ type: "text", text: "First answer" },
		]),
		createAssistantRow("tool", [
			{ type: "tool_use", id: "tool-one", name: "Bash", input: {} },
		]),
		createUserRow("result", [
			{
				type: "tool_result",
				// biome-ignore lint/style/useNamingConvention: Claude Code's transcript rows use snake_case
				tool_use_id: "tool-one",
				content: "API_TOKEN=tool-output",
			},
		]),
		createAssistantRow("after-tool", [{ type: "text", text: "Tool finished" }]),
		createUserRow("abandoned", "A prompt that was rewound"),
		createAssistantRow("abandoned-answer", [
			{ type: "text", text: "An answer on a rewound branch" },
		]),
	]);
	first.push(
		{
			...createUserRow("resent", "API_TOKEN=typed-by-user"),
			parentUuid: "after-tool",
			sessionId: "first",
		},
		{
			type: "system",
			subtype: "compact_boundary",
			uuid: "boundary",
			parentUuid: null,
			logicalParentUuid: "kept",
			sessionId: "first",
			compactMetadata: { trigger: "auto" },
		},
		{
			...createUserRow(
				"summary",
				"This session is being continued from a previous conversation.",
			),
			parentUuid: "boundary",
			sessionId: "first",
			isCompactSummary: true,
		},
		// A compaction moves the messages it keeps to after its summary.
		{
			...createAssistantRow("kept", [{ type: "text", text: "Kept reply" }]),
			parentUuid: "summary",
			sessionId: "first",
		},
		{
			type: "continued-in",
			sessionId: "first",
			continuedInSessionId: "second",
		},
	);
	await writeTranscript("first", first);
	await writeTranscript("second", [
		...first.filter((row) =>
			["boundary", "summary", "kept"].includes(String(row.uuid)),
		),
		...linkRows("second", [
			createAssistantRow("ask", [
				{
					type: "tool_use",
					id: "ask-one",
					name: "AskUserQuestion",
					input: {
						questions: [
							{
								question: "Which shape?",
								header: "Shape",
								options: [{ label: "Small", description: "Fewer files" }],
							},
						],
					},
				},
			]),
			{
				...createUserRow("ask-result", [
					{
						type: "tool_result",
						// biome-ignore lint/style/useNamingConvention: Claude Code's transcript rows use snake_case
						tool_use_id: "ask-one",
						content: "answered",
					},
				]),
				toolUseResult: { answers: { "Which shape?": "Small" } },
			},
			{
				...createUserRow(
					"caveat",
					"<local-command-caveat>Caveat</local-command-caveat>",
				),
				isMeta: true,
			},
			createUserRow(
				"stdout",
				"<local-command-stdout>Exported</local-command-stdout>",
			),
			createUserRow("interrupt", [
				{ type: "text", text: "[Request interrupted by user]" },
			]),
			createUserRow("last", "Last question"),
		]).map((row, index) =>
			index === 0 ? { ...row, parentUuid: "kept" } : row,
		),
	]);

	const session = await readClaudeCodeSession("second", configDirectory);

	expect(session.sources).toEqual([
		"Claude Code session `first`",
		"Claude Code session `second`",
	]);
	expect(
		session.items.map((item) =>
			item.kind === "turn" ? [item.author, item.text] : ["event", item.text],
		),
	).toEqual([
		["event", "Command: /clear"],
		["user", "First question"],
		["assistant", "First answer\n\nTool finished"],
		["user", "API_TOKEN=typed-by-user"],
		["event", "Compacted (auto)"],
		["assistant", "Kept reply"],
		["event", "Continued as Claude Code session `second`"],
		["assistant", "**Shape**\n\nWhich shape?\n\n- Small: Fewer files"],
		["user", "Which shape?\n\n**Answer:** Small"],
		["event", "Interrupted by the user"],
		["user", "Last question"],
	]);
	expect(session.createdAt).toEqual(new Date("2026-09-15T10:00:00.000Z"));
});
