import {
	type ChildProcess,
	execFileSync,
	spawn,
	spawnSync,
} from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
	type FunctionArgs,
	type FunctionReference,
	type FunctionReturnType,
	getFunctionName,
} from "convex/server";
import { ConvexError, convexToJson, jsonToConvex } from "convex/values";
import { unzipSync } from "fflate";
import { internal } from "../../convex/_generated/api";
import { isProcessAlive, registerCleanup } from "./cleanup";
import { type ClerkFake, useClerkFake } from "./clerk/fake";
import type { ClerkUser } from "./clerk/replies";
import type { Fake } from "./fake";
import { useHetznerFake } from "./hetzner/fake";
import { convexBackendAssets, convexBackendVersion } from "./pins";
import { type SignInIssuer, startSignInIssuer } from "./sign-in";

const repositoryRoot = path.resolve(import.meta.dir, "..", "..");
const cacheRoot = path.join(repositoryRoot, "tmp", "convex-backend");

// Test deployments share one instance identity, because a storage template belongs to it.
const instanceName = "composery-test";
const instanceSecret = createHash("sha256").update(instanceName).digest("hex");
const readinessTimeoutMs = 30_000;
const readinessDelayMs = 100;
const stopTimeoutMs = 10_000;
const logLineLimit = 80;
// The first push installs external packages from the network, which can take minutes.
const pushTimeoutMs = 240_000;
const httpUdfFailedStatus = 560;
const removalRetries = 10;
const removalDelayMs = 200;
const hostTagLength = 8;
// Folders name their test process and their machine, so a later run can tell whose they are.
const hostTag = createHash("sha256")
	.update(hostname())
	.digest("hex")
	.slice(0, hostTagLength);
const runFolderNamePattern = /^\d+-(\d+)-([0-9a-f]{8})$/;
const temporaryFolderNamePattern = /^cvx-(\d+)-([0-9a-f]{8})$/;
const processGroupsFolderName = "process-groups";
const lineBreakPattern = /\r?\n/;
const executableMode = 0o755;
const templateKeyLength = 16;
const encryptionKeyBytes = 32;
// The fake answers for these, and they are not Hetzner's.
const fakeControllerId = "composery-test";
const fakeFirewallId = 77;
const fakeLocations = "nbg1,fsn1,hel1";
const webhookSecretBytes = 24;
// One secret for the run: the deployment gets it, and a test signs with it as Clerk would.
const webhookSecret = `whsec_${randomBytes(webhookSecretBytes).toString("base64")}`;
const usesProcessGroups = process.platform !== "win32";

type AnyFunction = FunctionReference<
	"query" | "mutation" | "action",
	"public" | "internal"
>;

export type ConvexBackend = Readonly<{
	url: string;
	/** Calls any function, internal ones included, as the deployment's admin, to arrange a test. */
	runAsAdmin: <Reference extends AnyFunction>(
		reference: Reference,
		args: FunctionArgs<Reference>,
	) => Promise<FunctionReturnType<Reference>>;
	/** A client signed in as this Clerk user ID, or signed out without one, as the web app would be. */
	createClient: (subject?: string) => ConvexHttpClient;
	signIn: SignInIssuer["signIn"];
	/** Everything the backend has written, which is where a function's own failure is named. */
	readLog: () => string;
	/** Where HTTP actions answer, such as the Clerk webhook and a server's host key report. */
	siteUrl: string;
	/** The signing secret this run gave the deployment, so a test can sign a webhook as Clerk does. */
	webhookSecret: string;
	/** The accounts Clerk would hold, which a test fills before it asks Composery to read them. */
	clerk: ClerkFake;
	/**
	 * One account, as it really exists: held by Clerk and synced into our tables. A test that made
	 * only the second half would be describing a person Clerk never heard of, and the hourly
	 * reconcile would rightly delete them part way through the test.
	 */
	createAccount: (clerkUserId?: string) => Promise<ClerkUser>;
	/**
	 * The keys this run gave the deployment, the one that encrypts first. The deployment runs with a
	 * second key from the start, as it does part way through a rotation, so a test can hold a stored
	 * value to either.
	 */
	sshAccessEncryptionKeys: readonly [string, string];
}>;

