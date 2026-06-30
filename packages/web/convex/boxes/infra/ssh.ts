"use node";

import ssh2 from "ssh2";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { requiredEnv, runtimeDomain } from "../../env";
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

export async function runSsh(target: SshTarget, command: string) {
	return await new Promise<{ stderr: string; stdout: string }>(
		(resolve, reject) => {
			const client = new Client();
			let done = false;

			function finish(
				error?: Error,
				output?: { stderr: string; stdout: string }
			) {
				if (done) return;
				done = true;
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
							stdout += chunk.toString("utf8");
						});
						stream.stderr.on("data", (chunk: Buffer) => {
							stderr += chunk.toString("utf8");
						});
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

		const artifacts = renderRuntimeArtifacts({
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

		const env = renderComposeryEnv(args.runtimeAuthHash);
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
	actual_hash="$(docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} exec -T composery sh -lc 'systemctl is-active --quiet composery.service && pid="$(systemctl show --property=MainPID --value composery.service)" && test "\${pid:-0}" -gt 0 && tr "\\000" "\\n" < "/proc/$pid/environ" | sed -n "s/^HASHED_PASSWORD=//p"' 2>/dev/null || true)"
	if [ "$actual_hash" = "$expected_hash" ]; then
		exit 0
	fi
	sleep 1
	attempt=$((attempt + 1))
done
echo "composery container did not start with the expected HASHED_PASSWORD" >&2
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
			`docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} exec -T composery journalctl -u composery -u persistence --no-pager --output=cat -n ${tail} || docker compose -p composery -f ${COMPOSERY_COMPOSE_PATH} logs --no-log-prefix --tail ${tail} composery`
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
