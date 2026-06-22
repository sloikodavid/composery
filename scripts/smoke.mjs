import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { URL, URLSearchParams, fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID = `${Date.now()}-${process.pid}`;
const DEFAULT_ATTEMPTS = {
	exec: 120,
	health: 120,
	readiness: 180
};

const config = {
	containerName:
		process.env.SMOKE_CONTAINER_NAME ?? `composery-smoke-${RUN_ID}`,
	imageTag: process.env.SMOKE_IMAGE_TAG ?? "composery:smoke",
	noCache: parseBoolean(process.env.SMOKE_NO_CACHE),
	password: process.env.SMOKE_PASSWORD ?? "smoke-password",
	port: parsePort(process.env.SMOKE_PORT ?? "18080"),
	// The systemd path needs a privileged container with host cgroups; set
	// SMOKE_SKIP_SYSTEMD=1 to skip it where that is unavailable (e.g. Docker
	// Desktop). CI runs on Linux runners that support it.
	skipSystemd: parseBoolean(process.env.SMOKE_SKIP_SYSTEMD),
	volumeName: process.env.SMOKE_VOLUME_NAME ?? `composery-smoke-${RUN_ID}`
};

let failureDumped = false;

process.once("SIGINT", () => stopFromSignal("SIGINT", 130));
process.once("SIGTERM", () => stopFromSignal("SIGTERM", 143));

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.stack || error.message : error);
	dumpContainerLogs();
	process.exitCode = 1;
} finally {
	cleanupResources();
}

async function main() {
	requireDocker();
	cleanupResources();
	buildImage();
	docker(["volume", "create", config.volumeName], { quiet: true });
	runDefaultContainer();
	await assertWebAppSmoke();
	await assertPersistdAppliesChanges();
	await assertSystemdEnvBridge();
}

function requireDocker() {
	run("docker", ["version", "--format", "{{.Server.Version}}"], {
		capture: true,
		quiet: true,
		timeoutMs: 20_000
	});
}

function buildImage() {
	log(`building ${config.imageTag}`);
	const args = ["build", "-t", config.imageTag];
	if (config.noCache) args.push("--no-cache");
	args.push(".");
	docker(args, { timeoutMs: 45 * 60_000 });
}

function runDefaultContainer() {
	log("starting default container");
	docker(
		[
			"run",
			"-d",
			"--name",
			config.containerName,
			"-p",
			`127.0.0.1:${config.port}:${config.port}`,
			"-e",
			`PORT=${config.port}`,
			"-e",
			`PASSWORD=${config.password}`,
			"-v",
			`${config.volumeName}:/data`,
			config.imageTag
		],
		{ capture: true, quiet: true }
	);
}

function runSystemdContainer() {
	log("starting systemd container");
	docker(
		[
			"run",
			"-d",
			"--name",
			config.containerName,
			"--privileged",
			"--cgroupns=host",
			"--stop-signal",
			"SIGRTMIN+3",
			"--tmpfs",
			"/run",
			"--tmpfs",
			"/run/lock",
			"--tmpfs",
			"/tmp",
			"-v",
			"/sys/fs/cgroup:/sys/fs/cgroup:rw",
			"-p",
			`127.0.0.1:${config.port}:${config.port}`,
			"-e",
			"COMPOSERY_INIT=systemd",
			"-e",
			`PORT=${config.port}`,
			"-e",
			`PASSWORD=${config.password}`,
			"-e",
			"COMPOSERY_DISABLE_FILE_DOWNLOADS=1",
			"-v",
			`${config.volumeName}:/data`,
			config.imageTag
		],
		{ capture: true, quiet: true }
	);
}

async function assertSystemdEnvBridge() {
	if (config.skipSystemd) {
		log("skipping systemd init check (SMOKE_SKIP_SYSTEMD set)");
		return;
	}

	log("checking systemd init bridges deployment env to code-server");

	// systemd (PID 1) starts services with a clean environment, so PASSWORD/PORT/
	// COMPOSERY_* only reach code-server if entrypoint writes them to
	// /run/composery.env and the unit loads it via EnvironmentFile. Prove the
	// whole chain on a fresh container + volume.
	cleanupResources();
	docker(["volume", "create", config.volumeName], { quiet: true });
	runSystemdContainer();

	await waitForExec('test "$(cat /proc/1/comm)" = systemd');
	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.readiness);

	// The bridge file exists and captured the injected settings, including a
	// COMPOSERY_* knob (guards the entrypoint filter that forwards them).
	await waitForContainerFile("/run/composery.env");
	execSh("grep -q '^PASSWORD=' /run/composery.env");
	execSh("grep -q '^COMPOSERY_DISABLE_FILE_DOWNLOADS=1$' /run/composery.env");

	// End to end: the injected password crossed into the systemd-managed
	// code-server, so login succeeds and the app serves.
	const cookies = new Map();
	await login(cookies);
	const rootPage = await fetchAuthedText("/", cookies);
	assertContains("systemd root page", rootPage, "Composery");

	// code-server runs as a first-class systemd unit, not a stray process.
	execSh("systemctl is-active composery");

	// cron is a first-class unit here too, and the user's XDG_RUNTIME_DIR exists.
	execSh("systemctl is-active cron");
	execSh("test -d /run/user/1000");
}

