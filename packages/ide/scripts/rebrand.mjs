#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const check = process.argv.includes("--check");
const targetArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const target = check
	? join(REPO_ROOT, "tmp", `ide-rebrand-check-${Date.now()}-${process.pid}`)
	: targetArg
		? resolve(targetArg)
		: undefined;

const textExtensions = new Set([
	".cmd",
	".css",
	".html",
	".js",
	".json",
	".md",
	".mjs",
	".service",
	".sh",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml"
]);

const textFiles = new Set([
	"LICENSE",
	"NOTICE",
	"package.json",
	"package-lock.json",
	"yarn.lock"
]);

const skippedDirs = new Set([
	".git",
	".pc",
	"coverage",
	"node_modules",
	"out",
	"release"
]);

const roots = [
	"ci/build",
	"lib/vscode/build",
	"lib/vscode/resources/server",
	"lib/vscode/src",
	"src",
	"typings",
	"package.json",
	"package-lock.json"
];

const replacements = [
	["CODE_SERVER_SESSION_SOCKET", "COMPOSERY_SESSION_SOCKET"],
	["CODE_SERVER_PARENT_PID", "COMPOSERY_PARENT_PID"],
	["CODE_SERVER_COOKIE_SUFFIX", "COMPOSERY_COOKIE_SUFFIX"],
	["CODE_SERVER_RECONNECTION_GRACE_TIME", "COMPOSERY_RECONNECTION_GRACE_TIME"],
	["CODE_SERVER_IDLE_TIMEOUT_SECONDS", "COMPOSERY_IDLE_TIMEOUT_SECONDS"],
	["CODE_SERVER_APP_NAME", "COMPOSERY_APP_NAME"],
	["CODE_SERVER_CONFIG", "COMPOSERY_CONFIG"],
	["CODE_SERVER_HOST", "COMPOSERY_HOST"],
	["/^CODE_SERVER_.+$/", "/^COMPOSERY_.+$/"],
	["CS_DISABLE_FILE_DOWNLOADS", "COMPOSERY_DISABLE_FILE_DOWNLOADS"],
	["CS_DISABLE_FILE_UPLOADS", "COMPOSERY_DISABLE_FILE_UPLOADS"],
	[
		"CS_DISABLE_GETTING_STARTED_OVERRIDE",
		"COMPOSERY_DISABLE_GETTING_STARTED_OVERRIDE"
	],
	["CS_DISABLE_PROXY", "COMPOSERY_DISABLE_PROXY"],
	["CS_STATIC_BASE", "COMPOSERY_STATIC_BASE"],
	["CS_TELEMETRY_URL", "COMPOSERY_TELEMETRY_URL"],
	["process.env.PASSWORD", "process.env.COMPOSERY_PASSWORD"],
	["process.env.HASHED_PASSWORD", "process.env.COMPOSERY_HASHED_PASSWORD"],
	["$PASSWORD", "$COMPOSERY_PASSWORD"],
	["$HASHED_PASSWORD", "$COMPOSERY_HASHED_PASSWORD"],
	["process.env.LOG_LEVEL", "process.env.COMPOSERY_LOG_LEVEL"],
	["process.env.GITHUB_TOKEN", "process.env.COMPOSERY_GITHUB_TOKEN"],
	[
		"process.env.EXTENSIONS_GALLERY",
		"process.env.COMPOSERY_EXTENSIONS_GALLERY"
	],
	["process.env.VSCODE_PROXY_URI", "process.env.COMPOSERY_PROXY_URI"],
	["VSCODE_PROXY_URI", "COMPOSERY_PROXY_URI"],
	["EXTENSIONS_GALLERY", "COMPOSERY_EXTENSIONS_GALLERY"],
	["GITHUB_TOKEN", "COMPOSERY_GITHUB_TOKEN"],
	["LOG_LEVEL", "COMPOSERY_LOG_LEVEL"],
	["code-server-ipc.sock", "composery-ipc.sock"],
	["code-server-session", "composery-session"],
	["code-server-stdout.log", "composery-stdout.log"],
	["code-server-stderr.log", "composery-stderr.log"],
	["coder-logs", "composery-logs"],
	["coder.json", "composery.json"],
	[".code-server", ".composery"],
	["/tmp/code-server", "/tmp/composery"],
	["codeServerVersion", "composeryVersion"],
	["codeServer: version", "composery: version"],
	["codeServerSocketPath", "composerySocketPath"],
	["aboutCodeServerDetail", "aboutComposeryDetail"],
	["ensureCodeServerLoaded", "ensureVSCodeServerLoaded"],
	["CodeServerClient", "ComposeryClient"],
	["codeServerClient", "composeryClient"],
	["CodeServerRouteWrapper", "ComposeryRouteWrapper"],
	["runCodeServer", "runComposeryServer"],
	["CoderSettings", "ComposerySettings"],
	["IsEnabledCoderGettingStarted", "IsEnabledComposeryGettingStarted"],
	["isEnabledCoderGettingStarted", "isEnabledComposeryGettingStarted"],
	["csLastUpdateNotification", "composeryLastUpdateNotification"],
	["code-server.logout", "composery.logout"],
	["coder-options", "composery-options"],
	["{{CS_STATIC_BASE}}", "{{COMPOSERY_STATIC_BASE}}"],
	[
		"fix-bin-script remote-cli/code-server",
		[
			"remote_cli_script=",
			"      for candidate in remote-cli/ide remote-cli/composery remote-cli/code-*; do",
			'        if [ -f "lib/vscode-reh-web-$VSCODE_TARGET/bin/$candidate" ]; then',
			'          remote_cli_script="$candidate"',
			"          break",
			"        fi",
			"      done",
			'      if [ -z "$remote_cli_script" ]; then',
			'        echo "No remote CLI script found in lib/vscode-reh-web-$VSCODE_TARGET/bin/remote-cli" >&2',
			'        ls -la "lib/vscode-reh-web-$VSCODE_TARGET/bin/remote-cli" >&2',
			"        exit 1",
			"      fi",
			'      fix-bin-script "$remote_cli_script"',
			'      if [ "$remote_cli_script" != "remote-cli/ide" ]; then',
			'        mv "lib/vscode-reh-web-$VSCODE_TARGET/bin/$remote_cli_script" "lib/vscode-reh-web-$VSCODE_TARGET/bin/remote-cli/ide"',
			"      fi"
		].join("\n      ")
	],
	["bin/code-server", "bin/ide"],
	["code-server-linux.sh", "ide-linux.sh"],
	["code-server-darwin.sh", "ide-darwin.sh"],
	["code-server.cmd", "ide.cmd"],
	["code-server-current", "composery-current"],
	["code-server@", "ide@"],
	["code-server.service", "ide.service"],
	["code-server-nfpm", "ide-nfpm"],
	["code-server.sh", "ide.sh"],
	["code-server", "Composery"],
	["Code-server", "Composery"],
	["Code Server", "Composery"],
	["codeserver", "composery"],
	["coder.code-server", "io.composery.ide"],
	[
		"https://github.com/coder/Composery",
		"https://github.com/sloikodavid/composery"
	],
	[
		"https://github.com/cdr/Composery",
		"https://github.com/sloikodavid/composery"
	],
	["https://cdr.co/Composery-to-coder", "https://www.composery.io"],
	["https://coder.com", "https://www.composery.io"],
	["https://www.coder.com", "https://www.composery.io"],
	["test.coder.com", "test.composery.io"],
	["coder.com", "composery.io"],
	["security@coder.com", "hello@composery.io"],
	["Coder Technologies Inc.", "Composery"],
	["Coder Technologies", "Composery"],
	["Coder", "Composery"],
	[
		'sed -i.bak "s/@@APPNAME@@/Composery/g"',
		'sed -i.bak "s/@@APPNAME@@/ide/g"'
	],
	['"applicationName": "Composery"', '"applicationName": "composery"'],
	[
		'"win32ShellNameShort": "c&ode-server"',
		'"win32ShellNameShort": "&Composery"'
	],
	[
		'"darwinBundleIdentifier": "com.composery.code.server"',
		'"darwinBundleIdentifier": "io.composery.ide"'
	],
	['"ariaKey": "Composery"', '"ariaKey": "composery"'],
	["coder.Composery", "io.composery.ide"]
];

