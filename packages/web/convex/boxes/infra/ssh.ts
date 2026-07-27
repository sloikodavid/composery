"use node";

import ssh2 from "ssh2";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { internalAction, type ActionCtx } from "../../_generated/server";
import { requiredEnv, runtimeDomain, websiteOrigin } from "../../env";
import { vRecoveryStatus, type RecoveryStatus } from "../recoveryTypes";
import {
	COMPOSERY_CADDYFILE_PATH,
	COMPOSERY_COMPOSE_PATH,
	COMPOSERY_ENV_PATH,
	renderComposeryEnv,
	renderCaddyfile,
	renderRuntimeArtifacts,
	type RuntimeArtifacts
} from "./runtimeArtifacts";
import { parkingVolumeDevicePath } from "./hetznerVps";
import { privateKey } from "./sshKeys";

const { Client } = ssh2;

type SshTarget = {
	host: string;
	privateKey: string;
	username: string;
};

function runtimePort() {
	const value = Number(requiredEnv("RUNTIME_PORT"));
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error("RUNTIME_PORT must be a positive integer.");
	}
	return value;
}

function logTail(value: number) {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error("Log tail must be a positive integer.");
	}
	return Math.min(value, 5000);
}

export function sshTarget(host: string): SshTarget {
	return {
		host,
		username: requiredEnv("SSH_USER"),
		privateKey: privateKey()
	};
}

function heredoc(path: string, delimiter: string, contents: string) {
	return `cat > ${path} <<'${delimiter}'
${contents}${contents.endsWith("\n") ? "" : "\n"}${delimiter}`;
}

// `docker compose up -d` returns once the container is created, not once the
// editor is serving, so a crash-looping box would report a clean repair. The
// owner is root on this host and can break it in ways we cannot enumerate -
// the only honest answer is to watch the editor come back, or fail.
const AWAIT_IDE = `attempt=1
while [ "$attempt" -le 60 ]; do
	if docker exec composery systemctl is-active --quiet ide.service 2>/dev/null; then
		exit 0
	fi
	sleep 2
	attempt=$((attempt + 1))
done
echo "The runtime came up but its editor never started." >&2
exit 1
`;

// Writes the three runtime files to /opt/composery-web. Shared by every script
// that has to lay the compose project down before acting on it (bootstrap, and a
// repair's post-reboot materialize and force-recreate bring-up), so the one place
// a file's path or heredoc delimiter is decided cannot drift between them.
function writeRuntimeFilesScript({
	caddyfile,
	compose,
	env
}: RuntimeArtifacts) {
	return `install -d /opt/composery-web
${heredoc(COMPOSERY_COMPOSE_PATH, "__COMPOSERY_COMPOSE__", compose)}
${heredoc(COMPOSERY_ENV_PATH, "__COMPOSERY_ENV__", env)}
${heredoc(COMPOSERY_CADDYFILE_PATH, "__COMPOSERY_CADDY__", caddyfile)}`;
}

// Writes the runtime files and brings the stack up. The three callers differ on
// exactly three axes, so one function decides all of them and no caller can
// assemble a combination nobody reasoned about:
//
//   - **bootstrap** - a first boot. The pull is a precondition (there is no
//     local image to fall back to), nothing needs force-recreating because
//     nothing is running, and there is no promise to keep about the editor.
//   - **repair** - "get this box serving again". Force-recreate restarts a
//     wedged container whose config still matches, which is exactly what
//     `up -d` skips, and the pull is tolerant (below).
//   - **update** - "move this box to a new image". The pull is a precondition
//     again: if the new image cannot be fetched there is nothing to update to,
//     and continuing would restart the box on its old image and then report the
//     new one as running. Compose recreates the service whose image reference
//     changed, so force-recreate would only add an unnecessary restart of the
//     containers that did not change.
//
// Both repair and update hold until the editor answers, so success means the
// box genuinely serves. Named volumes (the box's files) survive all three.
export type BootstrapType = "bootstrap" | "repair" | "update";

