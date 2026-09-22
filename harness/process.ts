import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const stopTimeoutMs = 10_000;
const groupsFolderName = "process-groups";
// Windows has no process groups, so a tree is ended with taskkill instead.
const usesProcessGroups = process.platform !== "win32";

export function isProcessAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but belongs to another user.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function toGroupsFolder(runFolder: string) {
	return path.join(runFolder, groupsFolderName);
}

function signalProcessGroup(groupId: number, signal: NodeJS.Signals) {
	try {
		process.kill(-groupId, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
			throw error;
		}
	}
}

/** Starts a child this run owns, recorded so that a killed run can still be cleaned up. */
export function spawnOwnedProcess(
	command: string,
	args: readonly string[],
	options: Readonly<{
		cwd?: string;
		environment: Record<string, string>;
		/** A folder this run owns, where the groups it starts are written down. */
		runFolder: string;
	}>,
) {
	// Record ownership before awaiting, so nothing is started without an owner.
	const child = spawn(command, args, {
		cwd: options.cwd,
		env: options.environment,
		stdio: ["ignore", "pipe", "pipe"],
		detached: usesProcessGroups,
	});
	if (usesProcessGroups && child.pid !== undefined) {
		const groups = toGroupsFolder(options.runFolder);
		mkdirSync(groups, { recursive: true });
		writeFileSync(path.join(groups, String(child.pid)), "");
	}
	return child;
}

/** Ends the groups a run wrote down, which a later run does before removing its files. */
export function killOwnedProcessGroups(runFolder: string) {
	const groups = toGroupsFolder(runFolder);
	if (!usesProcessGroups || !existsSync(groups)) {
		return;
	}
	for (const name of readdirSync(groups)) {
		signalProcessGroup(Number(name), "SIGKILL");
	}
}

export function waitForProcessExit(child: ChildProcess, timeoutMs: number) {
	return new Promise<boolean>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve(true);
			return;
		}
		let settled = false;
		const finish = (exited: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			child.removeListener("exit", onExit);
			child.removeListener("error", onError);
			resolve(exited);
		};
		const onExit = () => finish(true);
		// An error means that no exit event may arrive. It does not prove that
		// the process has stopped, so callers must keep their escalation path.
		const onError = () => finish(false);
		const timer = setTimeout(() => finish(false), timeoutMs);
		child.once("exit", onExit);
		child.once("error", onError);
	});
}

export async function stopOwnedProcess(child: ChildProcess) {
	if (child.pid === undefined) {
		return;
	}
	if (!usesProcessGroups) {
		// Windows needs taskkill to include child processes.
		if (child.exitCode === null) {
			spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
		}
		if (!(await waitForProcessExit(child, stopTimeoutMs))) {
			throw new Error(
				`Owned process ${child.pid} did not stop after taskkill.`,
			);
		}
		return;
	}
	signalProcessGroup(child.pid, "SIGTERM");
	if (await waitForProcessExit(child, stopTimeoutMs)) {
		return;
	}
	// Escalate only after the graceful wait expires, then wait for the leader.
	signalProcessGroup(child.pid, "SIGKILL");
	if (!(await waitForProcessExit(child, stopTimeoutMs))) {
		throw new Error(`Owned process ${child.pid} did not stop after SIGKILL.`);
	}
}
