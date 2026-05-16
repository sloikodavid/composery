import { chown, lstat, mkdir } from "node:fs/promises";

const USER_ID = 1000;
const GROUP_ID = 1000;
const WORKSPACE_PATH = "/home/user/Desktop";

export async function prepareRuntimeDirs(): Promise<void> {
	await mkdir("/run/persistd", { recursive: true });
	await mkdir("/var/log/supervisor", { recursive: true });
}

export async function prepareWorkspace(): Promise<void> {
	if (await exists(WORKSPACE_PATH)) {
		return;
	}
	await mkdir(WORKSPACE_PATH, { recursive: true });
	await chown(WORKSPACE_PATH, USER_ID, GROUP_ID);
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