async function assertWebAppSmoke() {
	log("checking web app startup, auth, and Composery");
	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.health);

	const cookies = new Map();
	await login(cookies);
	const rootPage = await fetchAuthedText("/", cookies);
	assertContains("default root page", rootPage, "Composery");

	await assertWebsocketUpgrade(cookies);
	await assertCodeServerGatesWhenPersistdNotReady(cookies);
	dockerExec(["sudo", "-u", "user", "sudo", "-n", "true"]);
	dockerExec(["sudo", "-u", "user", "code", "--version"], {
		capture: true,
		quiet: true
	});
	assertUserEnvironment();
	await assertClipboardBridge();
}

function assertUserEnvironment() {
	log("checking the user's shell environment behaves like a real VPS");

	const hasLocalBin =
		'case ":$PATH:" in *:/home/user/.local/bin:*) ;; *) exit 1 ;; esac';

	// Non-login shells (what an AI agent's `bash -c`/sandboxed commands inherit,
	// since they source no startup files) get ~/.local/bin from the inherited
	// process environment.
	userBash(false, hasLocalBin);

	// Login shells (the interactive terminal) get it back via the stock ~/.profile
	// after /etc/profile resets PATH; the dir is created at build so this holds
	// even before the user installs anything.
	userBash(true, hasLocalBin);

	// The user owns /usr/local, so global installs (`npm i -g`, `make install`,
	// curl|sh into /usr/local/bin) work without sudo and land on the default PATH.
	userBash(
		false,
		"test -w /usr/local/bin && test -w /usr/local/lib/node_modules"
	);

	// XDG_RUNTIME_DIR points at a private 0700 dir the user owns, like a real
	// login (gpg, dbus, podman, ... expect it).
	userBash(
		false,
		'test "$XDG_RUNTIME_DIR" = /run/user/1000 && [ "$(stat -c "%U %a" "$XDG_RUNTIME_DIR")" = "user 700" ]'
	);

	// cron behaves like a real VPS: the daemon runs and crontab is available.
	userBash(false, "command -v crontab >/dev/null");
	execSh("pgrep -x cron >/dev/null");

	// A stable machine-id was generated for hosts/dbus to key off.
	execSh("test -s /etc/machine-id");
}

function userBash(loginShell, script) {
	return docker(
		[
			"exec",
			"--user",
			"user",
			config.containerName,
			"bash",
			loginShell ? "-lc" : "-c",
			script
		],
		{ capture: true, quiet: true }
	);
}

async function assertClipboardBridge() {
	log("checking clipboard bridge shims and pipe commands");

	// The xclip/xsel/wl-* shims must be installed and executable so terminal
	// tools (Claude Code, neovim, ...) reach the browser clipboard.
	execSh(
		"for s in xclip xsel wl-paste wl-copy; do test -x /usr/local/bin/$s || exit 1; done"
	);

	// The read and write image commands must be compiled into the server bundle
	// (the browser side of the pipe that reaches navigator.clipboard).
	execSh(
		"grep -q _remoteCLI.getClipboardImage /opt/code-server/current/lib/vscode/out/server-main.js && grep -q _remoteCLI.setClipboardImage /opt/code-server/current/lib/vscode/out/server-main.js"
	);

	// Without an integrated-terminal pipe there is no browser clipboard to
	// reach; the shim must degrade cleanly (no output, non-zero) rather than
	// leaking `code` diagnostics where callers expect clipboard data.
	const shimResult = execSh(
		"xclip -selection clipboard -t image/png -o; echo rc=$?",
		{ capture: true, quiet: true }
	).stdout.trim();
	if (shimResult !== "rc=1") {
		throw new Error(
			`Expected clipboard shim to degrade cleanly without a terminal pipe; got ${JSON.stringify(shimResult)}.`
		);
	}
}

