"use node";

import {
	runSshCommand,
	type SshConnectionOptions,
	toSshProgramCommand,
} from "./connection";
import { discoveryScript } from "./discovery_script";
import { SshError } from "./errors";

const maxOutputBytes = 262_144;
const maxAccounts = 50;
const maxSources = 40;
const maxTextLength = 4096;

const fileStates = [
	"present",
	"missing",
	"unsafe",
	"unreadable",
	"unusable",
] as const;

type FileState = (typeof fileStates)[number];

export type SshKeySource =
	| Readonly<{ kind: "file"; path: string; state: FileState }>
	| Readonly<{ kind: "command"; command: string }>
	| Readonly<{ kind: "certificate"; setting: string; value: string }>;

export type SshAccount = Readonly<{
	name: string;
	home: string;
	shell: string;
	/** The SSH server accepts public keys for this account, in the context that was asked about. */
	acceptsPublicKeys: boolean;
	/** A key alone completes a login, rather than being one step of several. */
	publicKeyAloneSignsIn: boolean;
	sources: readonly SshKeySource[];
}>;

export type SshDiscovery = Readonly<{
	usesPam: boolean;
	strictModes: boolean;
	accounts: readonly SshAccount[];
	/** What this report cannot establish, in our words, for a caller to pass on unchanged. */
	unknowns: readonly string[];
}>;

type Reported = Record<string, unknown>;

function fail(): never {
	throw new SshError("invalid_response");
}

function toObject(value: unknown): Reported {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Reported)
		: fail();
}

function toText(value: unknown) {
	return typeof value === "string" && value.length <= maxTextLength
		? value
		: fail();
}

function toFlag(value: unknown) {
	return typeof value === "boolean" ? value : fail();
}

function toFileState(value: unknown): FileState {
	const state = toText(value);
	const known = fileStates.find((candidate) => candidate === state);
	return known ?? fail();
}

function toSource(value: unknown): SshKeySource {
	const source = toObject(value);
	switch (source.kind) {
		case "file":
			return {
				kind: "file",
				path: toText(source.path),
				state: toFileState(source.state),
			};
		case "command":
			return { kind: "command", command: toText(source.command) };
		case "certificate":
			return {
				kind: "certificate",
				setting: toText(source.setting),
				value: toText(source.value),
			};
		default:
			return fail();
	}
}

function toAccount(value: unknown) {
	const account = toObject(value);
	const sources = Array.isArray(account.sources) ? account.sources : fail();
	if (sources.length > maxSources) {
		fail();
	}
	return {
		account: {
			name: toText(account.name),
			home: toText(account.home),
			shell: toText(account.shell),
			acceptsPublicKeys: toFlag(account.acceptsPublicKeys),
			publicKeyAloneSignsIn: toFlag(account.publicKeyAloneSignsIn),
			sources: sources.map(toSource),
		},
		settingsAnswered: toFlag(account.settingsAnswered),
		decidedPerConnection: toFlag(account.decidedPerConnection),
		forcedCommandOnly: toFlag(account.forcedCommandOnly),
		namesAmbiguous: toFlag(account.namesAmbiguous),
	};
}

type ReportedAccount = ReturnType<typeof toAccount>;

/** Everything the report says it could not settle, stated once, in words a caller can pass on. */
function toUnknowns(report: Reported, accounts: readonly ReportedAccount[]) {
	const unknowns = [
		"The SSH server's configuration was read from disk, which the running daemon need not have reloaded.",
		"An account that a directory service resolves on demand need not appear in this list.",
	];
	const add = (condition: boolean, text: string) => {
		if (condition) {
			unknowns.push(text);
		}
	};
	add(
		toFlag(report.usesPam),
		"PAM decides whether an account may finish a login, and its policy was not evaluated.",
	);
	add(
		toFlag(report.accountsTruncated),
		`This server has more than ${maxAccounts} accounts, and the rest are not listed.`,
	);
	add(
		accounts.some(({ account }) =>
			account.sources.some((source) => source.kind === "command"),
		),
		"A key command answers for each key and connection, so its keys cannot be listed.",
	);
	add(
		accounts.some((entry) => !entry.settingsAnswered),
		"The SSH server did not answer for every account, so some rows show the settings that apply to everyone.",
	);
	add(
		accounts.some((entry) => entry.decidedPerConnection),
		"Some accounts are allowed or denied by where a connection comes from, which is decided for each connection.",
	);
	add(
		accounts.some((entry) => entry.forcedCommandOnly),
		"Root may sign in only with a key that forces a command.",
	);
	add(
		accounts.some((entry) => entry.namesAmbiguous),
		"A key file's name holds a space, which the SSH server states in a way that cannot be split with certainty.",
	);
	return unknowns;
}

/**
 * Asks a server which accounts can sign in with a key, and which key sources apply to each.
 * The server's own SSH server answers; nothing here assumes a path or an account. The reply is
 * validated as untrusted input, because the customer controls the program that produced it, and
 * a reply that does not hold together is refused rather than repaired into something plausible.
 */
export async function discoverSshServer(
	connection: SshConnectionOptions,
): Promise<SshDiscovery> {
	const result = await runSshCommand(
		connection,
		toSshProgramCommand(discoveryScript),
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
	const report = toObject(reported);
	if (report.error === "sshd_unavailable") {
		throw new SshError("command_unavailable");
	}
	const listed = Array.isArray(report.accounts) ? report.accounts : fail();
	if (listed.length > maxAccounts) {
		fail();
	}
	const accounts = listed.map(toAccount);
	return {
		usesPam: toFlag(report.usesPam),
		strictModes: toFlag(report.strictModes),
		accounts: accounts.map((entry) => entry.account),
		unknowns: toUnknowns(report, accounts),
	};
}