export function bootstrapScript({
	caddyfile,
	compose,
	env,
	type = "bootstrap"
}: {
	caddyfile: string;
	compose: string;
	env: string;
	type?: BootstrapType;
}) {
	return `set -euo pipefail
${writeRuntimeFilesScript({ caddyfile, compose, env })}
${
	type === "repair"
		? // Repair exists to get a broken box serving again, so a pull is an
			// upgrade attempt, not a precondition: under `set -e` an unreachable
			// registry or a pruned digest would abort before anything restarts and
			// leave the box exactly as broken as it was. Fall through to the local
			// image instead. AWAIT_IDE still decides whether the repair worked, so
			// this cannot turn a failure into a false success.
			`docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} pull || echo "Could not pull the runtime image; repairing with the image already on this host." >&2`
		: `docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} pull`
}
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} up -d${type === "repair" ? " --force-recreate" : ""}
${type === "bootstrap" ? "" : AWAIT_IDE}`;
}

// The whole stderr stream is not an error message. `docker compose` narrates
// itself there ("caddy Pulling", "Container composery Started"), so a failing
// script hands back a paragraph of healthy-looking progress with the one real
// sentence buried at the end - and that paragraph is what the box owner reads
// in the Repair dialog. The last line is the failure; everything above it is
// the run that led there, and the logs already hold that.
export function sshFailure(stderr: string, code: number | null) {
	const lines = stderr.trim().split("\n");
	return (
		lines[lines.length - 1].trim() || `SSH command failed with exit ${code}.`
	);
}

// Where a Repair mounts the attached parking volume on the host.
export const PARKING_MOUNT = "/mnt/composery-parking";

// The fidelity flags a Repair's copies stand or fall on. The box's files are a
// persistence delta, not ordinary files, and on a cloud box the delta is an
// overlayfs upper layer: `renderCompose` runs the container privileged, so the
// engine probe succeeds and every box here runs `overlay` rather than `copy`.
// That makes these flags load-bearing rather than defensive - under overlay the
// filesystem attributes *are* the data. It stores xattrs (including the
// `trusted.overlay.*` set on the upper, where `opaque` is what hides a
// directory), ACLs, file capabilities, hardlinks, device nodes - the whiteouts
// recording deletions are character devices 0:0 - and sparse files. `cp -a`
// silently drops most of these and the box comes back subtly corrupted:
// deleted files returning, new image content hidden. So every copy uses one
// shared flag set: -a (recursive, symlinks, perms, times, group, owner,
// devices), -H (hardlinks), -A (ACLs), -X (all xattr namespaces - as root this
// includes `trusted.*`), -S (sparse), and --numeric-ids (no uid/gid remapping).
// One constant so the copy and its verification can never disagree about what
// "faithful" means. `docs/self-hosting/index.md` documents the same set as the
// volume backup recipe, for the same reason.
const RSYNC_FIDELITY_FLAGS = "-aHAXS --numeric-ids";

// rsync is tiny and usually preinstalled on the Docker-CE host image, but not
// guaranteed; install it if missing so a repair fails loudly on a real problem
// rather than a missing tool.
const ENSURE_RSYNC = `command -v rsync >/dev/null 2>&1 || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rsync; }`;

// Derives the exact set of Docker volumes to copy from the rendered compose file
// on the host - never a hardcoded list, so a volume added to renderCompose later
// is picked up automatically - and resolves each compose volume key to the host
// mountpoint of the real Docker volume compose created for it (via compose's own
// project/volume labels, which hold whatever name it assigned). Emitting nothing
// is treated as an error, not an empty success.
const VOLUME_ENUMERATION = `resolve_mp() {
	vol="$(docker volume ls -q --filter label=com.docker.compose.project=composery --filter "label=com.docker.compose.volume=$1")"
	if [ -z "$vol" ]; then echo "No Docker volume found for compose volume '$1'." >&2; return 1; fi
	mp="$(docker volume inspect --format '{{ .Mountpoint }}' "$vol")"
	if [ -z "$mp" ]; then echo "Docker volume '$vol' has no mountpoint." >&2; return 1; fi
	printf '%s' "$mp"
}
VOLUME_KEYS="$(docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} config --volumes)"
if [ -z "$VOLUME_KEYS" ]; then echo "The compose file declares no volumes to copy." >&2; exit 1; fi`;