const productJsonReplacements = {
	nameShort: "Composery",
	nameLong: "Composery",
	applicationName: "composery",
	dataFolderName: ".composery",
	serverDataFolderName: ".composery-server",
	win32MutexName: "composery",
	win32DirName: "Composery",
	win32NameVersion: "Composery",
	win32RegValueName: "Composery",
	win32AppUserModelId: "io.composery.ide",
	win32x64AppId: "{{EAE146CF-271E-49B4-B312-21EBA98D3CB8}",
	win32arm64AppId: "{{03BC8655-6AA6-46D7-BCEF-65B0530A95EF}",
	win32UserAppId: "{{15381C3C-193D-43F9-94A9-E52401AF5EB4}",
	win32x64UserAppId: "{{39755874-4029-4760-A8D4-D04E5FD79219}",
	win32arm64UserAppId: "{{F5BD8295-9BEE-4FC0-B26C-E95876E9F3B1}",
	win32AppId: "{{B1B83327-44A6-41DA-8AD9-811763DCA6AE}",
	darwinBundleIdentifier: "io.composery.ide",
	linuxIconName: "io.composery.ide",
	licenseUrl: "https://github.com/sloikodavid/composery/blob/main/LICENSE",
	reportIssueUrl: "https://github.com/sloikodavid/composery/issues/new"
};