async function assertCodeServerGatesWhenPersistdNotReady(cookies) {
	log("checking code-server gates requests while persistence is not ready");
	const readyFile = execSh("cat /run/persistence/ready", {
		capture: true,
		quiet: true
	}).stdout;

	try {
		execSh("rm -f /run/persistence/ready");

		const health = await request("/healthz", { cookies });
		if (health.statusCode !== 503) {
			throw new Error(
				`Expected /healthz to return 503 without persistence ready; got HTTP ${health.statusCode}.`
			);
		}
		const healthJson = JSON.parse(health.body);
		if (healthJson.persistence?.ready !== false) {
			throw new Error("Expected /healthz to report persistence.ready=false.");
		}

		const startup = await request("/", {
			cookies,
			headers: { accept: "text/html" }
		});
		if (startup.statusCode !== 503) {
			throw new Error(
				`Expected HTML requests to return 503 without persistence ready; got HTTP ${startup.statusCode}.`
			);
		}
		assertContains("startup page", startup.body, "Preparing workspace");

		await assertWebsocketServiceUnavailable(cookies);
	} finally {
		execSh('printf "%s" "$1" > /run/persistence/ready', {
			args: [readyFile],
			quiet: true
		});
	}

	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.health, { cookies });
	await assertWebsocketUpgrade(cookies);
}

async function assertPersistdAppliesChanges() {
	log("checking persistence applies filesystem changes");

	log("checking persistence layout and command surface");
	await waitForExec("test -x /opt/persistence/bin/persistence");
	await waitForExec("test ! -e /opt/persistence/bin/persistence-baseline");
	await waitForExec("test -f /opt/persistence/baseline.sqlite");
	await waitForExec("test -f /data/persistence/.internal/state.sqlite");
	await waitForExec("test -f /run/persistence/ready");
	execSh("test ! -e /run/persistence/restore-failed");
	execSh("test ! -e /run/persistence/watch-failed");
	execSh(
		'/opt/persistence/bin/persistence status --json | jq -e ".ready == true and .baselineValid == true"'
	);
	execSh(
		'/opt/persistence/bin/persistence doctor --json | jq -e ".rebuiltPublicIndex == true"'
	);
	execSh(
		"/opt/persistence/bin/persistence prune --json | jq -e '.removed | type == \"array\"'"
	);

	log("creating files that should be applied after restart");
	execSh("printf hello > /home/user/Desktop/smoke.txt", {
		user: "user"
	});
	execSh("printf restored > /custom-restore");
	execSh("mkdir -p /foo123 && printf nested > /foo123/nested.txt");

	log("waiting for persistence to record changed filesystem state");
	await waitForExec("test -f /data/persistence/config.json");
	await waitForExec("test -d /data/persistence/changed");
	await waitForExec("test -d /data/persistence/removed");
	await waitForExec("test -f /data/persistence/metadata.jsonl");
	await waitForExec("test -f /data/persistence/.internal/lock");
	await waitForContainerFile(
		"/data/persistence/changed/home/user/Desktop/smoke.txt"
	);
	await waitForContainerFile("/data/persistence/changed/custom-restore");
	await waitForContainerFile("/data/persistence/changed/foo123/nested.txt");

	log("restarting container and checking changed files are applied");
	restartContainer();
	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.readiness);
	execSh('test "$(cat /home/user/Desktop/smoke.txt)" = hello');
	execSh('test "$(cat /custom-restore)" = restored');
	execSh("test -d /foo123");
	execSh('test "$(cat /foo123/nested.txt)" = nested');

	log("removing a file and checking the removal is applied");
	execSh("rm /custom-restore");
	await waitForContainerPathAbsent("/data/persistence/changed/custom-restore");
	restartContainer();
	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.readiness);
	execSh("test ! -e /custom-restore");

	log(
		"recreating container with the same volume and checking changes are applied"
	);
	docker(["rm", "-f", config.containerName], { capture: true, quiet: true });
	runDefaultContainer();
	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.readiness);
	execSh('test "$(cat /home/user/Desktop/smoke.txt)" = hello');
	execSh("test -d /foo123");

	log("checking image-file deletion and tombstone removal");
	execSh("rm /usr/share/applications/composery-text-editor.desktop");
	await waitForContainerFile(
		"/data/persistence/removed/usr/share/applications/composery-text-editor.desktop"
	);
	docker(["rm", "-f", config.containerName], { capture: true, quiet: true });
	runDefaultContainer();
	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.readiness);
	execSh("test ! -e /usr/share/applications/composery-text-editor.desktop");
	docker(["rm", "-f", config.containerName], { capture: true, quiet: true });
	runWithDataVolume(
		"rm -f /data/persistence/removed/usr/share/applications/composery-text-editor.desktop"
	);
	runDefaultContainer();
	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.readiness);
	execSh("test -f /usr/share/applications/composery-text-editor.desktop");

	log("checking baseline-equal changes do not remain in changed");
	execSh(
		"cp /etc/mailcap /tmp/mailcap.baseline && printf changed > /etc/mailcap"
	);
	await waitForExec("test -e /data/persistence/changed/etc/mailcap");
	execSh("cat /tmp/mailcap.baseline > /etc/mailcap");
	await waitForContainerPathAbsent("/data/persistence/changed/etc/mailcap");

	log("checking touched large baseline file does not create changed payload");
	const large = execSh(
		"find /opt/code-server/current -xdev -type f -size +1M | head -n1",
		{ capture: true, quiet: true }
	).stdout.trim();
	if (!large) throw new Error("No large baseline file found for smoke check.");
	execSh('touch "$1"', { args: [large] });
	await assertContainerPathStaysAbsent(
		`/data/persistence/changed/${large.replace(/^\//, "")}`,
		5
	);

	log("checking custom exclusions are ignored and not pruned");
	execSh(
		'tmp="$(mktemp)"; jq \'.exclusions += ["/excluded-smoke"]\' /data/persistence/config.json > "$tmp"; mv "$tmp" /data/persistence/config.json'
	);
	restartContainer();
	await waitForHttp("/healthz", DEFAULT_ATTEMPTS.readiness);
	execSh("mkdir -p /excluded-smoke && printf ignored > /excluded-smoke/file");
	await assertContainerPathStaysAbsent(
		"/data/persistence/changed/excluded-smoke/file",
		5
	);
	execSh(
		"mkdir -p /data/persistence/changed/excluded-smoke /data/persistence/removed/excluded-smoke && printf dormant > /data/persistence/changed/excluded-smoke/dormant && : > /data/persistence/removed/excluded-smoke/tombstone"
	);
	dockerExec(["/opt/persistence/bin/persistence", "prune", "--json"], {
		capture: true,
		quiet: true
	});
	execSh("test -f /data/persistence/changed/excluded-smoke/dormant");
	execSh("test -f /data/persistence/removed/excluded-smoke/tombstone");
}

