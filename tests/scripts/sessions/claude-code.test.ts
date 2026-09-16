import { expect, test } from "bun:test";
import { join } from "node:path";
import { exportClaudeCodeSession } from "../../../scripts/sessions/claude-code";

test("joins continued Claude Code sessions without duplicate compacted history", async () => {
	const root = join(
		process.cwd(),
		"tmp",
		"tests",
		`claude-session-${process.pid}`,
	);
	const project = join(root, "projects", "project");
	await Bun.write(
		join(project, "first.jsonl"),
		[
			JSON.stringify({ type: "ai-title", aiTitle: "A full session" }),
			JSON.stringify({
				type: "user",
				uuid: "user-one",
				timestamp: "2026-09-15T10:00:00.000Z",
				message: { content: "First question" },
			}),
			JSON.stringify({
				type: "assistant",
				uuid: "answer-one",
				timestamp: "2026-09-15T10:01:00.000Z",
				message: { content: [{ type: "text", text: "First answer" }] },
			}),
			JSON.stringify({
				type: "continued-in",
				continuedInSessionId: "second",
			}),
		].join("\n"),
	);
	await Bun.write(
		join(project, "second.jsonl"),
		[
			JSON.stringify({
				type: "system",
				subtype: "compact_boundary",
				uuid: "compact",
				timestamp: "2026-09-15T10:02:00.000Z",
				compactMetadata: { trigger: "auto" },
			}),
			JSON.stringify({
				type: "user",
				uuid: "summary",
				message: {
					content:
						"This session is being continued from a previous conversation that ran out of context. Summary: First question and answer.",
				},
			}),
			JSON.stringify({
				type: "user",
				uuid: "user-two",
				timestamp: "2026-09-15T10:03:00.000Z",
				message: { content: "Second question" },
			}),
			JSON.stringify({
				type: "user",
				uuid: "tool-result",
				message: {
					content: [
						{
							type: "tool_result",
							// biome-ignore lint/style/useNamingConvention: Claude Code's JSONL contract requires snake_case
							tool_use_id: "tool-one",
							content: "API_TOKEN=do-not-export",
						},
					],
				},
			}),
		].join("\n"),
	);

	const session = await exportClaudeCodeSession("second", [root]);
	expect(session.sessionIds).toEqual(["first", "second"]);
	expect(session.markdown).toContain("First question");
	expect(session.markdown).toContain("First answer");
	expect(session.markdown).toContain("Conversation compacted (auto)");
	expect(session.markdown).toContain("Second question");
	expect(session.markdown).not.toContain("Summary: First question");
	expect(session.markdown).toContain("API_TOKEN=[redacted]");
	expect(session.markdown).not.toContain("do-not-export");
});
