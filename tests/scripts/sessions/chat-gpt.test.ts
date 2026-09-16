import { afterAll, beforeAll, expect, test } from "bun:test";
import { readChatGptShare } from "../../../scripts/sessions/chat-gpt";

// Longer than the share that once read as empty: its streamed payload was about 1.6 MB.
const longAnswerCharacters = 3_000_000;
const createdAtSeconds = 1_789_000_000;
const millisecondsPerSecond = 1000;

/**
 * A share page in the shape ChatGPT serves: one streamed literal holding a flat, index-linked
 * encoding, where each object key names the index of its key text and its value's index.
 */
function renderSharePage(questionText: string, answerText: string) {
	const flat = [
		{ _1: 2 },
		"data",
		{ _3: 4, _5: 6, _7: 8 },
		"title",
		"A long conversation",
		"create_time",
		createdAtSeconds,
		"linear_conversation",
		// biome-ignore lint/style/noMagicNumbers: React Router's turbo-stream encoding links values by array index
		[9, 17],
		{ _10: 11 },
		"message",
		{ _12: 13, _14: 15, _18: 19 },
		"author",
		{ _16: 22 },
		"recipient",
		"all",
		"role",
		{ _10: 23 },
		"content",
		{ _20: 21, _24: 25 },
		"content_type",
		"text",
		"user",
		{ _12: 26, _14: 15, _18: 27 },
		"parts",
		[questionText],
		{ _16: 28 },
		{ _20: 21, _24: 29 },
		"assistant",
		[answerText],
	];
	const payload = JSON.stringify(`${JSON.stringify(flat)}\n`);
	return `<!doctype html><html><body><script>window.__reactRouterContext.streamController.enqueue(${payload});</script></body></html>`;
}

const answer = `start ${"x".repeat(longAnswerCharacters)} end`;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			new Response(renderSharePage("How long can an answer be?", answer), {
				headers: { "Content-Type": "text/html" },
			}),
	});
});

afterAll(() => {
	server.stop(true);
});

test("reads a share whose streamed payload is several megabytes long", async () => {
	const session = await readChatGptShare(
		`http://127.0.0.1:${server.port}/share/long`,
	);
	expect(session.title).toBe("A long conversation");
	expect(session.createdAt).toEqual(
		new Date(createdAtSeconds * millisecondsPerSecond),
	);
	expect(session.items).toEqual([
		{ kind: "turn", author: "user", text: "How long can an answer be?" },
		{ kind: "turn", author: "assistant", text: answer },
	]);
});