// Wait for the attached volume's stable by-id device node, then mount it once.
// Idempotent so a retried step does not fail on an already-mounted volume.
function mountParkingScript(volumeId: number) {
	const device = parkingVolumeDevicePath(volumeId);
	return `device="${device}"
attempt=1
while [ "$attempt" -le 30 ]; do
	[ -b "$device" ] && break
	sleep 1
	attempt=$((attempt + 1))
done
if [ ! -b "$device" ]; then echo "Parking volume device $device never appeared." >&2; exit 1; fi
mkdir -p ${PARKING_MOUNT}
mountpoint -q ${PARKING_MOUNT} || mount "$device" ${PARKING_MOUNT}`;
}

// Sum the actual used bytes of the box volumes, so the parking volume is sized
// from real usage rather than the whole disk. `du -sb` counts apparent bytes.
export function measureUsageScript() {
	return `set -euo pipefail
${VOLUME_ENUMERATION}
total=0
for key in $VOLUME_KEYS; do
	mp="$(resolve_mp "$key")"
	bytes="$(du -sb "$mp" | awk 'NR == 1 { print $1 }')"
	total=$((total + bytes))
done
printf 'used_bytes=%s\\n' "$total"`;
}

// Copy every box volume onto the parking volume. The stack is stopped first so
// the copy is a consistent, quiescent snapshot rather than a moving target - the
// box is down for the whole repair anyway.
export function copyToParkingScript(volumeId: number) {
	return `set -euo pipefail
${ENSURE_RSYNC}
${VOLUME_ENUMERATION}
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} stop
${mountParkingScript(volumeId)}
for key in $VOLUME_KEYS; do
	mp="$(resolve_mp "$key")"
	mkdir -p "${PARKING_MOUNT}/$key"
	rsync ${RSYNC_FIDELITY_FLAGS} --delete "$mp/" "${PARKING_MOUNT}/$key/"
done`;
}

// Copy the parked files back onto the freshly rebuilt host's volumes. The runtime
// files are written and `docker compose create` materializes the (empty) named
// volumes without starting anything, so the files land before any container can
// touch them.
export function copyFromParkingScript(
	artifacts: RuntimeArtifacts,
	volumeId: number
) {
	return `set -euo pipefail
${ENSURE_RSYNC}
${writeRuntimeFilesScript(artifacts)}
${mountParkingScript(volumeId)}
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} pull
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} create
${VOLUME_ENUMERATION}
for key in $VOLUME_KEYS; do
	mp="$(resolve_mp "$key")"
	rsync ${RSYNC_FIDELITY_FLAGS} --delete "${PARKING_MOUNT}/$key/" "$mp/"
done`;
}

// The copy is only trusted once an independent pass proves it. A dry-run rsync
// with the same fidelity flags plus --checksum re-reads both trees and itemizes
// every path that differs in content, size, perms, owner, xattr, ACL, or
// existence; --delete makes an extra file on the destination show up too. A
// faithful copy prints nothing. "rsync exited 0" during the copy is never taken
// as proof on its own - this is. `direction` decides which tree is the source of
// truth: on the way out the box's volume is; on the way back the parked copy is.
export function verifyParkingScript(
	direction: "out" | "back",
	volumeId: number
) {
	const compare =
		direction === "out"
			? `rsync ${RSYNC_FIDELITY_FLAGS} -ni -c --delete "$mp/" "${PARKING_MOUNT}/$key/"`
			: `rsync ${RSYNC_FIDELITY_FLAGS} -ni -c --delete "${PARKING_MOUNT}/$key/" "$mp/"`;
	return `set -euo pipefail
${ENSURE_RSYNC}
${VOLUME_ENUMERATION}
${mountParkingScript(volumeId)}
for key in $VOLUME_KEYS; do
	mp="$(resolve_mp "$key")"
	out="$(${compare})"
	if [ -n "$out" ]; then printf '%s\\n' "$out" | sed "s#^#$key: #"; fi
done`;
}

// A settled parked copy is unmounted before the volume is detached and deleted.
export function unmountParkingScript() {
	return `set -euo pipefail
if mountpoint -q ${PARKING_MOUNT}; then umount ${PARKING_MOUNT}; fi`;
}

