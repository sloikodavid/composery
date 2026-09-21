import { execFileSync } from "node:child_process";
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
import { isProcessAlive, registerCleanup } from "../cleanup";
import { type ClerkFake, useClerkFake } from "../clerk/fake";
import {
	type ClerkRun,
	createClerkRun,
	getClerkSecret,
	requireClerkIssuer,
	toClerkTestEmail,
} from "../clerk/real";
import type { ClerkUser } from "../clerk/replies";
import { type SignInIssuer, startSignInIssuer } from "../clerk/sign-in";
import type { Fake } from "../fake";
import { fakeServerType, useHetznerFake } from "../hetzner/fake";
import { createHetznerRun, getHetznerToken } from "../hetzner/real";
import { convexBackendAssets, convexBackendVersion } from "../pins";
import {
	killOwnedProcessGroups,
	spawnOwnedProcess,
	stopOwnedProcess,
} from "../process";

const repositoryRoot = path.resolve(import.meta.dir, "..", "..");
const cacheRoot = path.join(repositoryRoot, "tmp", "convex-backend");

// Storage templates are tied to one self-hosted Convex instance identity.
const instanceName = "composery-test";
const instanceSecret = createHash("sha256").update(instanceName).digest("hex");
const readinessTimeoutMs = 30_000;
const readinessDelayMs = 100;
const logLineLimit = 80;
const pushTimeoutMs = 240_000;
const httpUdfFailedStatus = 560;
const removalRetries = 10;
const removalDelayMs = 200;
const hostTagLength = 8;
const hostTag = createHash("sha256")
	.update(hostname())
	.digest("hex")
	.slice(0, hostTagLength);
const runFolderNamePattern = /^\d+-(\d+)-([0-9a-f]{8})$/;
const temporaryFolderNamePattern = /^cvx-(\d+)-([0-9a-f]{8})$/;
const lineBreakPattern = /\r?\n/;
const executableMode = 0o755;
const templateKeyLength = 16;
const encryptionKeyBytes = 32;
// These values are fake-provider identifiers, never Hetzner resources.
const fakeControllerId = "composery-test";
const fakeFirewallId = 77;
const fakeLocations = "nbg1,fsn1,hel1";
const webhookSecretBytes = 24;
const webhookSecret = `whsec_${randomBytes(webhookSecretBytes).toString("base64")}`;

type AnyFunction = FunctionReference<
	"query" | "mutation" | "action",
	"public" | "internal"
>;

export type ConvexBackend = Readonly<{
	url: string;
	/** Runs a function with the deployment's admin key. */
	runAsAdmin: <Reference extends AnyFunction>(
		reference: Reference,
		args: FunctionArgs<Reference>,
	) => Promise<FunctionReturnType<Reference>>;
	createClient: (subject?: string) => ConvexHttpClient;
	signIn: SignInIssuer["signIn"];
	/** Backend logs used to diagnose failed pushes and requests. */
	readLog: () => string;
	siteUrl: string;
	webhookSecret: string;
	clerk: ClerkFake;
	createAccount: (options?: { synced?: boolean }) => Promise<ClerkUser>;
	sshAccessEncryptionKeys: readonly [string, string];
}>;

const accountSuffixBytes = 6;

type RunContext = Readonly<{
	binary: string;
	adminKey: string;
	folder: string;
	environment: Record<string, string>;
}>;

