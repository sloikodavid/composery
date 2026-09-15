import type { Conversation } from "./conversation";

export const chatGptShareUrl = /^https:\/\/chatgpt\.com\/share\/[0-9a-f-]+$/;

// React Router's turbo-stream encoding writes these values as the indices -1, -2, and so on.
const specialValues: readonly unknown[] = [
	undefined,
	Number.NaN,
	Number.NEGATIVE_INFINITY,
	-0,
	null,
	Number.POSITIVE_INFINITY,
	undefined,
];

// ChatGPT writes each citation as private-use characters in the text.
const citationMarker = /[\uE200-\uE2FF]/u;
const millisecondsPerSecond = 1000;
const enqueueMarker = "streamController.enqueue(";

// biome-ignore-start lint/style/useNamingConvention: ChatGPT's share data uses snake_case fields
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
// biome-ignore-end lint/style/useNamingConvention: ChatGPT's share data uses snake_case fields

function decodeTurboStream(flat: unknown[]): unknown {
	const decoded = new Map<number, unknown>();
	const hydrateArray = (index: number, items: unknown[]) => {
		const array: unknown[] = [];
		decoded.set(index, array);
		for (const item of items) {
			array.push(hydrate(item as number));
		}
		return array;
	};
	const hydrateObject = (index: number, entries: object) => {
		const object: Record<string, unknown> = {};
		decoded.set(index, object);
		for (const [key, value] of Object.entries(entries)) {
			object[String(flat[Number(key.slice(1))])] = hydrate(value as number);
		}
		return object;
	};
	const hydrate = (index: number): unknown => {
		if (index < 0) {
			return specialValues[-index - 1];
		}
		if (decoded.has(index)) {
			return decoded.get(index);
		}
		const raw = flat[index];
		if (Array.isArray(raw)) {
			return typeof raw[0] === "string" ? raw : hydrateArray(index, raw);
		}
		return raw !== null && typeof raw === "object"
			? hydrateObject(index, raw)
			: raw;
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
		if (conversation) {
			return conversation;
		}
	}
	return undefined;
}

function removeCitations(text: string, references: unknown) {
	if (!Array.isArray(references)) {
		return text;
	}
	let result = text;
	for (const reference of references as Reference[]) {
		if (
			typeof reference.matched_text === "string" &&
			citationMarker.test(reference.matched_text)
		) {
			const replacement =
				typeof reference.alt === "string" ? reference.alt : "";
			result = result.replaceAll(reference.matched_text, replacement);
		}
	}
	return result;
}

function getVisibleText(message: Message): string | undefined {
	if (
		message.recipient !== "all" ||
		message.metadata?.is_visually_hidden_from_conversation === true ||
		message.content?.content_type !== "text" ||
		!Array.isArray(message.content.parts)
	) {
		return undefined;
	}
	const text = removeCitations(
		message.content.parts.filter((part) => typeof part === "string").join("\n"),
		message.metadata?.content_references,
	).trim();
	return text === "" ? undefined : text;
}

/**
 * Reads every string the page hands to its stream. The literals are scanned rather than matched,
 * because a pattern for a quoted literal backtracks past the engine's limit on a long conversation
 * and then reports no match instead of an error, which cannot be told apart from an empty page.
 */
function readEnqueuedChunks(html: string) {
	const chunks: string[] = [];
	let at = html.indexOf(enqueueMarker);
	while (at !== -1) {
		let index = at + enqueueMarker.length;
		if (html[index] === '"') {
			const start = index;
			index += 1;
			while (index < html.length && html[index] !== '"') {
				index += html[index] === "\\" ? 2 : 1;
			}
			if (index >= html.length) {
				break;
			}
			chunks.push(JSON.parse(html.slice(start, index + 1)) as string);
		}
		at = html.indexOf(enqueueMarker, index);
	}
	return chunks;
}

export async function readChatGptShare(url: string): Promise<Conversation> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${url} returned ${response.status}.`);
	}
	const html = await response.text();
	const firstLine = readEnqueuedChunks(html).join("").split("\n")[0];
	if (!firstLine) {
		throw new Error(`${url} contains no conversation data.`);
	}
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
		if (!node.message || (role !== "user" && role !== "assistant")) {
			continue;
		}
		const text = getVisibleText(node.message);
		if (text !== undefined) {
			turns.push({ role, text });
		}
	}

	return {
		title: shared.title,
		createdAt: new Date(shared.create_time * millisecondsPerSecond),
		assistant: "ChatGPT",
		turns,
	};
}