async function login(cookies) {
	const baseUrl = `http://127.0.0.1:${config.port}`;
	const loginPage = await waitForHttp("/login", DEFAULT_ATTEMPTS.readiness, {
		cookies
	});
	storeCookies(cookies, loginPage.headers["set-cookie"]);

	const body = new URLSearchParams({
		base: ".",
		href: `${baseUrl}/login`,
		password: config.password
	}).toString();

	const response = await request("/login", {
		body,
		cookies,
		headers: {
			"content-length": Buffer.byteLength(body).toString(),
			"content-type": "application/x-www-form-urlencoded"
		},
		method: "POST"
	});
	storeCookies(cookies, response.headers["set-cookie"]);
	if (!isHttpSuccess(response)) {
		throw new Error(`Login failed with HTTP ${response.statusCode}.`);
	}
}

async function fetchAuthedText(path, cookies) {
	const response = await waitForHttp(path, DEFAULT_ATTEMPTS.readiness, {
		cookies
	});
	return response.body;
}

async function waitForHttp(path, attempts, options = {}) {
	return retry(`fetch ${path}`, attempts, async () => {
		const response = await requestFollow(path, options);
		if (isHttpSuccess(response)) return response;
		throw new Error(`HTTP ${response.statusCode} from ${path}.`);
	});
}

async function requestFollow(path, options = {}, redirects = 5) {
	const response = await request(path, options);
	storeCookies(options.cookies, response.headers["set-cookie"]);
	const location = response.headers.location;
	if (
		response.statusCode >= 300 &&
		response.statusCode < 400 &&
		location &&
		redirects > 0
	) {
		const next = new URL(location, `http://127.0.0.1:${config.port}${path}`);
		const base = `http://127.0.0.1:${config.port}`;
		if (next.origin !== base) {
			throw new Error(`Refusing smoke redirect to ${next.href}.`);
		}
		const headers = { ...(options.headers ?? {}) };
		delete headers["content-length"];
		delete headers["content-type"];
		return requestFollow(
			`${next.pathname}${next.search}`,
			{
				...options,
				body: undefined,
				headers,
				method: "GET"
			},
			redirects - 1
		);
	}
	return response;
}

