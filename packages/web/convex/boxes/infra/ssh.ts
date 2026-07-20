"use node";

import ssh2 from "ssh2";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { requiredEnv, runtimeDomain, websiteOrigin } from "../../env";
import { vRecoveryStatus, type RecoveryStatus } from "../boxRecoveryTypes";
import {
	COMPOSERY_CADDYFILE_PATH,
	COMPOSERY_COMPOSE_PATH,
	COMPOSERY_ENV_PATH,
	renderComposeryEnv,
	renderCaddyfile,
	renderRuntimeArtifacts
} from "./runtimeArtifacts";
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

function bootstrapScript({
	caddyfile,
	compose,
	env
}: {
	caddyfile: string;
	compose: string;
	env: string;
}) {
	return `set -euo pipefail
install -d /opt/composery-web
${heredoc(COMPOSERY_COMPOSE_PATH, "__COMPOSERY_COMPOSE__", compose)}
${heredoc(COMPOSERY_ENV_PATH, "__COMPOSERY_ENV__", env)}
${heredoc(COMPOSERY_CADDYFILE_PATH, "__COMPOSERY_CADDY__", caddyfile)}
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} pull
docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} up -d
`;
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
								finish(
									new Error(
										stderr.trim() || `SSH command failed with exit ${code}.`
									)
								);
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
	const diskUsedPercent = Number(values.get("disk_used_percent"));
	return {
		hostReachable: true,
		httpReachable: false,
		diskUsedPercent: Number.isFinite(diskUsedPercent) ? diskUsedPercent : null,
		docker: componentState(values.get("docker")),
		outerCaddy: componentState(values.get("outer_caddy")),
		composery: componentState(values.get("composery")),
		persistence: componentState(values.get("persistence")),
		caddy: componentState(values.get("caddy")),
		ide: componentState(values.get("ide"))
	};
}

export const inspectRuntime = internalAction({
	args: { boxId: v.id("boxes") },
	returns: vRecoveryStatus,
	handler: async (ctx, args): Promise<RecoveryStatus> => {
		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_ipv4) {
			return {
				hostReachable: false,
				httpReachable: false,
				diskUsedPercent: null,
				docker: "unknown",
				outerCaddy: "unknown",
				composery: "unknown",
				persistence: "unknown",
				caddy: "unknown",
				ide: "unknown"
			};
		}

		try {
			const { stdout } = await runSsh(
				sshTarget(box.hetzner_ipv4),
				`set +e
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
`,
				{ maxOutputBytes: 64 * 1024, timeoutMs: 20_000 }
			);
			return parseRuntimeInspection(stdout);
		} catch {
			return {
				hostReachable: false,
				httpReachable: false,
				diskUsedPercent: null,
				docker: "unknown",
				outerCaddy: "unknown",
				composery: "unknown",
				persistence: "unknown",
				caddy: "unknown",
				ide: "unknown"
			};
		}
	}
});

export const recoverRuntime = internalAction({
	args: {
		boxId: v.id("boxes"),
		type: v.union(
			v.literal("restart_services"),
			v.literal("recreate_containers")
		)
	},
	handler: async (ctx, args): Promise<void> => {
		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_ipv4) throw new Error("Box has no server address.");

		const command =
			args.type === "restart_services"
				? `docker exec composery systemctl restart persistence.service caddy.service ide.service`
				: `docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} up -d --force-recreate`;
		await runSsh(sshTarget(box.hetzner_ipv4), command, {
			timeoutMs: 5 * 60_000
		});
	}
});

export const bootstrapRuntime = internalAction({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for SSH bootstrap.");
		}
		if (!box.runtime_image) {
			throw new Error("Box has no runtime image for SSH bootstrap.");
		}
		const artifacts = renderRuntimeArtifacts({
			cloudBoxId: box._id,
			cloudOrigin: websiteOrigin(),
			domain: runtimeDomain(box.slug),
			runtimeAuthHash: box.runtime_auth_hash,
			runtimeImage: box.runtime_image,
			runtimePort: runtimePort()
		});

		await runSsh(sshTarget(box.hetzner_ipv4), bootstrapScript(artifacts));
	}
});

export const rewritePasswordAndRestart = internalAction({
	args: {
		boxId: v.id("boxes"),
		runtimeAuthHash: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for password change.");
		}

		const env = renderComposeryEnv({
			cloudBoxId: box._id,
			cloudOrigin: websiteOrigin(),
			runtimeAuthHash: args.runtimeAuthHash
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
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
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
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
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
