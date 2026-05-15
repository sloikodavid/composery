import { chown, lstat, mkdir } from "node:fs/promises";
import { parseConfig } from "./config.ts";
import { CHILD_PROCESS_DEFAULTS } from "./defaults.ts";

export async function prepareRuntimeDirs(): Promise<void> {
	await mkdir("/run/agentbox", { recursive: true });
	await mkdir("/run/code-server", { recursive: true });
	await chown(
		"/run/code-server",
		CHILD_PROCESS_DEFAULTS.userId,
		CHILD_PROCESS_DEFAULTS.groupId,
	);
	await mkdir("/var/log/supervisor", { recursive: true });
}

export async function prepareWorkspace(): Promise<void> {
	const config = parseConfig(process.env, { loadTlsFiles: false });
	if (await exists(config.workspacePath)) {
		return;
	}
	await mkdir(config.workspacePath, { recursive: true });
	await chown(
		config.workspacePath,
		CHILD_PROCESS_DEFAULTS.userId,
		CHILD_PROCESS_DEFAULTS.groupId,
	);
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	if (process.argv[2] === "--prepare-runtime-dirs") {
		await prepareRuntimeDirs();
	} else if (process.argv[2] === "--prepare-workspace") {
		await prepareWorkspace();
	} else {
		console.error(
			"usage: node /opt/agentbox/runtime.ts --prepare-runtime-dirs|--prepare-workspace",
		);
		process.exit(2);
	}
}