function request(path, options = {}) {
	return new Promise((resolvePromise, reject) => {
		const headers = { ...(options.headers ?? {}) };
		const cookie = cookieHeader(options.cookies);
		if (cookie) headers.cookie = cookie;

		const requestOptions = {
			headers,
			host: "127.0.0.1",
			method: options.method ?? "GET",
			path,
			port: config.port,
			timeout: 5000
		};

		const clientRequest = http.request(requestOptions, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("end", () => {
				resolvePromise({
					body: Buffer.concat(chunks).toString("utf8"),
					headers: response.headers,
					statusCode: response.statusCode ?? 0
				});
			});
		});

		clientRequest.on("error", reject);
		clientRequest.on("timeout", () => {
			clientRequest.destroy(new Error(`Timed out fetching ${path}.`));
		});

		if (options.body) clientRequest.write(options.body);
		clientRequest.end();
	});
}

async function assertWebsocketUpgrade(cookies) {
	const { expected, headers, status } = await websocketHandshake(cookies);

	if (!status.startsWith("HTTP/1.1 101")) {
		throw new Error(`Unexpected websocket status: ${status}`);
	}
	if (headers.upgrade?.toLowerCase() !== "websocket") {
		throw new Error("Missing websocket upgrade header.");
	}
	const connection = headers.connection ?? "";
	if (
		!connection
			.split(",")
			.map((value) => value.trim().toLowerCase())
			.includes("upgrade")
	) {
		throw new Error("Missing websocket connection upgrade header.");
	}
	if (headers["sec-websocket-accept"] !== expected) {
		throw new Error("Unexpected websocket accept header.");
	}
}

async function assertWebsocketServiceUnavailable(cookies) {
	const { status } = await websocketHandshake(cookies);
	if (!status.startsWith("HTTP/1.1 503")) {
		throw new Error(`Expected websocket 503 while not ready; got ${status}.`);
	}
}