// Any itemized line rsync's verification pass printed is a difference, so any
// non-empty content means the copy is not faithful. Pure and total so the
// decision is unit-testable without a host.
export function parseParkingVerification(stdout: string): string[] {
	return stdout
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.trim().length > 0);
}

export async function runSsh(
	target: SshTarget,
	command: string,
	options: { maxOutputBytes?: number; timeoutMs?: number } = {}
) {
	return await new Promise<{ stderr: string; stdout: string }>(
		(resolve, reject) => {
			const client = new Client();
			let done = false;
			let outputBytes = 0;
			const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
			const timeout = setTimeout(
				() => finish(new Error("SSH command timed out.")),
				options.timeoutMs ?? 10 * 60_000
			);

			function finish(
				error?: Error,
				output?: { stderr: string; stdout: string }
			) {
				if (done) return;
				done = true;
				clearTimeout(timeout);
				client.end();
				if (error) reject(error);
				else resolve(output ?? { stderr: "", stdout: "" });
			}

			client
				.on("ready", () => {
					client.exec(command, (error, stream) => {
						if (error) {
							finish(error);
							return;
						}

						let stdout = "";
						let stderr = "";
						stream.on("data", (chunk: Buffer) => {
							if (done) return;
							outputBytes += chunk.length;
							if (outputBytes > maxOutputBytes) {
								finish(new Error("SSH command output exceeded its limit."));
								return;
							}
							stdout += chunk.toString("utf8");
						});
						stream.stderr.on("data", (chunk: Buffer) => {
							if (done) return;
							outputBytes += chunk.length;
							if (outputBytes > maxOutputBytes) {
								finish(new Error("SSH command output exceeded its limit."));
								return;
							}
							stderr += chunk.toString("utf8");
						});
						stream.on("error", finish);
						stream.on("close", (code: number | null) => {
							if (code && code !== 0) {
								finish(new Error(sshFailure(stderr, code)));
								return;
							}
							finish(undefined, { stdout, stderr });
						});
					});
				})
				.on("error", finish)
				.connect({
					host: target.host,
					username: target.username,
					privateKey: target.privateKey,
					readyTimeout: 60_000
				});
		}
	);
}

// Prints one `key=value` line per layer the Repair dialog shows. `set +e` keeps
// a failed probe from killing the rest, so every key is reported even when the
// box is badly broken. `parseRuntimeInspection` reads these keys back; a test
// pins the two together.
export const INSPECT_SCRIPT = `set +e
if docker info >/dev/null 2>&1; then echo docker=active; else echo docker=inactive; fi
state="$(docker inspect --format '{{if .State.Running}}active{{else}}inactive{{end}}' caddy 2>/dev/null)"
printf 'outer_caddy=%s\\n' "\${state:-missing}"
state="$(docker inspect --format '{{if .State.Running}}active{{else}}inactive{{end}}' composery 2>/dev/null)"
printf 'composery=%s\\n' "\${state:-missing}"
disk="$(df -P / 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
printf 'disk_used_percent=%s\\n' "$disk"
for service in persistence caddy ide; do
	state="$(docker exec composery systemctl is-active "$service.service" 2>/dev/null)"
	case "$state" in active) ;; inactive|failed|activating|deactivating) state=inactive ;; *) state=missing ;; esac
	printf '%s=%s\\n' "$service" "$state"
done
# Which persistence engine this boot chose. Only the daemon can answer, so a box
# whose persistence is down reports "unknown" rather than a guess - the same
# rule the service states follow.
engine="$(docker exec composery /opt/composery/bin/composery persistence status 2>/dev/null | sed -n 's/^[[:space:]]*engine:[[:space:]]*//p' | head -n 1)"
printf 'engine=%s\\n' "\${engine:-unknown}"
`;

function componentState(value: string | undefined) {
	return value === "active" || value === "inactive" || value === "missing"
		? value
		: "unknown";
}

