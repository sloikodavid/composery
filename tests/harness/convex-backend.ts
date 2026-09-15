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
import { hostname } from "node:os";
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
import { isProcessAlive, registerCleanup } from "./cleanup";
import { type SignInIssuer, startSignInIssuer } from "./sign-in";

const repositoryRoot = path.resolve(import.meta.dir, "..", "..");
const cacheRoot = path.join(repositoryRoot, "tmp", "convex-backend");
const backendVersion = "precompiled-2026-09-11-157eb19";
// Test deployments share one instance identity, because a storage template belongs to it.
const instanceName = "composery-test";
const instanceSecret = createHash("sha256").update(instanceName).digest("hex");
const readinessTimeoutMs = 30_000;
const readinessDelayMs = 100;
const stopTimeoutMs = 10_000;
const logLineLimit = 40;
const httpUdfFailedStatus = 560;
const removalRetries = 10;
const removalDelayMs = 200;
const hostTagLength = 8;
// A run folder names its creation time, its test process, and its machine.
const hostTag = createHash("sha256")
	.update(hostname())
	.digest("hex")
	.slice(0, hostTagLength);
const runFolderNamePattern = /^\d+-(\d+)-([0-9a-f]{8})$/;
const lineBreakPattern = /\r?\n/;
const executableMode = 0o755;
const templateKeyLength = 16;
const webhookSecretBytes = 24;

/** The release asset and its SHA-256 digest, as GitHub published them, for each supported platform. */
const releaseAssets: Record<string, { name: string; sha256: string }> = {
	"win32-x64": {
		name: "convex-local-backend-x86_64-pc-windows-msvc.zip",
		sha256: "c4c51220c9a0b3dd799150608f54dd5a01370da7f9b94eea50268c2afdc7bc93",
	},
	"linux-x64": {
		name: "convex-local-backend-x86_64-unknown-linux-gnu.zip",
		sha256: "c64b3339f9c4fa97b146741a1ed551b4b2a99dbcbe539ee1063c49069b7b49c4",
	},
	"linux-arm64": {
		name: "convex-local-backend-aarch64-unknown-linux-gnu.zip",
		sha256: "ef3d79aeec748ae8511c5b560ad9c0a43e617111fee803543aecb5d0c98364ae",
	},
	"darwin-x64": {
		name: "convex-local-backend-x86_64-apple-darwin.zip",
		sha256: "83ca7eed58ae269e0daf9d55f2aebbba48db55c16b6341db89db517ffb8e413a",
	},
	"darwin-arm64": {
		name: "convex-local-backend-aarch64-apple-darwin.zip",
		sha256: "a61d352b0501ac6e0e56c25efc2a1e6a2a59a28076ef1168e042317946653641",
	},
};

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
 * The backend's environment, built from nothing. A developer's own deployment, login and tokens
 * are exported in their shell, and a backend that inherited them could act on the real deployment.
 */