const manifestReplacements = {
	name: "Composery",
	short_name: "Composery",
	description: "Composery"
};

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAll(content) {
	let next = content;
	for (const [from, to] of replacements) {
		next = next.replace(new RegExp(escapeRegExp(from), "g"), to);
	}
	return next;
}

function isTextFile(path) {
	const name = path.split(/[\\/]/).pop();
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
	return textFiles.has(name) || textExtensions.has(ext);
}

function walk(path, files = []) {
	const stat = statSync(path);
	if (stat.isDirectory()) {
		const name = path.split(/[\\/]/).pop();
		if (skippedDirs.has(name)) return files;
		for (const entry of readdirSync(path)) {
			walk(join(path, entry), files);
		}
	} else if (stat.isFile() && isTextFile(path)) {
		files.push(path);
	}
	return files;
}

function rewriteJson(path, mutate) {
	if (!existsSync(path)) return;
	const json = JSON.parse(readFileSync(path, "utf8"));
	mutate(json);
	writeFileSync(path, `${JSON.stringify(json, null, "\t")}\n`);
}

function renameIfExists(from, to) {
	const absoluteFrom = join(target, from);
	const absoluteTo = join(target, to);
	if (!existsSync(absoluteFrom)) return;
	mkdirSync(dirname(absoluteTo), { recursive: true });
	rmSync(absoluteTo, { force: true, recursive: true });
	renameSync(absoluteFrom, absoluteTo);
}

