"use node";

import { isIP } from "node:net";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { SshError, type SshFailure } from "./errors";

const maxPort = 65_535;
const maxTimeoutMs = 60_000;

/** Exit codes that a POSIX shell returns when it cannot run a command. */
const commandNotExecutableExitCode = 126;
const commandNotFoundExitCode = 127;
export const commandExitCodes: ReadonlySet<number> = new Set([
	commandNotExecutableExitCode,
	commandNotFoundExitCode,
]);

/** A server that Composery connects to, and the account it names there. */
export type SshTarget = Readonly<{
	/** Resolve from trusted allocation state, never a caller-supplied URL. */
	address: string;
	port: number;
	username: string;
	/** SSH wire-format public key from an independent trusted path. */
	hostKey: Uint8Array;
	timeoutMs: number;
	signal?: AbortSignal;
}>;

export type SshConnectionOptions = SshTarget & Readonly<{ privateKey: string }>;

export type SshClientScope = {
	client: Client;
	signal: AbortSignal;
	fail: (error: SshError) => void;
};

/** Each pending protocol request owns and removes its cancellation listener. */
export function callSsh<T>(
	signal: AbortSignal,
	start: (done: (error: Error | undefined, value: T) => void) => void,
): Promise<T> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		try {
			start((error, value) => {
				signal.removeEventListener("abort", abort);
				if (signal.aborted) {
					reject(signal.reason);
					return;
				}
				if (error) {
					reject(
						error instanceof SshError ? error : new SshError("remote_error"),
					);
				} else {
					resolve(value);
				}
			});
		} catch (error) {
			signal.removeEventListener("abort", abort);
			reject(error instanceof SshError ? error : new SshError("remote_error"));
		}
	});
}

function toConnectionFailure(
	hostMismatch: boolean,
	error: Error & { level?: string },
): SshFailure {
	if (hostMismatch) {
		return "host_key_mismatch";
	}
	return error.level === "client-authentication"
		? "authentication_failed"
		: "connection_failed";
}

function isValidSshTarget(target: SshTarget) {
	return (
		isIP(target.address) !== 0 &&
		Number.isInteger(target.port) &&
		target.port >= 1 &&
		target.port <= maxPort &&
		target.username !== "" &&
		!target.username.includes("\0") &&
		Buffer.from(target.username, "utf8").toString("utf8") === target.username &&
		target.hostKey.length > 0 &&
		Number.isSafeInteger(target.timeoutMs) &&
		target.timeoutMs >= 1 &&
		target.timeoutMs <= maxTimeoutMs
	);
}

/**
 * Owns one client, its deadline and its cancellation, and connects it to the pinned host with the
 * authentication the caller chooses. `run` must await all protocol work.
 */
export async function withSshClient<T>(
	target: SshTarget,
	run: (
		scope: SshClientScope & {
			connect: (
				authentication: Pick<ConnectConfig, "authHandler" | "privateKey">,
			) => void;
		},
	) => Promise<T>,
): Promise<T> {
	const input = { ...target, hostKey: Uint8Array.from(target.hostKey) };
	if (!isValidSshTarget(input)) {
		throw new SshError("invalid_request");
	}
	const pin = Buffer.from(input.hostKey);
	const client = new Client();
	const lifetime = new AbortController();
	const signal = lifetime.signal;
	const cancel = () => lifetime.abort(new SshError("aborted"));
	input.signal?.addEventListener("abort", cancel, { once: true });
	if (input.signal?.aborted) {
		cancel();
	}
	const timer = setTimeout(
		() => lifetime.abort(new SshError("deadline_exceeded")),
		input.timeoutMs,
	);
	let hostMismatch = false;
	client.on("error", (error: Error & { level?: string }) => {
		lifetime.abort(new SshError(toConnectionFailure(hostMismatch, error)));
	});
	client.on("close", () => lifetime.abort(new SshError("connection_closed")));
	try {
		return await run({
			client,
			signal,
			fail: (error) => lifetime.abort(error),
			connect: (authentication) =>
				client.connect({
					...authentication,
					host: input.address,
					port: input.port,
					username: input.username,
					readyTimeout: input.timeoutMs,
					hostVerifier: (key: Buffer) => {
						const accepted = pin.equals(key);
						hostMismatch ||= !accepted;
						return accepted;
					},
				}),
		});
	} finally {
		clearTimeout(timer);
		input.signal?.removeEventListener("abort", cancel);
		// Destroy also releases remote handles after errors, cancellation, or stalls.
		client.destroy();
	}
}

/** Own one signed-in connection and its deadline. Operations must await all protocol work. */
export async function withSshConnection<T>(
	options: SshConnectionOptions,
	operation: (scope: SshClientScope) => Promise<T>,
): Promise<T> {
	if (!options.privateKey) {
		throw new SshError("invalid_request");
	}
	return await withSshClient(
		options,
		async ({ client, signal, fail, connect }) => {
			await callSsh<void>(signal, (done) => {
				client.once("ready", () => done(undefined, undefined));
				connect({ privateKey: options.privateKey, authHandler: ["publickey"] });
			});
			return await operation({ client, signal, fail });
		},
	);
}

/**
 * The command that runs one repository-owned program on a server. The interpreter is an absolute
 * path because a search path belongs to whoever owns the server, and the program is the only
 * thing that enters shell syntax: everything a caller supplies travels on stdin.
 */
export function toSshProgramCommand(program: string) {
	return `/usr/bin/python3 -I -X utf8 -c '${program.replaceAll("'", "'\\''")}'`;
}

export type SshCommandResult = Readonly<{
	stdout: string;
	stderr: string;
	/** Null when a signal ended the command, so an outcome cannot be read from it. */
	exitCode: number | null;
}>;

/**
 * Runs one repository-owned command and returns its bounded output. Caller data belongs on
 * stdin, never in the command: the account names and paths a server reports are its own.
 */
export async function runSshCommand(
	connection: SshConnectionOptions,
	command: string,
	options: Readonly<{ input?: Buffer; maxOutputBytes: number }>,
): Promise<SshCommandResult> {
	return await withSshConnection(
		connection,
		async ({ client, signal, fail }) => {
			const channel = await callSsh<ClientChannel>(signal, (done) => {
				client.exec(command, (error, stream) =>
					done(error ? new SshError("command_unavailable") : undefined, stream),
				);
			});
			return await callSsh<SshCommandResult>(signal, (done) => {
				const stdout: Buffer[] = [];
				const stderr: Buffer[] = [];
				let size = 0;
				let exitCode: number | null = null;
				const receive = (data: Buffer, isStdout: boolean) => {
					size += data.length;
					if (size > options.maxOutputBytes) {
						fail(new SshError("output_limit"));
						return;
					}
					(isStdout ? stdout : stderr).push(Buffer.from(data));
				};
				channel.on("data", (data: Buffer) => receive(data, true));
				channel.stderr.on("data", (data: Buffer) => receive(data, false));
				channel.on("error", () => fail(new SshError("remote_error")));
				channel.stderr.on("error", () => fail(new SshError("remote_error")));
				channel.on("exit", (code: number | null) => {
					exitCode = code;
				});
				channel.on("close", () =>
					done(undefined, {
						stdout: Buffer.concat(stdout).toString("utf8"),
						stderr: Buffer.concat(stderr).toString("utf8"),
						exitCode,
					}),
				);
				channel.end(options.input);
			});
		},
	);
}