function toChildEnvironment(runDirectory: string) {
	const temporary = path.join(runDirectory, "temp");
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

/** Removes a run folder, unlinking its links to the repository's modules before a recursive walk. */
function removeRunFolder(folder: string) {
	for (const workspace of ["workspace", "template-workspace"]) {
		rmSync(path.join(folder, workspace, "node_modules"), { force: true });
	}
	rmSync(folder, {
		recursive: true,
		force: true,
		maxRetries: removalRetries,
		retryDelay: removalDelayMs,
	});
}

/**
 * Removes run folders whose test process on this machine is gone. The owner is in the folder's name
 * rather than in a file inside it, so a folder that a failed removal emptied halfway is still known.
 */
function removeOrphanedRunFolders(runsRoot: string) {
	if (!existsSync(runsRoot)) {
		return;
	}
	for (const name of readdirSync(runsRoot)) {
		const [, pid, host] = runFolderNamePattern.exec(name) ?? [];
		if (host === hostTag && !isProcessAlive(Number(pid))) {
			removeRunFolder(path.join(runsRoot, name));
		}
	}
}

/** Downloads the pinned backend once, refuses it unless its digest matches, and keeps it in tmp. */
async function requireBackendBinary() {
	const asset = releaseAssets[`${process.platform}-${process.arch}`];
	if (asset === undefined) {
		throw new Error(
			`No Convex backend release is pinned for ${process.platform}-${process.arch}.`,
		);
	}
	const fileName =
		process.platform === "win32"
			? "convex-local-backend.exe"
			: "convex-local-backend";
	const directory = path.join(cacheRoot, "binaries", backendVersion);
	const binary = path.join(directory, fileName);
	if (existsSync(binary)) {
		return binary;
	}
	const response = await fetch(
		`https://github.com/get-convex/convex-backend/releases/download/${backendVersion}/${asset.name}`,
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

type RunningBackend = Readonly<{
	url: string;
	stop: () => Promise<void>;
}>;

/**
 * Stops the backend and the Node executor it started. Windows ends only the process it is told to,
 * which would leave the executor holding the run folder until this whole test process exits.
 */
function stopProcessTree(child: ChildProcess) {
	if (child.pid === undefined || child.exitCode !== null) {
		return;
	}
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
	} else {
		child.kill("SIGTERM");
	}
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

async function startBackend(
	binary: string,
	storage: string,
	environment: Record<string, string>,
): Promise<RunningBackend> {
	const cloudPort = await findFreePort();
	const sitePort = await findFreePort();
	const log: string[] = [];
	const child = spawn(
		binary,
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
		{ env: environment, stdio: ["ignore", "pipe", "pipe"] },
	);
	const keep = (chunk: Buffer) => {
		log.push(...chunk.toString().split(lineBreakPattern).filter(Boolean));
		log.splice(0, Math.max(0, log.length - logLineLimit));
	};
	child.stdout?.on("data", keep);
	child.stderr?.on("data", keep);
	const url = `http://127.0.0.1:${cloudPort}`;
	const stop = async () => {
		stopProcessTree(child);
		await waitForExit(child, stopTimeoutMs);
	};
	const deadline = Date.now() + readinessTimeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			break;
		}
		if (
			await fetch(`${url}/version`).then(
				(reply) => reply.ok,
				() => false,
			)
		) {
			return { url, stop };
		}
		await Bun.sleep(readinessDelayMs);
	}
	await stop();
	throw new Error(`The Convex backend did not start:\n${log.join("\n")}`);
}

async function setEnvironmentVariables(
	url: string,
	adminKey: string,
	variables: Record<string, string>,
) {
	const reply = await fetch(`${url}/api/update_environment_variables`, {
		method: "POST",
		headers: {
			// biome-ignore lint/style/useNamingConvention: HTTP defines the Authorization header name
			Authorization: `Convex ${adminKey}`,
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

/** The variables that the deployment requires, pointed at this run's sign-in issuer. */
function toRequiredVariables(issuer: SignInIssuer) {
	return {
		// biome-ignore-start lint/style/useNamingConvention: environment variable names use CONSTANT_CASE
		CLERK_FRONTEND_API_URL: issuer.url,
		CLERK_SECRET_KEY: "sk_test_composery_tests_never_reach_clerk",
		CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${randomBytes(webhookSecretBytes).toString("base64")}`,
		// biome-ignore-end lint/style/useNamingConvention: environment variable names use CONSTANT_CASE
	};
}

/**
 * Pushes the repository's functions from a copy. Convex keeps a package external only when an import
 * resolves inside the project folder, so the functions sit beside a link to the repository's modules.
 */
async function pushFunctions(
	workspace: string,
	url: string,
	adminKey: string,
	environment: Record<string, string>,
) {
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
	const push = spawn(
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
			env: {
				...environment,
				// biome-ignore-start lint/style/useNamingConvention: the Convex CLI reads these names
				CONVEX_SELF_HOSTED_URL: url,
				CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
				// biome-ignore-end lint/style/useNamingConvention: the Convex CLI reads these names
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	push.stdout?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	push.stderr?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	const code = await new Promise<number | null>((resolve) =>
		push.once("exit", resolve),
	);
	if (code !== 0) {
		throw new Error(`Pushing functions to the test backend failed:\n${output}`);
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
async function requireStorageTemplate(
	binary: string,
	adminKey: string,
	runDirectory: string,
	environment: Record<string, string>,
) {
	const key = createHash("sha256")
		.update(
			JSON.stringify([
				backendVersion,
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
	const building = path.join(runDirectory, "template");
	mkdirSync(building, { recursive: true });
	const issuer = startSignInIssuer();
	const backend = await startBackend(binary, building, environment);
	try {
		await setEnvironmentVariables(
			backend.url,
			adminKey,
			toRequiredVariables(issuer),
		);
		await pushFunctions(
			path.join(runDirectory, "template-workspace"),
			backend.url,
			adminKey,
			environment,
		);
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
	removeOrphanedRunFolders(runsRoot);
	const runDirectory = path.join(
		runsRoot,
		`${Date.now()}-${process.pid}-${hostTag}`,
	);
	mkdirSync(runDirectory, { recursive: true });
	// Registered first, so it runs last: after the backend has stopped and released its files.
	registerCleanup(() => {
		removeRunFolder(runDirectory);
	});
	const environment = toChildEnvironment(runDirectory);
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
	const template = await requireStorageTemplate(
		binary,
		adminKey,
		runDirectory,
		environment,
	);
	const storage = path.join(runDirectory, "storage");
	cpSync(template, storage, { recursive: true });
	mkdirSync(storage, { recursive: true });

	const issuer = startSignInIssuer();
	registerCleanup(issuer.stop);
	const backend = await startBackend(binary, storage, environment);
	registerCleanup(backend.stop);
	await setEnvironmentVariables(
		backend.url,
		adminKey,
		toRequiredVariables(issuer),
	);
	await pushFunctions(
		path.join(runDirectory, "workspace"),
		backend.url,
		adminKey,
		environment,
	);

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
		signIn: issuer.signIn,
	};
}

let convexBackend: Promise<ConvexBackend> | undefined;

/** One backend for the whole run: each test uses its own users and records, so none sees another's. */
export function useConvexBackend() {
	convexBackend ??= startConvexBackend();
	return convexBackend;
}
