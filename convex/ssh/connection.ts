"use node";

import { isIP } from "node:net";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { SshError, type SshFailure } from "./errors";
import { sshUnsupportedExitCode } from "./scripts/failures";
import { quoteShell } from "./scripts/shell";

const maxPort = 65_535;
const maxTimeoutMs = 60_000;

const commandNotExecutableExitCode = 126;
/** A shell that cannot run the program, and a program that says so itself, mean the same thing. */
export const commandExitCodes: ReadonlySet<number> = new Set([
	commandNotExecutableExitCode,
	sshUnsupportedExitCode,
]);

/** Resolve address and host key from trusted allocation state, not caller input. */
export type SshTarget = Readonly<{
	address: string;
	port: number;
	username: string;
	hostKey: Uint8Array;
	timeoutMs: number;
	signal?: AbortSignal;
}>;

export type SshConnectionOptions = SshTarget & Readonly<{ privateKey: string }>;

export type SshClientScope = {
	client: Client;
	signal: AbortSignal;
	fail: (error: SshError) => void;
	getAccessStatus: () => "ok" | "missing" | "mismatch" | "unknown";
};

/** An authenticated connection owned by the enclosing operation. */
export type SshConnection = SshClientScope & { target: SshTarget };

/** Only host verification and authentication refusals establish an access failure. */
export function toSshAccessStatus(
	error: unknown,
): ReturnType<SshClientScope["getAccessStatus"]> {
	if (!(error instanceof SshError)) {
		return "unknown";
	}
	switch (error.code) {
		case "host_key_mismatch":
			return "mismatch";
		case "authentication_failed":
			return "missing";
		case "invalid_request":
		case "connection_failed":
		case "connection_closed":
		case "deadline_exceeded":
		case "aborted":
		case "sftp_unavailable":
		case "file_missing":
		case "permission_denied":
		case "not_regular_file":
		case "too_large":
		case "changed_during_read":
		case "remote_error":
		case "command_unavailable":
		case "output_limit":
		case "invalid_response":
			return "unknown";
	}
}

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
	let accessStatus: ReturnType<SshClientScope["getAccessStatus"]> = "unknown";
	client.on("ready", () => {
		accessStatus = "ok";
	});
	client.on("error", (error: Error & { level?: string }) => {
		const failure = toConnectionFailure(hostMismatch, error);
		accessStatus = toSshAccessStatus(new SshError(failure));
		lifetime.abort(new SshError(failure));
	});
	client.on("close", () => {
		if (accessStatus === "ok") {
			accessStatus = "unknown";
		}
		lifetime.abort(new SshError("connection_closed"));
	});
	try {
		return await run({
			client,
			signal,
			fail: (error) => lifetime.abort(error),
			getAccessStatus: () => accessStatus,
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
		client.destroy();
	}
}

export async function withSshConnection<T>(
	options: SshConnectionOptions,
	operation: (connection: SshConnection) => Promise<T>,
): Promise<T> {
	if (!options.privateKey) {
		throw new SshError("invalid_request");
	}
	return await withSshClient(options, async ({ connect, ...scope }) => {
		const { client, signal } = scope;
		await callSsh<void>(signal, (done) => {
			client.once("ready", () => done(undefined, undefined));
			connect({ privateKey: options.privateKey, authHandler: ["publickey"] });
		});
		return await operation({
			...scope,
			target: {
				address: options.address,
				port: options.port,
				username: options.username,
				hostKey: Uint8Array.from(options.hostKey),
				timeoutMs: options.timeoutMs,
				signal,
			},
		});
	});
}

/** Runs a repository-owned program with caller data on stdin, never in shell syntax. */
export function toSshProgramCommand(program: string) {
	return `python3 -I -X utf8 -c ${quoteShell(program)}`;
}

export type SshCommandResult = Readonly<{
	stdout: string;
	stderr: string;
	/** Null means cancellation ended the command before an outcome was read. */
	exitCode: number | null;
}>;

export async function runSshCommand(
	connection: SshConnection,
	command: string,
	options: Readonly<{
		input?: Buffer;
		maxOutputBytes: number;
		onDispatch?: () => void;
	}>,
): Promise<SshCommandResult> {
	const { client, signal, fail } = connection;
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
		options.onDispatch?.();
		channel.end(options.input);
	});
}