const accountSuffixBytes = 6;

/** What every process of one test run shares. */
type RunContext = Readonly<{
	binary: string;
	adminKey: string;
	folder: string;
	environment: Record<string, string>;
}>;

type RunningBackend = Readonly<{
	url: string;
	/** Where HTTP actions answer, which is a second port of the same backend. */
	siteUrl: string;
	stop: () => Promise<void>;
	/** The backend's latest log lines, which say why a push or a request failed. */
	readLog: () => string;
}>;

function findFreePort() {
	return new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() =>
				resolve(
					typeof address === "object" && address !== null ? address.port : 0,
				),
			);
		});
	});
}

/**
 * The environment of every process a run starts, built from nothing. A developer's own deployment,
 * login and tokens are exported in their shell, and a process that inherited them could act on the
 * real deployment.
 */
function toChildEnvironment(temporary: string) {
	mkdirSync(temporary, { recursive: true });
	// biome-ignore-start lint/style/useNamingConvention: environment variable names use CONSTANT_CASE
	const environment: Record<string, string> = {
		PATH: process.env.PATH ?? "",
		HOME: temporary,
		USERPROFILE: temporary,
		TEMP: temporary,
		TMP: temporary,
		TMPDIR: temporary,
	};
	// biome-ignore-end lint/style/useNamingConvention: environment variable names use CONSTANT_CASE
	// Windows programs need these to start at all.
	for (const name of ["SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
		const value = process.env[name];
		if (value) {
			environment[name] = value;
		}
	}
	return environment;
}

/**
 * A short temporary folder for one run. The backend's Node executor listens on a Unix socket inside
 * it, and Linux refuses a socket path longer than 108 bytes, which a folder inside the repository
 * exceeds.
 */
function toTemporaryFolder() {
	return path.join(tmpdir(), `cvx-${process.pid}-${hostTag}`);
}

function removeFolder(folder: string) {
	rmSync(folder, {
		recursive: true,
		force: true,
		maxRetries: removalRetries,
		retryDelay: removalDelayMs,
	});
}

/**
 * Removes what this run made, and says so rather than failing when the operating system still
 * holds a file. Both folders name the process that made them, so the next run removes what is left
 * once this process is gone. A green suite must not go red because Windows was slow to let go.
 */
function removeWhenPossible(remove: () => void, folder: string) {
	try {
		remove();
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		process.stderr.write(
			`${folder} is still held, so the next run will remove it: ${reason}
`,
		);
	}
}

/** Removes a run folder, unlinking its links to the repository's modules before a recursive walk. */
function removeRunFolder(folder: string) {
	for (const workspace of ["workspace", "template-workspace"]) {
		rmSync(path.join(folder, workspace, "node_modules"), { force: true });
	}
	removeFolder(folder);
}

/** Signals every process in a group, and ignores a group whose processes have all exited. */
function signalProcessGroup(groupId: number, signal: NodeJS.Signals) {
	try {
		process.kill(-groupId, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
			throw error;
		}
	}
}

/**
 * Ends the processes that ran in the groups a dead run recorded, then removes its folder. A group ID
 * cannot be reused while any process in it is alive, so a group that still exists is that run's.
 */
function removeOrphanedRunFolder(folder: string) {
	const groups = path.join(folder, processGroupsFolderName);
	if (usesProcessGroups && existsSync(groups)) {
		for (const name of readdirSync(groups)) {
			signalProcessGroup(Number(name), "SIGKILL");
		}
	}
	removeRunFolder(folder);
}

/**
 * Removes the folders of runs whose test process on this machine is gone. The owner is in each
 * folder's name rather than in a file inside it, so a folder that a failed removal emptied halfway
 * is still known.
 */
function removeOrphanedFolders(runsRoot: string) {
	for (const [root, pattern, remove] of [
		[runsRoot, runFolderNamePattern, removeOrphanedRunFolder],
		[tmpdir(), temporaryFolderNamePattern, removeFolder],
	] as const) {
		if (!existsSync(root)) {
			continue;
		}
		for (const name of readdirSync(root)) {
			const [, pid, host] = pattern.exec(name) ?? [];
			if (host === hostTag && !isProcessAlive(Number(pid))) {
				remove(path.join(root, name));
			}
		}
	}
}

/**
 * Starts a process that this run owns with everything it starts in turn. On Linux a Node executor
 * outlives a signal sent to the backend alone, so outside Windows each process leads its own group
 * and the group is recorded, before any await, for a later run to end if this one dies.
 */
function spawnOwned(
	context: RunContext,
	command: string,
	args: readonly string[],
	options: Readonly<{ cwd?: string; environment?: Record<string, string> }>,
) {
	const child = spawn(command, args, {
		cwd: options.cwd,
		env: options.environment ?? context.environment,
		stdio: ["ignore", "pipe", "pipe"],
		detached: usesProcessGroups,
	});
	if (usesProcessGroups && child.pid !== undefined) {
		const groups = path.join(context.folder, processGroupsFolderName);
		mkdirSync(groups, { recursive: true });
		writeFileSync(path.join(groups, String(child.pid)), "");
	}
	return child;
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
	return new Promise<void>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, timeoutMs);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

/** Stops a process started by spawnOwned and everything it started. */
async function stopOwned(child: ChildProcess) {
	if (child.pid === undefined) {
		return;
	}
	if (!usesProcessGroups) {
		// Windows ends only the process it is named, unless it is asked for the tree.
		if (child.exitCode === null) {
			spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
		}
		await waitForExit(child, stopTimeoutMs);
		return;
	}
	signalProcessGroup(child.pid, "SIGTERM");
	await waitForExit(child, stopTimeoutMs);
	// Anything in the group that ignored the request is ended outright.
	signalProcessGroup(child.pid, "SIGKILL");
}

/** Downloads the pinned backend once, refuses it unless its digest matches, and keeps it in tmp. */
async function requireBackendBinary() {
	const asset = convexBackendAssets[`${process.platform}-${process.arch}`];
	if (asset === undefined) {
		throw new Error(
			`No Convex backend release is pinned for ${process.platform}-${process.arch}.`,
		);
	}
	const fileName =
		process.platform === "win32"
			? "convex-local-backend.exe"
			: "convex-local-backend";
	const directory = path.join(cacheRoot, "binaries", convexBackendVersion);
	const binary = path.join(directory, fileName);
	if (existsSync(binary)) {
		return binary;
	}
	const response = await fetch(
		`https://github.com/get-convex/convex-backend/releases/download/${convexBackendVersion}/${asset.name}`,
	);
	if (!response.ok) {
		throw new Error(
			`Downloading the Convex backend failed with ${response.status}.`,
		);
	}
	const archive = new Uint8Array(await response.arrayBuffer());
	const digest = createHash("sha256").update(archive).digest("hex");
	if (digest !== asset.sha256) {
		throw new Error(
			`The downloaded Convex backend has digest ${digest}, not the pinned ${asset.sha256}.`,
		);
	}
	const extracted = unzipSync(archive)[fileName];
	if (extracted === undefined) {
		throw new Error(`The Convex backend archive has no ${fileName}.`);
	}
	mkdirSync(directory, { recursive: true });
	// Written beside its final name and renamed, so a concurrent run never executes half a file.
	const partial = `${binary}.${process.pid}.partial`;
	writeFileSync(partial, extracted);
	chmodSync(partial, executableMode);
	try {
		renameSync(partial, binary);
	} catch (error) {
		rmSync(partial, { force: true });
		if (!existsSync(binary)) {
			throw error;
		}
	}
	return binary;
}

async function startBackend(
	context: RunContext,
	storage: string,
): Promise<RunningBackend> {
	mkdirSync(storage, { recursive: true });
	const cloudPort = await findFreePort();
	const sitePort = await findFreePort();
	const child = spawnOwned(
		context,
		context.binary,
		[
			path.join(storage, "backend.sqlite3"),
			"--port",
			String(cloudPort),
			"--site-proxy-port",
			String(sitePort),
			"--instance-name",
			instanceName,
			"--instance-secret",
			instanceSecret,
			"--local-storage",
			storage,
		],
		{},
	);
	const log: string[] = [];
	const keep = (chunk: Buffer) => {
		log.push(...chunk.toString().split(lineBreakPattern).filter(Boolean));
		log.splice(0, Math.max(0, log.length - logLineLimit));
	};
	child.stdout?.on("data", keep);
	child.stderr?.on("data", keep);
	const url = `http://127.0.0.1:${cloudPort}`;
	const backend: RunningBackend = {
		url,
		siteUrl: `http://127.0.0.1:${sitePort}`,
		stop: () => stopOwned(child),
		readLog: () => log.join("\n"),
	};
	const deadline = Date.now() + readinessTimeoutMs;
	while (Date.now() < deadline && child.exitCode === null) {
		const isReady = await fetch(`${url}/version`).then(
			(reply) => reply.ok,
			() => false,
		);
		if (isReady) {
			return backend;
		}
		await Bun.sleep(readinessDelayMs);
	}
	await backend.stop();
	throw new Error(`The Convex backend did not start:\n${backend.readLog()}`);
}

async function setEnvironmentVariables(
	context: RunContext,
	backend: RunningBackend,
	variables: Record<string, string>,
) {
	const reply = await fetch(`${backend.url}/api/update_environment_variables`, {
		method: "POST",
		headers: {
			// biome-ignore lint/style/useNamingConvention: HTTP defines the Authorization header name
			Authorization: `Convex ${context.adminKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			changes: Object.entries(variables).map(([name, value]) => ({
				name,
				value,
			})),
		}),
	});
	if (!reply.ok) {
		throw new Error(
			`Setting environment variables failed: ${await reply.text()}`,
		);
	}
}

/**
 * What the deployment reads, all of it made up here: sign-in answers to this run's issuer, and
 * Hetzner is this run's fake on loopback. No value of yours can reach a test.
 */
/** Two new keys, the one that encrypts first. */
async function readIssuerKeys(issuer: SignInIssuer) {
	const reply = await fetch(`${issuer.url}/.well-known/jwks.json`);
	return await reply.json();
}

function toSshAccessEncryptionKeys() {
	return [
		randomBytes(encryptionKeyBytes).toString("base64"),
		randomBytes(encryptionKeyBytes).toString("base64"),
	] as const;
}

function toDeploymentVariables(
	issuer: SignInIssuer,
	fake: Fake,
	clerk: ClerkFake,
	sshAccessEncryptionKeys: readonly string[],
) {
	return {
		// biome-ignore-start lint/style/useNamingConvention: environment variable names use CONSTANT_CASE
		CLERK_FRONTEND_API_URL: issuer.url,
		CLERK_SECRET_KEY: "sk_test_composery_tests_never_reach_clerk",
		CLERK_WEBHOOK_SIGNING_SECRET: webhookSecret,
		CLERK_API_URL: clerk.url,
		HCLOUD_TOKEN: "composery_tests_never_reach_hetzner",
		HCLOUD_LOCATIONS: fakeLocations,
		HCLOUD_FIREWALL_ID: String(fakeFirewallId),
		HCLOUD_CONTROLLER_ID: fakeControllerId,
		HCLOUD_IMAGE: "ubuntu-24.04",
		HCLOUD_FAKE_URL: fake.url,
		SSH_ACCESS_ENCRYPTION_KEYS: sshAccessEncryptionKeys.join(","),
		// biome-ignore-end lint/style/useNamingConvention: environment variable names use CONSTANT_CASE
	};
}

/**
 * Pushes the repository's functions from a copy. Convex keeps a package external only when an import
 * resolves inside the project folder, so the functions sit beside a link to the repository's modules.
 */
async function pushFunctions(
	context: RunContext,
	backend: RunningBackend,
	workspaceName: string,
) {
	const workspace = path.join(context.folder, workspaceName);
	mkdirSync(workspace, { recursive: true });
	for (const file of ["package.json", "tsconfig.base.json", "convex.json"]) {
		copyFileSync(path.join(repositoryRoot, file), path.join(workspace, file));
	}
	cpSync(path.join(repositoryRoot, "convex"), path.join(workspace, "convex"), {
		recursive: true,
	});
	symlinkSync(
		path.join(repositoryRoot, "node_modules"),
		path.join(workspace, "node_modules"),
		"dir",
	);
	const push = spawnOwned(
		context,
		"node",
		[
			path.join(repositoryRoot, "node_modules", "convex", "bin", "main.js"),
			"dev",
			"--once",
			"--typecheck",
			"disable",
			"--codegen",
			"disable",
			"--tail-logs",
			"disable",
		],
		{
			cwd: workspace,
			environment: {
				...context.environment,
				// biome-ignore-start lint/style/useNamingConvention: the Convex CLI reads these names
				CONVEX_SELF_HOSTED_URL: backend.url,
				CONVEX_SELF_HOSTED_ADMIN_KEY: context.adminKey,
				// biome-ignore-end lint/style/useNamingConvention: the Convex CLI reads these names
			},
		},
	);
	let output = "";
	push.stdout?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	push.stderr?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	const timedOut = Symbol("timed out");
	let timer: ReturnType<typeof setTimeout> | undefined;
	const code = await Promise.race([
		new Promise<number | null>((resolve) => push.once("exit", resolve)),
		new Promise<typeof timedOut>((resolve) => {
			timer = setTimeout(() => resolve(timedOut), pushTimeoutMs);
		}),
	]);
	clearTimeout(timer);
	if (code === timedOut) {
		await stopOwned(push);
	}
	if (code !== 0) {
		throw new Error(
			[
				code === timedOut
					? `Pushing functions to the test backend did not finish in ${pushTimeoutMs} ms.`
					: `Pushing functions to the test backend failed with exit code ${String(code)}.`,
				"--- push output ---",
				output.trim(),
				"--- backend log ---",
				backend.readLog(),
			].join("\n"),
		);
	}
}

function readPackageVersion(name: string) {
	return JSON.parse(
		readFileSync(
			path.join(repositoryRoot, "node_modules", name, "package.json"),
			"utf8",
		),
	).version as string;
}

/**
 * A backend's storage after one push, kept so that later runs start from it. A fresh backend installs
 * external packages from the network during its first push, which takes a minute; a copy of this
 * storage already holds them. It holds functions and no data, and a change to what it depends on
 * names a new template.
 */
async function requireStorageTemplate(context: RunContext) {
	const key = createHash("sha256")
		.update(
			JSON.stringify([
				convexBackendVersion,
				readPackageVersion("convex"),
				readPackageVersion("ssh2"),
				readFileSync(path.join(repositoryRoot, "convex.json"), "utf8"),
			]),
		)
		.digest("hex")
		.slice(0, templateKeyLength);
	const template = path.join(cacheRoot, "templates", key);
	if (existsSync(template)) {
		return template;
	}
	const building = path.join(context.folder, "template");
	const issuer = startSignInIssuer();
	// biome-ignore lint/correctness/useHookAtTopLevel: the harness names its per-run singletons use*, and this is not React
	const fake = await useHetznerFake();
	// biome-ignore lint/correctness/useHookAtTopLevel: the harness names its per-run singletons use*, and this is not React
	const clerk = await useClerkFake();
	const backend = await startBackend(context, building);
	try {
		await setEnvironmentVariables(
			context,
			backend,
			toDeploymentVariables(issuer, fake, clerk, toSshAccessEncryptionKeys()),
		);
		await pushFunctions(context, backend, "template-workspace");
	} finally {
		await backend.stop();
		issuer.stop();
	}
	mkdirSync(path.dirname(template), { recursive: true });
	try {
		renameSync(building, template);
	} catch (error) {
		// Another run finished the same template first, which is just as good.
		if (!existsSync(template)) {
			throw error;
		}
	}
	return template;
}

async function callFunction<Reference extends AnyFunction>(
	url: string,
	authorization: string,
	reference: Reference,
	args: FunctionArgs<Reference>,
): Promise<FunctionReturnType<Reference>> {
	const reply = await fetch(`${url}/api/function`, {
		method: "POST",
		headers: {
			// biome-ignore lint/style/useNamingConvention: HTTP defines the Authorization header name
			Authorization: authorization,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			path: getFunctionName(reference),
			format: "convex_encoded_json",
			args: convexToJson(args ?? {}),
		}),
	});
	if (!reply.ok && reply.status !== httpUdfFailedStatus) {
		throw new Error(await reply.text());
	}
	const result = await reply.json();
	if (result.status === "success") {
		return jsonToConvex(result.value) as FunctionReturnType<Reference>;
	}
	if (result.errorData !== undefined) {
		throw new ConvexError(jsonToConvex(result.errorData));
	}
	throw new Error(result.errorMessage);
}

async function startConvexBackend(): Promise<ConvexBackend> {
	const binary = await requireBackendBinary();
	const runsRoot = path.join(cacheRoot, "runs");
	removeOrphanedFolders(runsRoot);
	const folder = path.join(runsRoot, `${Date.now()}-${process.pid}-${hostTag}`);
	mkdirSync(folder, { recursive: true });
	const temporary = toTemporaryFolder();
	// Registered first, so it runs last: after every process has stopped and released its files.
	registerCleanup(() => {
		removeWhenPossible(() => removeRunFolder(folder), folder);
		removeWhenPossible(() => removeFolder(temporary), temporary);
	});
	const environment = toChildEnvironment(temporary);
	const adminKey = execFileSync(
		binary,
		[
			"keygen",
			"admin-key",
			"--instance-name",
			instanceName,
			"--instance-secret",
			instanceSecret,
		],
		{ encoding: "utf8", env: environment },
	).trim();
	const context: RunContext = { binary, adminKey, folder, environment };

	const template = await requireStorageTemplate(context);
	const storage = path.join(folder, "storage");
	cpSync(template, storage, { recursive: true });
	const issuer = startSignInIssuer();
	registerCleanup(issuer.stop);
	// biome-ignore lint/correctness/useHookAtTopLevel: the harness names its per-run singletons use*, and this is not React
	const fake = await useHetznerFake();
	// biome-ignore lint/correctness/useHookAtTopLevel: the harness names its per-run singletons use*, and this is not React
	const clerk = await useClerkFake();
	// The deployment holds an account gone only when both sides name one Clerk instance, so the fake
	// publishes the keys the sign-in tokens are signed by.
	clerk.setKeys(await readIssuerKeys(issuer));
	const backend = await startBackend(context, storage);
	registerCleanup(backend.stop);
	const sshAccessEncryptionKeys = toSshAccessEncryptionKeys();
	await setEnvironmentVariables(
		context,
		backend,
		toDeploymentVariables(issuer, fake, clerk, sshAccessEncryptionKeys),
	);
	await pushFunctions(context, backend, "workspace");

	return {
		url: backend.url,
		runAsAdmin: (reference, args) =>
			callFunction(backend.url, `Convex ${adminKey}`, reference, args),
		createClient: (subject) => {
			const client = new ConvexHttpClient(backend.url, {
				skipConvexDeploymentUrlCheck: true,
				logger: false,
			});
			if (subject !== undefined) {
				client.setAuth(issuer.signIn(subject));
			}
			return client;
		},
		createAccount: async (clerkUserId) => {
			const id =
				clerkUserId ??
				`user_${randomBytes(accountSuffixBytes).toString("hex")}`;
			const account = {
				id,
				email: `${id}@example.com`,
			};
			clerk.setUser(account);
			await callFunction(
				backend.url,
				`Convex ${adminKey}`,
				internal.users.store,
				{
					users: [
						{
							clerkUserId: account.id,
							email: account.email,
						},
					],
				},
			);
			return account;
		},
		signIn: issuer.signIn,
		readLog: backend.readLog,
		siteUrl: backend.siteUrl,
		webhookSecret,
		clerk,
		sshAccessEncryptionKeys,
	};
}

let convexBackend: Promise<ConvexBackend> | undefined;

/** One backend for the whole run: each test uses its own users and records, so none sees another's. */
export function useConvexBackend() {
	convexBackend ??= startConvexBackend();
	return convexBackend;
}