function run(command, args, options = {}) {
	execFileSync(command, args, {
		cwd: REPO_ROOT,
		stdio: "inherit",
		...options
	});
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function assertRebrandRulesAreScoped() {
	const forbiddenRules = new Set(["coder.", "coder"]);

	for (const [from] of replacements) {
		assert(
			!forbiddenRules.has(from),
			`Unsafe broad rebrand rule found in rebrand.mjs: ${from}`
		);
	}
}

function archive(sourceRepo, archivePath, paths) {
	run("git", [
		"-C",
		sourceRepo,
		"-c",
		"core.autocrlf=false",
		"archive",
		"HEAD",
		...paths,
		"-o",
		archivePath
	]);
}

function extract(archivePath, destination) {
	run("tar", ["-xf", archivePath, "-C", destination]);
	rmSync(archivePath, { force: true });
}

const sentinelPath =
	"lib/vscode/src/vs/composery-rebrand-identifier-sentinel.ts";
const sentinelSource = `
const encoder = new TextEncoder();
encoder.encode("coder.com");
const textEncoder = new TextEncoder();
textEncoder.encode("coder.com");
const decoder = new TextDecoder();
decoder.decode(new Uint8Array());
const textDecoder = new TextDecoder();
textDecoder.decode(new Uint8Array());
const stdoutDecoder = new TextDecoder();
stdoutDecoder.decode(new Uint8Array());
const stderrDecoder = new TextDecoder();
stderrDecoder.decode(new Uint8Array());
`;

function prepareCheckTarget() {
	const upstream = join(PACKAGE_ROOT, "upstream");
	const vscode = join(upstream, "lib/vscode");

	if (!existsSync(join(upstream, "package.json"))) {
		console.error("packages/ide/upstream is empty; run pnpm setup.");
		process.exit(1);
	}

	if (!existsSync(join(vscode, "package.json"))) {
		console.error("packages/ide/upstream/lib/vscode is empty; run pnpm setup.");
		process.exit(1);
	}

	assertRebrandRulesAreScoped();
	rmSync(target, { force: true, recursive: true });
	mkdirSync(join(target, "lib/vscode/src/vs"), { recursive: true });

	const upstreamArchive = join(target, "upstream.tar");
	archive(upstream, upstreamArchive, [
		"package.json",
		"package-lock.json",
		"ci",
		"src",
		"typings"
	]);
	extract(upstreamArchive, target);

	const vscodeArchive = join(target, "vscode.tar");
	archive(vscode, vscodeArchive, [
		"src",
		"build/buildfile.ts",
		"build/gulpfile.reh.ts",
		"resources/server"
	]);
	extract(vscodeArchive, join(target, "lib/vscode"));

	writeFileSync(join(target, sentinelPath), sentinelSource);
}

function assertSentinelSurvived() {
	const transformed = readFileSync(join(target, sentinelPath), "utf8");
	const required = [
		"encoder.encode",
		"textEncoder.encode",
		"decoder.decode",
		"textDecoder.decode",
		"stdoutDecoder.decode",
		"stderrDecoder.decode",
		"composery.io"
	];
	const forbidden = ["encomposery", "decomposery"];

	for (const value of required) {
		assert(
			transformed.includes(value),
			`Rebrand damaged or missed sentinel token: ${value}`
		);
	}

	for (const value of forbidden) {
		assert(
			!transformed.toLowerCase().includes(value),
			`Rebrand created broken identifier: ${value}`
		);
	}
}

function assertBuildScriptSurvived() {
	const buildScript = readFileSync(
		join(target, "ci/build/build-vscode.sh"),
		"utf8"
	);

	assert(
		buildScript.includes("remote_cli_script="),
		"Rebrand must discover the generated remote CLI script before renaming it."
	);
	assert(
		!buildScript.includes("fix-bin-script remote-cli/ide"),
		"Rebrand must not assume VS Code generated remote-cli/ide before the rename."
	);
}

function syncInitialColorThemes() {
	const themeServicePath = join(
		target,
		"lib/vscode/src/vs/workbench/services/themes/common/workbenchThemeService.ts"
	);
	if (!existsSync(themeServicePath)) return;
	let source = readFileSync(themeServicePath, "utf8");

	for (const [constant, themeFile] of [
		["COLOR_THEME_DARK_INITIAL_COLORS", "composery-dark.json"],
		["COLOR_THEME_LIGHT_INITIAL_COLORS", "composery-light.json"]
	]) {
		const theme = JSON.parse(
			readFileSync(
				join(
					PACKAGE_ROOT,
					"overlay/lib/vscode/extensions/composery-themes/themes",
					themeFile
				),
				"utf8"
			)
		);
		const entries = Object.entries(theme.colors).map(
			([key, value]) => `\t'${key}': '${value}',`
		);
		const replacement = `export const ${constant} = {\n${entries.join("\n")}\n};`;
		const pattern = new RegExp(
			`export const ${constant} = \\{[\\s\\S]*?\\n\\};`
		);

		assert(pattern.test(source), `Missing initial color constant: ${constant}`);
		source = source.replace(pattern, replacement);
	}

	writeFileSync(themeServicePath, source);
}

if (check) {
	prepareCheckTarget();
} else if (!target || !existsSync(join(target, "package.json"))) {
	console.error(
		"Usage: node packages/ide/scripts/rebrand.mjs <assembled-upstream-tree>\n" +
			"       node packages/ide/scripts/rebrand.mjs --check"
	);
	process.exit(64);
}

rewriteJson(join(target, "package.json"), (json) => {
	json.name = "ide";
	json.description = "Run the Composery IDE on a remote server.";
	json.homepage = "https://github.com/sloikodavid/composery";
	json.repository = {
		type: "git",
		url: "https://github.com/sloikodavid/composery.git",
		directory: "packages/ide"
	};
	json.bugs = {
		url: "https://github.com/sloikodavid/composery/issues"
	};
	json.bin = {
		ide: "out/node/entry.js"
	};
	json.keywords = ["composery", "ide", "vscode", "browser"];
});

rewriteJson(
	join(target, "lib/vscode/resources/server/manifest.json"),
	(json) => {
		Object.assign(json, manifestReplacements);
	}
);

renameIfExists("ci/build/code-server.sh", "ci/build/ide.sh");
renameIfExists("ci/build/code-server-nfpm.sh", "ci/build/ide-nfpm.sh");
renameIfExists("ci/build/build-code-server.sh", "ci/build/build-ide.sh");
renameIfExists(
	"ci/build/code-server-user.service",
	"ci/build/ide-user.service"
);
renameIfExists("ci/build/code-server@.service", "ci/build/ide@.service");
renameIfExists(
	"lib/vscode/resources/server/bin/code-server-linux.sh",
	"lib/vscode/resources/server/bin/ide-linux.sh"
);
renameIfExists(
	"lib/vscode/resources/server/bin/code-server-darwin.sh",
	"lib/vscode/resources/server/bin/ide-darwin.sh"
);
renameIfExists(
	"lib/vscode/resources/server/bin/code-server.cmd",
	"lib/vscode/resources/server/bin/ide.cmd"
);

for (const root of roots) {
	const absolute = join(target, root);
	if (!existsSync(absolute)) continue;
	for (const file of walk(absolute)) {
		const before = readFileSync(file, "utf8");
		const after = replaceAll(before);
		if (after !== before) writeFileSync(file, after);
	}
}

syncInitialColorThemes();

rewriteJson(join(target, "lib/vscode/product.json"), (json) => {
	Object.assign(json, productJsonReplacements);
	delete json.ariaKey;
});

const scannedRoots = roots
	.map((root) => join(target, root))
	.filter((root) => existsSync(root));
const forbidden = [
	/CODE_SERVER/,
	/\bCS_[A-Z0-9_]+/,
	/code-server/i,
	/codeserver/i,
	/codeServer/,
	/CodeServer/,
	/\.code-server/,
	/coder\.com/i,
	/cdr\.co/i,
	/coder-options/,
	/coder-logs/,
	/coder\.code-server/,
	/encomposery/i,
	/decomposery/i
];
const allowed = [
	/@coder\/logger/,
	/"@coder\/logger"/,
	/node_modules\/@coder\/logger/,
	/VSCODE_SERVER_/,
	/VSCodeServer/,
	/IVSCodeServerAPI/,
	/const codeServer =/,
	/buildfile\.codeServer/,
	/^\s*codeServer,\s*$/,
	/vscodeServer/,
	/vscode-server/
];
const violations = [];

for (const root of scannedRoots) {
	for (const file of walk(root)) {
		const relativeFile = relative(target, file).replaceAll("\\", "/");
		const lines = readFileSync(file, "utf8").split(/\r?\n/);
		lines.forEach((line, index) => {
			if (allowed.some((pattern) => pattern.test(line))) return;
			for (const pattern of forbidden) {
				if (pattern.test(line)) {
					violations.push(`${relativeFile}:${index + 1}: ${line.trim()}`);
					return;
				}
			}
		});
	}
}

if (violations.length > 0) {
	console.error("Rebrand left old live code-server/Coder names behind:");
	for (const line of violations.slice(0, 80)) console.error(`  ${line}`);
	if (violations.length > 80) {
		console.error(`  ...and ${violations.length - 80} more`);
	}
	process.exit(1);
}

if (check) {
	assertSentinelSurvived();
	assertBuildScriptSurvived();
	console.log(
		"Rebrand check passed against upstream server and VS Code trees."
	);
	rmSync(target, { force: true, recursive: true });
} else {
	console.log(`Rebranded IDE tree: ${target}`);
}
