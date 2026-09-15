import { spawnSync } from "node:child_process";
import { hostname } from "node:os";

const maxOutputBytes = 16_777_216;
const ownerLabel = "composery.test.owner";
const hostLabel = "composery.test.host";

export class DockerUnavailableError extends Error {
	constructor(detail: string) {
		super(
			`These tests need Docker, and it is not usable here: ${detail}. Start Docker Desktop, or the Docker service on Linux, and run the tests again.`,
		);
		this.name = "DockerUnavailableError";
	}
}

/** Runs one Docker CLI command and returns its trimmed output, or throws with Docker's own words. */
export function runDocker(args: readonly string[], input?: string) {
	const result = spawnSync("docker", args, {
		encoding: "utf8",
		input,
		maxBuffer: maxOutputBytes,
	});
	if (result.error !== undefined) {
		throw new DockerUnavailableError(result.error.message);
	}
	if (result.status !== 0) {
		throw new Error(
			`docker ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`,
		);
	}
	return result.stdout.trim();
}

export function requireDocker() {
	const result = spawnSync(
		"docker",
		["version", "--format", "{{.Server.Version}}"],
		{
			encoding: "utf8",
		},
	);
	if (result.error !== undefined || result.status !== 0) {
		throw new DockerUnavailableError(
			(result.error?.message ?? result.stderr).trim() ||
				"the daemon did not answer",
		);
	}
}

function isProcessAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// A process that exists but belongs to someone else refuses the signal instead of vanishing.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * The labels that let a later run find this run's containers. A container outlives a test process
 * that is killed, because Docker, not the process, owns it.
 */
export function toDockerOwnerLabels(kind: string) {
	return [
		"--label",
		`composery.test.kind=${kind}`,
		"--label",
		`${ownerLabel}=${process.pid}`,
		"--label",
		`${hostLabel}=${hostname()}`,
	];
}

/** Removes containers of this kind that a test process on this machine started and did not live to remove. */
export function removeOrphanedDockerContainers(kind: string) {
	const listing = runDocker([
		"ps",
		"--all",
		"--filter",
		`label=composery.test.kind=${kind}`,
		"--filter",
		`label=${hostLabel}=${hostname()}`,
		"--format",
		`{{.ID}} {{.Label "${ownerLabel}"}}`,
	]);
	for (const line of listing.split("\n")) {
		const [id, owner] = line.trim().split(" ");
		const pid = Number(owner);
		if (id && Number.isSafeInteger(pid) && pid > 0 && !isProcessAlive(pid)) {
			runDocker(["rm", "--force", id]);
		}
	}
}