export function parseRuntimeInspection(stdout: string): RecoveryStatus {
	const values = new Map(
		stdout
			.split("\n")
			.map((line) => line.trim().split("=", 2))
			.filter((parts): parts is [string, string] => parts.length === 2)
	);
	// The owner is root on their own host, so every line here is untrusted
	// input. `df` prints a plain integer percentage and nothing else qualifies:
	// `Number` alone would take "0x10" as 16, and an empty value - what a failed
	// `df` leaves behind - as a perfectly empty disk.
	const rawDisk = values.get("disk_used_percent") ?? "";
	const diskUsedPercent = /^\d{1,3}$/.test(rawDisk) ? Number(rawDisk) : 101;
	const rawEngine = values.get("engine");
	return {
		hostReachable: true,
		httpReachable: false,
		diskUsedPercent: diskUsedPercent <= 100 ? diskUsedPercent : null,
		engine:
			rawEngine === "overlay" || rawEngine === "copy" ? rawEngine : "unknown",
		docker: componentState(values.get("docker")),
		outerCaddy: componentState(values.get("outer_caddy")),
		composery: componentState(values.get("composery")),
		persistence: componentState(values.get("persistence")),
		caddy: componentState(values.get("caddy")),
		ide: componentState(values.get("ide"))
	};
}

const UNREACHABLE_STATUS: RecoveryStatus = {
	hostReachable: false,
	httpReachable: false,
	diskUsedPercent: null,
	engine: "unknown",
	docker: "unknown",
	outerCaddy: "unknown",
	composery: "unknown",
	persistence: "unknown",
	caddy: "unknown",
	ide: "unknown"
};

export const inspectRuntime = internalAction({
	args: { boxId: v.id("boxes") },
	returns: vRecoveryStatus,
	handler: async (ctx, args): Promise<RecoveryStatus> => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_ipv4) return UNREACHABLE_STATUS;

		try {
			const { stdout } = await runSsh(
				sshTarget(box.hetzner_ipv4),
				INSPECT_SCRIPT,
				{ maxOutputBytes: 64 * 1024, timeoutMs: 20_000 }
			);
			return parseRuntimeInspection(stdout);
		} catch {
			return UNREACHABLE_STATUS;
		}
	}
});

// The runtime files a box's SSH scripts write, built from its current row. One
// place so bootstrap and a repair's steps can never render them differently.
//
// `runtimeImage` overrides the row for the one operation that is deliberately
// writing a compose file the row does not describe yet: an update renders the
// image it is moving *to*, while `box.runtime_image` still records the last
// image known to serve. The row is only advanced once the new one has answered
// (see `updateBox`), which is what makes a failed update leave a compose file
// Repair can roll back from.
function runtimeArtifactsForBox(box: Doc<"boxes">, runtimeImage?: string) {
	const image = runtimeImage ?? box.runtime_image;
	if (!image) {
		throw new Error("Box has no runtime image.");
	}
	return renderRuntimeArtifacts({
		cloudBoxId: box._id,
		cloudOrigin: websiteOrigin(),
		config: box.runtime_config,
		domain: runtimeDomain(box.slug),
		runtimeAuthHash: box.runtime_auth_hash,
		runtimeImage: image,
		runtimePort: runtimePort()
	});
}

// One data-preserving repair for a wedged box: rewrite the runtime files (in
// case they were damaged), re-pull the image, and force-recreate the stack. The
// box's files live in named volumes and are untouched.
export const repairRuntime = internalAction({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for repair.");
		}
		const artifacts = runtimeArtifactsForBox(box);

		await runSsh(
			sshTarget(box.hetzner_ipv4),
			bootstrapScript({ ...artifacts, type: "repair" })
		);
	}
});

// Move a running box to `runtimeImage`, keeping its files. The named volumes are
// untouched and the host is not rebuilt, so this is a container recreate: write
// the compose file naming the new image, pull it, bring the stack up, and hold
// until the editor answers.
//
// The image is passed in rather than read from the row on purpose. The caller
// only advances `box.runtime_image` after this returns, so if any step here
// throws, the row still names the image that last served and Repair - which
// renders from the row - rewrites the old compose file and puts the box back.
// That is the whole rollback mechanism; there is no separate one.
export const updateRuntime = internalAction({
	args: {
		boxId: v.id("boxes"),
		runtimeImage: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for update.");
		}
		const artifacts = runtimeArtifactsForBox(box, args.runtimeImage);

		await runSsh(
			sshTarget(box.hetzner_ipv4),
			bootstrapScript({ ...artifacts, type: "update" })
		);
	}
});

