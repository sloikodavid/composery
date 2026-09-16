import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exportClaudeCodeSession } from "./claude-code";

const [sessionId, output] = process.argv.slice(2);
if (!sessionId || !output) {
	console.error(
		"Usage: bun run session:import <claude-code-session-id> <output-file>",
	);
	process.exit(1);
}

const outputFile = resolve(output);
const session = await exportClaudeCodeSession(sessionId);
await mkdir(dirname(outputFile), { recursive: true });
await Bun.write(outputFile, session.markdown);
console.log(`${outputFile} (${session.sessionIds.length} linked sessions)`);