function websocketHandshake(cookies) {
	return new Promise((resolvePromise, reject) => {
		const key = randomBytes(16).toString("base64");
		const expected = createHash("sha1")
			.update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
			.digest("base64");
		const requestText = [
			"GET /websocket-smoke HTTP/1.1",
			`Host: 127.0.0.1:${config.port}`,
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Cookie: ${cookieHeader(cookies)}`,
			`Sec-WebSocket-Key: ${key}`,
			"Sec-WebSocket-Version: 13",
			"",
			""
		].join("\r\n");
		let response = "";
		const socket = net.createConnection(
			{ host: "127.0.0.1", port: config.port },
			() => socket.write(requestText, "ascii")
		);

		socket.setTimeout(5000);
		socket.on("data", (chunk) => {
			response += chunk.toString("latin1");
			if (response.includes("\r\n\r\n")) {
				socket.end();
				try {
					const parsed = parseHttpHeaders(response);
					resolvePromise({ ...parsed, expected });
				} catch (error) {
					reject(error);
				}
			}
		});
		socket.on("error", reject);
		socket.on("timeout", () => {
			socket.destroy();
			reject(new Error("Timed out waiting for websocket upgrade."));
		});
	});
}

function parseHttpHeaders(response) {
	const lines = response.split("\r\n");
	const headers = {};
	for (const line of lines.slice(1)) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		headers[line.slice(0, separator).trim().toLowerCase()] = line
			.slice(separator + 1)
			.trim();
	}
	return { headers, status: lines[0] ?? "" };
}

async function waitForExec(script, args = []) {
	await retry(`exec ${script}`, DEFAULT_ATTEMPTS.exec, async () => {
		const result = execSh(script, {
			args,
			check: false,
			quiet: true
		});
		if (result.status === 0) return true;
		throw new Error(`Command failed in container: ${script}`);
	});
}

function waitForContainerFile(path) {
	return waitForExec('test -f "$1"', [path]);
}

function waitForContainerPathAbsent(path) {
	return waitForExec('test ! -e "$1"', [path]);
}

async function assertContainerPathStaysAbsent(path, seconds) {
	for (let second = 0; second < seconds; second += 1) {
		assertContainerRunning();
		execSh('test ! -e "$1"', { args: [path], quiet: true });
		await sleep(1000);
	}
}

async function retry(label, attempts, fn) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			assertContainerRunning();
			return await fn();
		} catch (error) {
			lastError = error;
			await sleep(1000);
		}
	}
	throw new Error(
		`Timed out waiting for ${label}: ${
			lastError instanceof Error ? lastError.message : lastError
		}`
	);
}

function restartContainer() {
	docker(["restart", config.containerName], { capture: true, quiet: true });
}

function runWithDataVolume(script) {
	docker(
		[
			"run",
			"--rm",
			"-v",
			`${config.volumeName}:/data`,
			"--entrypoint",
			"sh",
			config.imageTag,
			"-lc",
			script
		],
		{ capture: true, quiet: true }
	);
}

function dockerExec(args, options = {}) {
	return docker(["exec", config.containerName, ...args], options);
}

function execSh(script, options = {}) {
	const args = ["exec"];
	if (options.user) args.push("--user", options.user);
	args.push(config.containerName, "sh", "-lc", script, "sh");
	if (options.args) args.push(...options.args);
	return docker(args, options);
}

function assertContainerRunning() {
	const result = docker(
		["inspect", "-f", "{{.State.Running}}", config.containerName],
		{
			capture: true,
			check: false,
			quiet: true
		}
	);
	if (result.status !== 0 || result.stdout.trim() !== "true") {
		throw new Error(`Container ${config.containerName} is not running.`);
	}
}

function docker(args, options = {}) {
	return run("docker", args, options);
}

function run(command, args, options = {}) {
	if (!options.quiet) logCommand(command, args);
	const result = spawnSync(command, args, {
		cwd: REPO_ROOT,
		encoding: "utf8",
		stdio: options.capture ? "pipe" : "inherit",
		timeout: options.timeoutMs ?? 120_000
	});
	if (result.error) throw result.error;
	if (options.check !== false && result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed with exit code ${
				result.status ?? "unknown"
			}.`
		);
	}
	return {
		status: result.status ?? 1,
		stderr: result.stderr ?? "",
		stdout: result.stdout ?? ""
	};
}

function cleanupResources() {
	docker(["rm", "-f", config.containerName], {
		capture: true,
		check: false,
		quiet: true
	});
	docker(["volume", "rm", config.volumeName], {
		capture: true,
		check: false,
		quiet: true
	});
}

function dumpContainerLogs() {
	if (failureDumped) return;
	failureDumped = true;
	try {
		run("docker", ["ps", "-a"], { check: false, quiet: true });
		run("docker", ["logs", config.containerName], {
			check: false,
			quiet: true
		});
		dumpPersistdDiagnostics();
	} catch {
		// The original error is more useful when Docker itself is unavailable.
	}
}

function dumpPersistdDiagnostics() {
	dockerExec(["/opt/persistence/bin/persistence", "status", "--json"], {
		check: false
	});
	dockerExec(
		[
			"sh",
			"-lc",
			'for file in /data/persistence/.internal/apply-error.log /data/persistence/.internal/watch-error.log; do if [ -f "$file" ]; then echo "== $file =="; cat "$file"; fi; done'
		],
		{ check: false }
	);
}

function stopFromSignal(signal, exitCode) {
	console.error(`Received ${signal}; cleaning up smoke resources.`);
	cleanupResources();
	process.exit(exitCode);
}

function cookieHeader(cookies) {
	if (!cookies || cookies.size === 0) return "";
	return [...cookies.entries()]
		.map(([name, value]) => `${name}=${value}`)
		.join("; ");
}

function storeCookies(cookies, values) {
	if (!cookies || !values) return;
	for (const value of Array.isArray(values) ? values : [values]) {
		const pair = value.split(";", 1)[0];
		const separator = pair.indexOf("=");
		if (separator === -1) continue;
		cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
	}
}

function isHttpSuccess(response) {
	return response.statusCode >= 200 && response.statusCode < 400;
}

function assertContains(label, haystack, needle) {
	if (!haystack.toLowerCase().includes(needle.toLowerCase())) {
		throw new Error(`Expected ${label} to contain ${needle}.`);
	}
}

function parseBoolean(value) {
	return value === "1" || value === "true";
}

function parsePort(value) {
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid smoke port: ${value}`);
	}
	return port;
}

function log(message) {
	console.log(`[smoke] ${message}`);
}

function logCommand(command, args) {
	console.log(`\n$ ${[command, ...args].map(formatArg).join(" ")}`);
}

function formatArg(arg) {
	if (/^[A-Za-z0-9_./:@=-]+$/.test(arg)) return arg;
	return JSON.stringify(arg);
}