export const bootstrapRuntime = internalAction({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for SSH bootstrap.");
		}
		const artifacts = runtimeArtifactsForBox(box);

		await runSsh(sshTarget(box.hetzner_ipv4), bootstrapScript(artifacts));
	}
});

// Apply an owner's configuration: rewrite the env file with it, recreate the
// editor's container so the new environment is actually read, and hold until the
// editor answers.
//
// The container recreate is not optional. Every variable here is read from
// `process.env` when the editor process starts, so a saved configuration that
// did not restart the container would be a setting the interface reports as
// applied and the box does not have - the inert path this repo treats as worse
// than a failure.
//
// Only the `composery` service is recreated (`--no-deps`), so Caddy and its TLS
// state are left alone; the second `up -d` puts back anything that stopped.
// Like an update, the config is passed in rather than read from the row: the
// caller advances the row only after this returns, so a failed apply leaves the
// box - and every later Repair, which renders from the row - on the last
// configuration known to boot.
export const applyRuntimeConfig = internalAction({
	args: {
		boxId: v.id("boxes"),
		config: v.record(v.string(), v.string())
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for configuration.");
		}

		const env = renderComposeryEnv({
			cloudBoxId: box._id,
			cloudOrigin: websiteOrigin(),
			config: args.config,
			runtimeAuthHash: box.runtime_auth_hash,
			runtimeImage: box.runtime_image
		});

		await runSsh(
			sshTarget(box.hetzner_ipv4),
			`set -euo pipefail
${heredoc(COMPOSERY_ENV_PATH, "__COMPOSERY_ENV__", env)}
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} up -d --force-recreate --no-deps composery
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} up -d
${AWAIT_IDE}`
		);
	}
});

export const rewritePasswordAndRestart = internalAction({
	args: {
		boxId: v.id("boxes"),
		runtimeAuthHash: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for password change.");
		}

		const env = renderComposeryEnv({
			cloudBoxId: box._id,
			cloudOrigin: websiteOrigin(),
			config: box.runtime_config,
			runtimeAuthHash: args.runtimeAuthHash,
			runtimeImage: box.runtime_image
		});
		await runSsh(
			sshTarget(box.hetzner_ipv4),
			`set -euo pipefail
${heredoc(COMPOSERY_ENV_PATH, "__COMPOSERY_ENV__", env)}
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} up -d --force-recreate --no-deps composery
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} up -d
expected_hash="$(cat <<'__COMPOSERY_EXPECTED_HASH__'
${args.runtimeAuthHash}
__COMPOSERY_EXPECTED_HASH__
)"
attempt=1
while [ "$attempt" -le 30 ]; do
	actual_hash="$(docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} exec -T composery sh -lc 'systemctl is-active --quiet ide.service && pid="$(systemctl show --property=MainPID --value ide.service)" && test "\${pid:-0}" -gt 0 && tr "\\000" "\\n" < "/proc/$pid/environ" | sed -n "s/^COMPOSERY_HASHED_PASSWORD=//p"' 2>/dev/null || true)"
	if [ "$actual_hash" = "$expected_hash" ]; then
		exit 0
	fi
	sleep 1
	attempt=$((attempt + 1))
done
echo "composery container did not start with the expected COMPOSERY_HASHED_PASSWORD" >&2
exit 1
`
		);
	}
});

export const fetchRuntimeLogs = internalAction({
	args: {
		boxId: v.id("boxes"),
		tail: v.number()
	},
	handler: async (ctx, args): Promise<string> => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for log access.");
		}

		const tail = logTail(args.tail);
		const { stdout } = await runSsh(
			sshTarget(box.hetzner_ipv4),
			`docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} exec -T composery journalctl -u ide -u caddy -u persistence --no-pager --output=cat -n ${tail} || docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} logs --no-log-prefix --tail ${tail} caddy composery`
		);
		return stdout;
	}
});