type RunningBackend = Readonly<{
	url: string;
	siteUrl: string;
	stop: () => Promise<void>;
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

function toChildEnvironment(temporary: string) {
	// Start children with a clean environment so inherited credentials cannot reach a test deployment.
	mkdirSync(temporary, { recursive: true });
	// biome-ignore-start lint/style/useNamingConvention: environment variable names
	const environment: Record<string, string> = {
		PATH: process.env.PATH ?? "",
		HOME: temporary,
		USERPROFILE: temporary,
		TEMP: temporary,
		TMP: temporary,
		TMPDIR: temporary,
	};
	// biome-ignore-end lint/style/useNamingConvention: environment variable names
	for (const name of ["SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
		const value = process.env[name];
		if (value) {
			environment[name] = value;
		}
	}
	return environment;
}

function toTemporaryFolder() {
	// Keep the backend's Unix socket below Linux's 108-byte path limit.
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

function removeWhenPossible(remove: () => void, folder: string) {
	// Windows may hold files briefly after a process exits; orphan cleanup handles the remainder.
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

function removeRunFolder(folder: string) {
	for (const workspace of ["workspace", "template-workspace"]) {
		rmSync(path.join(folder, workspace, "node_modules"), { force: true });
	}
	removeFolder(folder);
}

function removeOrphanedRunFolder(folder: string) {
	killOwnedProcessGroups(folder);
	removeRunFolder(folder);
}

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

async function requireBackendBinary() {
	// Verify the pinned archive before making it executable.
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
	// Write beside the final path and rename so concurrent runs never see a partial binary.
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
	const child = spawnOwnedProcess(
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
		{ environment: context.environment, runFolder: context.folder },
	);
	let spawnError: Error | undefined;
	child.once("error", (error) => {
		spawnError = error;
	});
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
		stop: () => stopOwnedProcess(child),
		readLog: () => log.join("\n"),
	};
	const deadline = Date.now() + readinessTimeoutMs;
	while (
		Date.now() < deadline &&
		child.exitCode === null &&
		spawnError === undefined
	) {
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
	if (spawnError !== undefined) {
		throw new Error(
			`The Convex backend could not start: ${spawnError.message}`,
		);
	}
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
			// biome-ignore lint/style/useNamingConvention: external header name
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

async function readIssuerKeys(issuer: SignInIssuer) {
	// The deployment must trust the issuer that signs the test token.
	const reply = await fetch(`${issuer.url}/.well-known/jwks.json`);
	return await reply.json();
}

function toSshAccessEncryptionKeys() {
	return [
		randomBytes(encryptionKeyBytes).toString("base64"),
		randomBytes(encryptionKeyBytes).toString("base64"),
	] as const;
}

type HetznerProject = Readonly<{ controllerId: string; firewallId: number }>;

async function makeAccount(
	clerk: ClerkFake,
	clerkRun: ClerkRun | null,
): Promise<ClerkUser> {
	// Real Clerk assigns the ID; the fake can accept a test-chosen ID.
	if (clerkRun !== null) {
		return await clerkRun.createUser(toClerkTestEmail());
	}
	const id = `user_${randomBytes(accountSuffixBytes).toString("hex")}`;
	const account = { id, email: `${id}@example.com` };
	clerk.setUser(account);
	return account;
}

const fakeHetznerProject: HetznerProject = {
	controllerId: fakeControllerId,
	firewallId: fakeFirewallId,
};

type World = Readonly<{
	issuerUrl: string;
	fake: Fake;
	clerk: ClerkFake;
	sshAccessEncryptionKeys: readonly string[];
	hetzner: HetznerProject;
}>;

function toDeploymentVariables({
	issuerUrl,
	fake,
	clerk,
	sshAccessEncryptionKeys,
	hetzner,
}: World) {
	return {
		// biome-ignore-start lint/style/useNamingConvention: environment variable names
		CLERK_FRONTEND_API_URL: issuerUrl,
		CLERK_SECRET_KEY: "sk_test_composery_tests_never_reach_clerk",
		CLERK_WEBHOOK_SIGNING_SECRET: webhookSecret,
		CLERK_FAKE_URL: clerk.url,
		HCLOUD_TOKEN: "composery_tests_never_reach_hetzner",
		HCLOUD_LOCATIONS: fakeLocations,
		HCLOUD_CONTROLLER_ID: hetzner.controllerId,
		HCLOUD_IMAGE: "ubuntu-24.04",
		HCLOUD_SERVER_TYPE: fakeServerType,
		HCLOUD_FAKE_URL: fake.url,
		SSH_ACCESS_ENCRYPTION_KEYS: sshAccessEncryptionKeys.join(","),
		// biome-ignore-end lint/style/useNamingConvention: environment variable names
	};
}

async function pushFunctions(
	context: RunContext,
	backend: RunningBackend,
	workspaceName: string,
) {
	// Push from a copy so generated backend state cannot modify the working tree.
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
	const push = spawnOwnedProcess(
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
			runFolder: context.folder,
			environment: {
				...context.environment,
				// biome-ignore-start lint/style/useNamingConvention: external variable names
				CONVEX_SELF_HOSTED_URL: backend.url,
				CONVEX_SELF_HOSTED_ADMIN_KEY: context.adminKey,
				// biome-ignore-end lint/style/useNamingConvention: external variable names
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
		new Promise<number | null>((resolve) => {
			push.once("exit", (exitCode) => resolve(exitCode));
			push.once("error", () => resolve(null));
		}),
		new Promise<typeof timedOut>((resolve) => {
			timer = setTimeout(() => resolve(timedOut), pushTimeoutMs);
		}),
	]);
	clearTimeout(timer);
	if (code === timedOut) {
		await stopOwnedProcess(push);
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

async function requireStorageTemplate(context: RunContext) {
	// Cache functions and installed packages, never test data.
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
	// biome-ignore lint/correctness/useHookAtTopLevel: harness singleton
	const fake = await useHetznerFake();
	// biome-ignore lint/correctness/useHookAtTopLevel: harness singleton
	const clerk = await useClerkFake();
	const backend = await startBackend(context, building);
	try {
		await setEnvironmentVariables(
			context,
			backend,
			toDeploymentVariables({
				issuerUrl: issuer.url,
				fake,
				clerk,
				sshAccessEncryptionKeys: toSshAccessEncryptionKeys(),
				hetzner: fakeHetznerProject,
			}),
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
		// Another run may have completed the same template first.
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
			// biome-ignore lint/style/useNamingConvention: external header name
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
	// biome-ignore lint/correctness/useHookAtTopLevel: harness singleton
	const fake = await useHetznerFake();
	// biome-ignore lint/correctness/useHookAtTopLevel: harness singleton
	const clerk = await useClerkFake();
	const clerkSecret = getClerkSecret();
	const clerkRun =
		clerkSecret === null ? null : await createClerkRun(clerkSecret);
	if (clerkRun === null) {
		clerk.setKeys(await readIssuerKeys(issuer));
	}
	const backend = await startBackend(context, storage);
	registerCleanup(backend.stop);
	const sshAccessEncryptionKeys = toSshAccessEncryptionKeys();
	const hetznerToken = getHetznerToken();
	const hetzner =
		hetznerToken === null
			? fakeHetznerProject
			: await createHetznerRun(hetznerToken);
	await setEnvironmentVariables(
		context,
		backend,
		toDeploymentVariables({
			issuerUrl: clerkRun === null ? issuer.url : requireClerkIssuer(),
			fake,
			clerk,
			sshAccessEncryptionKeys,
			hetzner,
		}),
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
				client.setAuth(
					clerkRun === null
						? issuer.signIn(subject)
						: clerkRun.tokenFor(subject),
				);
			}
			return client;
		},
		createAccount: async (options) => {
			const account = await makeAccount(clerk, clerkRun);
			if (options?.synced === false) {
				return account;
			}
			const epoch = await callFunction(
				backend.url,
				`Convex ${adminKey}`,
				internal.users.issueListEpoch,
				{},
			);
			await callFunction(
				backend.url,
				`Convex ${adminKey}`,
				internal.users.store,
				{
					epoch,
					users: [
						{
							clerkUserId: account.id,
							...(account.email === undefined ? {} : { email: account.email }),
						},
					],
				},
			);
			return account;
		},
		signIn: (subject) =>
			clerkRun === null ? issuer.signIn(subject) : clerkRun.tokenFor(subject),
		readLog: backend.readLog,
		siteUrl: backend.siteUrl,
		webhookSecret,
		clerk,
		sshAccessEncryptionKeys,
	};
}

let convexBackend: Promise<ConvexBackend> | undefined;

export function useConvexBackend() {
	// One backend is shared; tests isolate themselves with their own records.
	convexBackend ??= startConvexBackend();
	return convexBackend;
}
