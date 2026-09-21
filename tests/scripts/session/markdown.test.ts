import { expect, test } from "bun:test";
import { renderSessionMarkdown } from "../../../scripts/session/markdown";

test("numbers turns, keeps events unnumbered, and redacts secret assignments", () => {
	const markdown = renderSessionMarkdown({
		title: "A session",
		createdAt: new Date("2026-09-15T10:00:00.000Z"),
		assistant: "Claude",
		sources: ["first", "second"],
		items: [
			{ kind: "event", text: "Command: /clear" },
			{
				kind: "turn",
				author: "user",
				text: "API_TOKEN=do-not-export",
				timestamp: new Date("2026-09-15T10:01:00.000Z"),
			},
			{ kind: "turn", author: "assistant", text: "Answer" },
		],
	});
	expect(markdown).toBe(
		[
			"# A session",
			"",
			"Source: first → second",
			"",
			"---\n\n> Command: /clear",
			"",
			"---\n\n## Turn 1: User\n\n_2026-09-15T10:01:00.000Z_\n\nAPI_TOKEN=[redacted]",
			"",
			"---\n\n## Turn 2: Claude\n\nAnswer",
			"",
		].join("\n"),
	);
});