export const reloadSlug = internalAction({
	args: {
		boxId: v.id("boxes"),
		newSlug: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for slug change.");
		}

		const caddyfile = renderCaddyfile(
			runtimeDomain(args.newSlug),
			runtimePort()
		);
		await runSsh(
			sshTarget(box.hetzner_ipv4),
			`set -euo pipefail
${heredoc(COMPOSERY_CADDYFILE_PATH, "__COMPOSERY_CADDY__", caddyfile)}
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} exec -T caddy caddy reload --config /etc/caddy/Caddyfile || docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} up -d caddy
`
		);
	}
});

// -- Repair (clean host, current files) -------------------------------------

function requireBoxHost(box: Doc<"boxes">) {
	if (!box.hetzner_ipv4) {
		throw new Error(
			"This box has no reachable host. A host with broken networking or SSH can only be recovered by Restore."
		);
	}
	return box.hetzner_ipv4;
}

// Repair's precondition: the host must answer over SSH. A host whose networking
// or sshd is broken cannot be reached by any of the repair steps, so we say so
// up front rather than failing five steps in - Restore is the tool for that box.
export const requireReachableHost = internalAction({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		try {
			await runSsh(sshTarget(host), "true", { timeoutMs: 30_000 });
		} catch (error) {
			throw new Error(
				`This box's host is not reachable over SSH, so it cannot be repaired. Restore it instead. (${error instanceof Error ? error.message : String(error)})`
			);
		}
	}
});

export const measureParkingUsage = internalAction({
	args: { boxId: v.id("boxes") },
	returns: v.object({ usedBytes: v.number() }),
	handler: async (ctx, args): Promise<{ usedBytes: number }> => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		const { stdout } = await runSsh(sshTarget(host), measureUsageScript(), {
			maxOutputBytes: 64 * 1024,
			timeoutMs: 5 * 60_000
		});
		const match = stdout.match(/used_bytes=(\d+)/);
		if (!match) {
			throw new Error("Could not measure the box's volume usage.");
		}
		return { usedBytes: Number(match[1]) };
	}
});

export const copyToParking = internalAction({
	args: { boxId: v.id("boxes"), volumeId: v.number() },
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		await runSsh(sshTarget(host), copyToParkingScript(args.volumeId), {
			timeoutMs: 60 * 60_000
		});
	}
});

// Copy the parked files back onto the rebuilt host. Writes the runtime files,
// materializes the empty volumes, and rsyncs the parked copy in - all before the
// stack is brought up, so nothing writes to a volume until its files are back.
export const copyFromParking = internalAction({
	args: { boxId: v.id("boxes"), volumeId: v.number() },
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		const artifacts = runtimeArtifactsForBox(box);
		await runSsh(
			sshTarget(host),
			copyFromParkingScript(artifacts, args.volumeId),
			{ timeoutMs: 60 * 60_000 }
		);
	}
});

async function verifyParking(
	ctx: ActionCtx,
	boxId: Doc<"boxes">["_id"],
	direction: "out" | "back",
	volumeId: number
) {
	const box = await ctx.runQuery(
		internal.boxes.queries.getBoxLifecycleSnapshot,
		{ boxId }
	);
	const host = requireBoxHost(box);
	const { stdout } = await runSsh(
		sshTarget(host),
		verifyParkingScript(direction, volumeId),
		{ maxOutputBytes: 4 * 1024 * 1024, timeoutMs: 60 * 60_000 }
	);
	const diffs = parseParkingVerification(stdout);
	if (diffs.length > 0) {
		const shown = diffs.slice(0, 50).join("\n");
		throw new Error(
			`Parking copy verification (${direction}) found ${diffs.length} difference(s); refusing to continue:\n${shown}`
		);
	}
}

export const verifyParkingCopy = internalAction({
	args: { boxId: v.id("boxes"), volumeId: v.number() },
	handler: async (ctx, args) => {
		await verifyParking(ctx, args.boxId, "out", args.volumeId);
	}
});

export const verifyParkingBack = internalAction({
	args: { boxId: v.id("boxes"), volumeId: v.number() },
	handler: async (ctx, args) => {
		await verifyParking(ctx, args.boxId, "back", args.volumeId);
	}
});

export const unmountParking = internalAction({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		await runSsh(sshTarget(host), unmountParkingScript(), {
			timeoutMs: 5 * 60_000
		});
	}
});
