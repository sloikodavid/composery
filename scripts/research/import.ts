import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chatGptShareUrl, readChatGptShare } from "./chat-gpt";
import type { Conversation } from "./conversation";

const researchDirectory = join(
	import.meta.dirname,
	"..",
	"..",
	"docs",
	"research",
);

const readers: {
	url: RegExp;
	read: (url: string) => Promise<Conversation>;
}[] = [{ url: chatGptShareUrl, read: readChatGptShare }];

function toKebabCase(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

async function importConversation(url: string): Promise<string> {
	const reader = readers.find((candidate) => candidate.url.test(url));
	if (!reader) {
		throw new Error(`No reader supports ${url}.`);
	}
	const conversation = await reader.read(url);

	const date = conversation.createdAt.toISOString().slice(0, 10);
	const file = join(
		researchDirectory,
		`${date}-${toKebabCase(conversation.title)}.md`,
	);
	const header = `# ${conversation.title}\n\nSource: ${url}\n`;
	const existing = Bun.file(file);
	if (
		(await existing.exists()) &&
		!(await existing.text()).startsWith(header)
	) {
		throw new Error(`${file} already exists for another conversation.`);
	}

	const turns = conversation.turns.map(({ role, text }) => {
		const label = role === "user" ? "User" : conversation.assistant;
		return `---\n\n**${label}**\n\n${text}`;
	});
	await Bun.write(file, `${header}\n${turns.join("\n\n")}\n`);
	return file;
}

const urls = process.argv.slice(2);
if (urls.length === 0) {
	console.error("Usage: bun run research:import <share-url> [...]");
	process.exit(1);
}
await mkdir(researchDirectory, { recursive: true });
for (const url of urls) {
	console.log(await importConversation(url));
}
