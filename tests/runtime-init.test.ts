import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

function readRepoFile(path: string): string {
	return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("runtime process managers", () => {
	test("names the IDE service after the process it runs", () => {
		const ideServicePath = resolve(
			repoRoot,
			"rootfs/usr/lib/systemd/system/ide.service"
		);
		const oldServicePath = resolve(
			repoRoot,
			"rootfs/etc/systemd/system/composery.service"
		);
		const ideService = readFileSync(ideServicePath, "utf8");
		const persistenceService = readRepoFile(
			"rootfs/usr/lib/systemd/system/persistence.service"
		);
		const dockerfile = readRepoFile("Dockerfile");

		expect(existsSync(ideServicePath)).toBe(true);
		expect(existsSync(oldServicePath)).toBe(false);
		expect(ideService).toContain("Description=Composery IDE");
		expect(ideService).toContain("ExecStart=/opt/composery/ide.sh");
		expect(persistenceService).toContain("Before=ide.service");
		expect(dockerfile).toContain(
			"/usr/lib/systemd/system/ide.service /etc/systemd/system/multi-user.target.wants/ide.service"
		);
		expect(dockerfile).not.toContain("composery.service");
	});

	test("provides the standard local supervisorctl interface", () => {
		const config = readRepoFile("rootfs/etc/supervisor/supervisord.conf");

		expect(config).toContain("[unix_http_server]");
		expect(config).toContain("file=/run/supervisor.sock");
		expect(config).toContain("[rpcinterface:supervisor]");
		expect(config).toContain("[supervisorctl]");
		expect(config).toContain("serverurl=unix:///run/supervisor.sock");
	});

	test("keeps the outer Caddy version identical across hosted and self-hosted recipes", () => {
		const image =
			"caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648";

		for (const path of [
			"Dockerfile",
			"packages/web/convex/boxes/infra/runtimeArtifacts.ts",
			"templates/systemd-caddy-compose/compose.yml",
			"templates/supervisor-caddy-compose/compose.yml"
		]) {
			expect(readRepoFile(path), path).toContain(image);
		}
	});

	test("runs the standard user-owned Caddyfile in both runtime profiles", () => {
		const caddyfile = readRepoFile("rootfs/etc/caddy/Caddyfile");
		const ide = readRepoFile("rootfs/opt/composery/ide.sh");
		const systemd = readRepoFile("rootfs/usr/lib/systemd/system/caddy.service");
		const supervisor = readRepoFile(
			"rootfs/etc/supervisor/conf.d/composery.conf"
		);

		expect(ide).toContain("127.0.0.1:${COMPOSERY_IDE_PORT:-8081}");
		expect(ide).toContain("unset PORT COMPOSERY_HOST");
		expect(caddyfile).toContain("handle /_composery*");
		expect(caddyfile).not.toContain("import ");
		expect(systemd).toContain(
			"ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile"
		);
		expect(systemd).toContain(
			"ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile"
		);
		expect(supervisor).toContain("[program:caddy]");
		expect(supervisor).toContain(
			"command=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile"
		);
	});

	test("reserves only the permanent Composery control namespace", () => {
		const apiPath = readRepoFile(
			"packages/ide/overlay/src/node/routes/api/constants.ts"
		);
		const apiPatch = readRepoFile("packages/ide/patches/api.diff");
		const readinessPatch = readRepoFile("packages/ide/patches/readiness.diff");
		const probe = readRepoFile("packages/mobile/src/lib/probe.ts");

		expect(apiPath).toContain('"/_composery/api/v1"');
		expect(apiPatch).toContain('app.router.get("/_composery"');
		expect(readinessPatch).toContain(
			'app.router.use("/_composery/healthz", health.router)'
		);
		expect(probe).toContain('endpointUrl(instanceUrl, "/_composery")');
		expect(apiPath).not.toContain('"/v1"');
		expect(apiPatch).not.toContain('+  app.router.get("/__composery"');
		expect(readinessPatch).not.toContain('+  app.router.use("/healthz"');
	});

	test("uses Host instead of client-controlled forwarded host headers", () => {
		const hardeningPatch = readRepoFile("packages/ide/patches/hardening.diff");

		expect(hardeningPatch).toContain(
			'+  const [host] = splitOnFirstEquals(getFirstHeader(req, "host") || "")'
		);
		expect(hardeningPatch).toContain(
			'-  const forwardedRaw = getFirstHeader(req, "forwarded")'
		);
		expect(hardeningPatch).toContain(
			'-  const xHost = getFirstHeader(req, "x-forwarded-host")'
		);
	});

	test("makes the direct durable volume an ordinary user disk", () => {
		const entrypoint = readRepoFile("rootfs/opt/composery/entrypoint.sh");

		expect(entrypoint).toContain(
			'volume_root="${COMPOSERY_DOCKER_VOLUME_PATH:-/data}"'
		);
		expect(entrypoint).toContain('chown user:user "$volume_root"');
		expect(entrypoint).toContain(
			'install -d -m 0700 -o user -g user "$volume_root/api"'
		);
	});

	test("bridges cloud identity and the managed password into the IDE service", () => {
		const entrypoint = readRepoFile("rootfs/opt/composery/entrypoint.sh");
		const service = readRepoFile("rootfs/usr/lib/systemd/system/ide.service");

		expect(entrypoint).toContain("HASHED_PASSWORD");
		expect(entrypoint).toContain("^COMPOSERY_");
		expect(entrypoint).toContain("umask 077");
		expect(service).toContain("EnvironmentFile=-/run/composery.env");
	});
});
