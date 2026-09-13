import type { Conversation } from "./conversation";

export const CHATGPT_SHARE_URL = /^https:\/\/chatgpt\.com\/share\/[0-9a-f-]+$/;

// Negative indices in React Router's turbo-stream encoding stand for these values.
const SPECIAL_VALUES = new Map<number, unknown>([
	[-1, undefined],
	[-2, Number.NaN],
	[-3, Number.NEGATIVE_INFINITY],
	[-4, -0],
	[-5, null],
	[-6, Number.POSITIVE_INFINITY],
	[-7, undefined],
]);

// ChatGPT writes each citation as private-use characters in the text.
const CITATION_MARKER = /[\uE200-\uE2FF]/u;

type Reference = { matched_text?: unknown; alt?: unknown };
type Message = {
	author?: { role?: unknown };
	recipient?: unknown;
	content?: { content_type?: unknown; parts?: unknown };
	metadata?: {
		is_visually_hidden_from_conversation?: unknown;
		content_references?: unknown;
	};
};
type SharedConversation = {
	title?: unknown;
	create_time?: unknown;
	linear_conversation?: unknown;
};

function decodeTurboStream(flat: unknown[]): unknown {
	const decoded = new Map<number, unknown>();
	const hydrate = (index: number): unknown => {
		if (index < 0) return SPECIAL_VALUES.get(index);
		if (decoded.has(index)) return decoded.get(index);
		const raw = flat[index];
		if (Array.isArray(raw) && typeof raw[0] !== "string") {
			const array: unknown[] = [];
			decoded.set(index, array);
			for (const item of raw) array.push(hydrate(item as number));
			return array;
		}
		if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
			const object: Record<string, unknown> = {};
			decoded.set(index, object);
			for (const [key, value] of Object.entries(raw)) {
				object[String(flat[Number(key.slice(1))])] = hydrate(value as number);
			}
			return object;
		}
		return raw;
	};
	return hydrate(0);
}

function findSharedConversation(
	value: unknown,
	seen = new Set<unknown>(),
): SharedConversation | undefined {
	if (value === null || typeof value !== "object" || seen.has(value)) {
		return undefined;
	}
	seen.add(value);
	if (!Array.isArray(value) && "linear_conversation" in value) {
		return value as SharedConversation;
	}
	for (const child of Object.values(value)) {
		const conversation = findSharedConversation(child, seen);
		if (conversation) return conversation;
	}
	return undefined;
}

function visibleText(message: Message): string | undefined {
	if (message.recipient !== "all") return undefined;
	if (message.metadata?.is_visually_hidden_from_conversation === true) {
		return undefined;
	}
	if (message.content?.content_type !== "text") return undefined;
	const parts = message.content.parts;
	if (!Array.isArray(parts)) return undefined;
	let text = parts.filter((part) => typeof part === "string").join("\n");
	const references = message.metadata?.content_references;
	if (Array.isArray(references)) {
		for (const reference of references as Reference[]) {
			if (
				typeof reference.matched_text !== "string" ||
				!CITATION_MARKER.test(reference.matched_text)
			) {
				continue;
			}
			const replacement =
				typeof reference.alt === "string" ? reference.alt : "";
			text = text.replaceAll(reference.matched_text, replacement);
		}
	}
	text = text.trim();
	return text === "" ? undefined : text;
}

export async function readChatGptShare(url: string): Promise<Conversation> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
	const html = await response.text();
	const chunks = Array.from(
		html.matchAll(/streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g),
		(match) => JSON.parse(match[1] as string) as string,
	);
	const firstLine = chunks.join("").split("\n")[0];
	if (!firstLine) throw new Error(`${url} contains no conversation data.`);
	const shared = findSharedConversation(
		decodeTurboStream(JSON.parse(firstLine) as unknown[]),
	);
	if (
		!shared ||
		typeof shared.title !== "string" ||
		typeof shared.create_time !== "number" ||
		!Array.isArray(shared.linear_conversation)
	) {
		throw new Error(`${url} has an unexpected conversation format.`);
	}

	const turns: Conversation["turns"] = [];
	for (const node of shared.linear_conversation as { message?: Message }[]) {
		const role = node.message?.author?.role;
		if (!node.message || (role !== "user" && role !== "assistant")) continue;
		const text = visibleText(node.message);
		if (text !== undefined) turns.push({ role, text });
	}

	return {
		title: shared.title,
		createdAt: new Date(shared.create_time * 1000),
		assistant: "ChatGPT",
		turns,
	};
}
