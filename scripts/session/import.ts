import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { chatGptShareUrl, readChatGptShare } from "./chat-gpt";
import { claudeCodeSessionId, readClaudeCodeSession } from "./claude-code";
import {
	renderSessionMarkdown,
	renderSessionSource,
	type Session,
} from "./markdown";

const sessionDirectory = join(
	import.meta.dirname,
	"..",
	"..",
	"docs",
	"sessions",
);

const readers: {
	/** Names the reader's file, and the files it imports. */
	name: string;
	source: RegExp;
	read: (source: string) => Promise<Session>;
}[] = [
	{ name: "chat-gpt", source: chatGptShareUrl, read: readChatGptShare },
	{
		name: "claude-code",
		source: claudeCodeSessionId,
		read: readClaudeCodeSession,
	},
];

function toKebabCase(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

async function importSession(source: string, output?: string): Promise<string> {
	const reader = readers.find((candidate) => candidate.source.test(source));
	if (!reader) {
		throw new Error(`No session reader supports ${source}.`);
	}
	const session = await reader.read(source);
	const date = session.createdAt.toISOString().slice(0, 10);
	const file = output
		? resolve(output)
		: join(
				sessionDirectory,
				`${date}-${reader.name}-${toKebabCase(session.title)}.md`,
			);
	// A later continuation adds sources after the first, so the first names the session.
	const origin = renderSessionSource(session.sources.slice(0, 1));
	const existing = Bun.file(file);
	if (
		(await existing.exists()) &&
		!(await existing.text())
			.split("\n")
			.find((line) => line.startsWith("Source: "))
			?.startsWith(origin)
	) {
		throw new Error(`${file} already exists for another session.`);
	}
	await mkdir(dirname(file), { recursive: true });
	await Bun.write(file, renderSessionMarkdown(session));
	return file;
}

const [sourceArgument, flag, outputArgument, ...rest] = process.argv.slice(2);
if (
	!sourceArgument ||
	(flag !== undefined && (flag !== "--output" || !outputArgument)) ||
	rest.length > 0
) {
	console.error("Usage: bun run session:import <source> [--output <file>]");
	process.exit(1);
}
console.log(await importSession(sourceArgument, outputArgument));
