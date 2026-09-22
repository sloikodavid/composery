import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
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
import { type ClerkFake, startClerkFake } from "../clerk/fake";
import {
	type ClerkRun,
	createClerkRun,
	getClerkSecret,
	requireClerkIssuer,
	toClerkTestEmail,
} from "../clerk/real";
import type { ClerkUser } from "../clerk/replies";
import { type SignInIssuer, startSignInIssuer } from "../clerk/sign-in";
import { requireContractsKept } from "../contracts";
import { type HetznerFake, startHetznerFake } from "../hetzner/fake";
import { createHetznerRun, getHetznerToken } from "../hetzner/real";
import { convexBackendAssets, convexBackendVersion } from "../pins";
import {
	isProcessAlive,
	killOwnedProcessGroups,
	spawnOwnedProcess,
	stopOwnedProcess,
} from "../process";

const repositoryRoot = path.resolve(import.meta.dir, "..", "..");
const cacheRoot = path.join(repositoryRoot, "tmp", "convex-backend");

const instanceName = "composery-test";
const instanceSecretBytes = 32;
const readinessTimeoutMs = 30_000;
const readinessDelayMs = 100;
const logLineLimit = 80;
const pushTimeoutMs = 240_000;
const httpUdfFailedStatus = 560;
const removalRetries = 10;
const removalDelayMs = 200;
const removeFolderScript =
	"require('node:fs').rmSync(process.argv[1], { recursive: true, force: true, maxRetries: Number(process.argv[2]), retryDelay: Number(process.argv[3]) });";
const hostTagLength = 8;
const hostTag = createHash("sha256")
	.update(hostname())
	.digest("hex")
	.slice(0, hostTagLength);
const runFolderNamePattern = /^\d+-(\d+)-([0-9a-f]{8})(?:-[\da-z]+)?$/i;
const temporaryFolderNamePattern = /^cvx-(\d+)-([0-9a-f]{8})(?:-[\da-z]+)?$/i;
const lineBreakPattern = /\r?\n/;
const executableMode = 0o755;
const encryptionKeyBytes = 32;
const webhookSecretBytes = 24;

type AnyFunction = FunctionReference<
	"query" | "mutation" | "action",
	"public" | "internal"
>;

export type ConvexBackend = Readonly<{
	stop: () => Promise<void>;
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
	hetzner: HetznerFake;
	createAccount: (options?: { synced?: boolean }) => Promise<ClerkUser>;
	sshAccessEncryptionKeys: readonly [string, string];
}>;

const accountSuffixBytes = 6;

type RunContext = Readonly<{
	instanceSecret: string;
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
	return mkdtempSync(path.join(tmpdir(), `cvx-${process.pid}-${hostTag}-`));
}

function removeFolder(folder: string) {
	// Bun's Windows rm rejects some npm cache trees that Node removes correctly.
	execFileSync(
		"node",
		[
			"-e",
			removeFolderScript,
			folder,
			String(removalRetries),
			String(removalDelayMs),
		],
		{
			env: toChildEnvironment(folder),
			stdio: "pipe",
		},
	);
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

function removeOrphanedRunFolder(folder: string) {
	killOwnedProcessGroups(folder);
	removeFolder(folder);
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
				const folder = path.join(root, name);
				removeWhenPossible(() => remove(folder), folder);
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
	const partial = `${binary}.${randomUUID()}.partial`;
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
			context.instanceSecret,
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

type World = Readonly<{
	webhookSecret: string;
	issuerUrl: string;
	fake: HetznerFake;
	clerk: ClerkFake;
	sshAccessEncryptionKeys: readonly string[];
	hetzner: Readonly<{ controllerId: string }>;
}>;

function toDeploymentVariables({
	webhookSecret,
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
		HCLOUD_LOCATIONS: fake.locations.join(","),
		HCLOUD_CONTROLLER_ID: hetzner.controllerId,
		HCLOUD_IMAGE: "ubuntu-24.04",
		HCLOUD_SERVER_TYPE: fake.serverType,
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
	const fixtures = path.join(workspace, "harness", "convex");
	mkdirSync(fixtures, { recursive: true });
	copyFileSync(
		path.join(repositoryRoot, "harness", "convex", "quota-writes.ts"),
		path.join(fixtures, "quota-writes.ts"),
	);
	writeFileSync(
		path.join(workspace, "convex", "test_quotas.ts"),
		'export { write } from "../harness/convex/quota-writes";\n',
	);
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

export async function startConvexBackend(): Promise<ConvexBackend> {
	await using resources = new AsyncDisposableStack();
	const binary = await requireBackendBinary();
	const runsRoot = path.join(cacheRoot, "runs");
	removeOrphanedFolders(runsRoot);
	mkdirSync(runsRoot, { recursive: true });
	const folder = mkdtempSync(
		path.join(runsRoot, `${Date.now()}-${process.pid}-${hostTag}-`),
	);
	resources.defer(() => removeWhenPossible(() => removeFolder(folder), folder));
	const temporary = toTemporaryFolder();
	resources.defer(() =>
		removeWhenPossible(() => removeFolder(temporary), temporary),
	);
	const environment = toChildEnvironment(temporary);
	const instanceSecret = randomBytes(instanceSecretBytes).toString("hex");
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
	const context: RunContext = {
		binary,
		adminKey,
		folder,
		environment,
		instanceSecret,
	};
	const issuer = startSignInIssuer();
	resources.defer(issuer.stop);
	const hetznerToken = getHetznerToken();
	const clerkSecret = getClerkSecret();
	const fake = await startHetznerFake(hetznerToken);
	resources.defer(fake.stop);
	const clerk = await startClerkFake(clerkSecret);
	resources.defer(clerk.stop);
	resources.defer(() => requireContractsKept([fake, clerk]));
	const clerkRun =
		clerkSecret === null ? null : await createClerkRun(clerkSecret);
	if (clerkRun === null) {
		clerk.setKeys(await readIssuerKeys(issuer));
	} else {
		resources.defer(clerkRun.stop);
	}
	const hetznerRun =
		hetznerToken === null ? null : await createHetznerRun(hetznerToken);
	if (hetznerRun !== null) {
		resources.defer(hetznerRun.stop);
	}
	const backend = await startBackend(context, path.join(folder, "storage"));
	resources.defer(backend.stop);
	const sshAccessEncryptionKeys = toSshAccessEncryptionKeys();
	const webhookSecret = `whsec_${randomBytes(webhookSecretBytes).toString("base64")}`;
	await setEnvironmentVariables(
		context,
		backend,
		toDeploymentVariables({
			issuerUrl: clerkRun === null ? issuer.url : requireClerkIssuer(),
			fake,
			clerk,
			sshAccessEncryptionKeys,
			webhookSecret,
			hetzner: hetznerRun ?? fake,
		}),
	);
	await pushFunctions(context, backend, "workspace");
	const owned = resources.move();

	return {
		stop: () => owned.disposeAsync(),
		hetzner: fake,
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
