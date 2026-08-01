import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRuntimeArtifacts } from "../../../packages/web/convex/boxes/infra/runtimeArtifacts.ts";
import {
	INSPECT_SCRIPT,
	applyRuntimeConfigScript,
	bootstrapScript,
	copyFromParkingScript,
	copyToParkingScript,
	measureUsageScript,
	reloadCaddyfileScript,
	repairScript,
	rewritePasswordScript,
	runtimeLogsScript,
	unmountParkingScript,
	updateScript,
	verifyParkingScript
} from "../../../packages/web/convex/boxes/infra/sshScripts.ts";

const artifacts = renderRuntimeArtifacts({
	cloudBoxId: "box_123",
	cloudOrigin: "https://www.composery.io",
	config: { COMPOSERY_DISABLE_FILE_UPLOADS: "1" },
	domain: "box.composery.cloud",
	runtimeAuthHash: "$argon2id$hash",
	runtimeImage: `ghcr.io/example/composery@sha256:${"a".repeat(64)}`,
	runtimePort: 8080
});

const scripts = {
	"apply configuration": applyRuntimeConfigScript(artifacts.env),
	bootstrap: bootstrapScript(artifacts),
	"copy back": copyFromParkingScript(artifacts, 42),
	"copy out": copyToParkingScript(42),
	inspection: INSPECT_SCRIPT,
	"measure usage": measureUsageScript(),
	"reload Caddy": reloadCaddyfileScript(artifacts.caddyfile),
	repair: repairScript(artifacts),
	"rewrite password": rewritePasswordScript(artifacts.env, "$argon2id$hash"),
	"runtime logs": runtimeLogsScript(100),
	"unmount parking": unmountParkingScript(),
	update: updateScript(artifacts),
	"verify back": verifyParkingScript("back", 42),
	"verify out": verifyParkingScript("out", 42)
};

for (const [name, script] of Object.entries(scripts)) {
	const checked = spawnSync("bash", ["-n"], {
		encoding: "utf8",
		input: script
	});
	if (checked.status !== 0) {
		throw new Error(`${name} is not valid Bash:\n${checked.stderr}`);
	}
}

const directory = await mkdtemp(join(tmpdir(), "composery-artifacts-"));
try {
	await Promise.all([
		writeFile(join(directory, "Caddyfile"), artifacts.caddyfile),
		writeFile(join(directory, "compose.yml"), artifacts.compose),
		writeFile(join(directory, "composery.env"), artifacts.env)
	]);
	const checked = spawnSync(
		"docker",
		["compose", "-f", "compose.yml", "config", "--quiet"],
		{ cwd: directory, encoding: "utf8" }
	);
	if (checked.status !== 0) {
		throw new Error(
			`The runtime Compose artifact is invalid:\n${checked.stderr}`
		);
	}
} finally {
	await rm(directory, { force: true, recursive: true });
}

console.log(
	`validated ${Object.keys(scripts).length} Bash scripts and Compose`
);
