import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { stopOwnedProcess, waitForProcessExit } from "../../harness/process";

const processCheckTimeoutMs = 1000;

test("a spawn error does not count as a process exit", async () => {
	const child = spawn("composery-process-that-does-not-exist", [], {
		stdio: "ignore",
	});

	expect(await waitForProcessExit(child, processCheckTimeoutMs)).toBe(false);
});

test("an owned disposable process exits after cleanup", async () => {
	const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
		stdio: "ignore",
		detached: process.platform !== "win32",
	});
	try {
		await stopOwnedProcess(child);
		expect(await waitForProcessExit(child, processCheckTimeoutMs)).toBe(true);
	} finally {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGKILL");
		}
	}
});
