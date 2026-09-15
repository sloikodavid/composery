"use node";

import {
	runSshCommand,
	type SshConnectionOptions,
	SshError,
} from "./connection";
import { discoverScript } from "./discover_script";

const maxOutputBytes = 262_144;
const maxAccounts = 50;
const maxSources = 40;
const maxTextLength = 4096;

export type SshKeySource =
	| Readonly<{
			kind: "file";
			path: string;
			state: "present" | "missing" | "unsafe" | "unreadable";
	  }>
	| Readonly<{ kind: "command"; command: string }>
	| Readonly<{ kind: "certificate"; setting: string; value: string }>;

export type SshAccount = Readonly<{
	name: string;
	home: string;
	shell: string;
	/** The SSH server accepts public keys for this account, in the context we asked about. */
	acceptsPublicKeys: boolean;
	/** A key alone completes a login, rather than being one step of several. */
	publicKeyAloneSignsIn: boolean;
	sources: readonly SshKeySource[];
}>;

export type SshDiscovery = Readonly<{
	port: number;
	usesPam: boolean;
	strictModes: boolean;
	accounts: readonly SshAccount[];
	/** What this report cannot establish, in our words, for a caller to pass on unchanged. */
	unknowns: readonly string[];
}>;

function toText(value: unknown) {
	return typeof value === "string" && value.length <= maxTextLength
		? value
		: null;
}

function toSource(value: unknown): SshKeySource | null {
	if (value === null || typeof value !== "object") {
		return null;
	}
	const source = value as Record<string, unknown>;
	const path = toText(source.path);
	const state = toText(source.state);
	if (
		source.kind === "file" &&
		path !== null &&
		(state === "present" ||
			state === "missing" ||
			state === "unsafe" ||
			state === "unreadable")
	) {
		return { kind: "file", path, state };
	}
	const command = toText(source.command);
	if (source.kind === "command" && command !== null) {
		return { kind: "command", command };
	}
	const setting = toText(source.setting);
	const settingValue = toText(source.value);
	if (
		source.kind === "certificate" &&
		setting !== null &&
		settingValue !== null
	) {
		return { kind: "certificate", setting, value: settingValue };
	}
	return null;
}

function toAccount(value: unknown): SshAccount | null {
	if (value === null || typeof value !== "object") {
		return null;
	}
	const account = value as Record<string, unknown>;
	const name = toText(account.name);
	const home = toText(account.home);
	const shell = toText(account.shell);
	if (name === null || home === null || shell === null) {
		return null;
	}
	const sources = Array.isArray(account.sources)
		? account.sources.slice(0, maxSources).map(toSource)
		: [];
	return {
		name,
		home,
		shell,
		acceptsPublicKeys: account.acceptsPublicKeys === true,
		publicKeyAloneSignsIn: account.publicKeyAloneSignsIn === true,
		sources: sources.filter(
			(source): source is SshKeySource => source !== null,
		),
	};
}

function toUnknowns(discovery: SshDiscovery) {
	const unknowns = [
		"The SSH server's configuration was read from disk, which the running daemon need not have reloaded.",
		"An account that a directory service resolves on demand need not appear in this list.",
	];
	if (discovery.usesPam) {
		unknowns.push(
			"PAM decides whether an account may finish a login, and its policy was not evaluated.",
		);
	}
	if (
		discovery.accounts.some((account) =>
			account.sources.some((source) => source.kind === "command"),
		)
	) {
		unknowns.push(
			"A key command answers for each key and connection, so its keys cannot be listed.",
		);
	}
	return unknowns;
}

/**
 * Asks a server which accounts can sign in with a key, and which key sources apply to each.
 * The server's own SSH server answers; nothing here assumes a path or an account. The reply is
 * validated as untrusted input, because the customer controls the program that produced it.
 */
export async function discoverSshAccounts(
	connection: SshConnectionOptions,
): Promise<SshDiscovery> {
	const result = await runSshCommand(
		connection,
		// Only repository-owned source enters the command; the server's own data comes back as JSON.
		`/usr/bin/python3 -I -X utf8 -c '${discoverScript.replaceAll("'", "'\\''")}'`,
		{ maxOutputBytes },
	);
	if (result.exitCode !== 0) {
		throw new SshError("command_unavailable");
	}
	let reported: unknown;
	try {
		reported = JSON.parse(result.stdout);
	} catch {
		throw new SshError("invalid_response");
	}
	if (reported === null || typeof reported !== "object") {
		throw new SshError("invalid_response");
	}
	const report = reported as Record<string, unknown>;
	if (report.error === "sshd_unavailable") {
		throw new SshError("command_unavailable");
	}
	const accounts = Array.isArray(report.accounts)
		? report.accounts.slice(0, maxAccounts).map(toAccount)
		: null;
	if (accounts === null || typeof report.port !== "number") {
		throw new SshError("invalid_response");
	}
	const discovery: SshDiscovery = {
		port: report.port,
		usesPam: report.usesPam === true,
		strictModes: report.strictModes === true,
		accounts: accounts.filter(
			(account): account is SshAccount => account !== null,
		),
		unknowns: [],
	};
	return { ...discovery, unknowns: toUnknowns(discovery) };
}
