import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

function readRepoFile(path: string): string {
	return readFileSync(resolve(repoRoot, path), "utf8");
}

const BINARY = new Set([".ico", ".png", ".sqlite", ".svg", ".webm", ".woff2"]);

// Every COMPOSERY_* name mentioned anywhere under the given repo paths.
function envNamesUnder(paths: string[]): Set<string> {
	const names = new Set<string>();
	const visit = (path: string): void => {
		if (statSync(path).isDirectory()) {
			for (const entry of readdirSync(path).sort()) visit(join(path, entry));
			return;
		}
		if (BINARY.has(extname(path))) return;
		for (const match of readFileSync(path, "utf8").matchAll(
			/COMPOSERY_[A-Z_]+/g
		))
			names.add(match[0]);
	};
	for (const path of paths) visit(resolve(repoRoot, path));
	return names;
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
		// Devices, not mountpoints: a volume root inside a mount is still durable.
		expect(entrypoint).toContain(
			'if [ "$(stat -c %d "$volume_root")" = "$(stat -c %d /)" ]; then'
		);
	});

	test("removes the registered password on every boot, after persistence", () => {
		const entrypoint = readRepoFile("rootfs/opt/composery/entrypoint.sh");
		const removal = readRepoFile("rootfs/opt/composery/remove-password.sh");

		// Order matters: applying the delta first would restore the password.
		expect(
			entrypoint.indexOf("/opt/composery/remove-password.sh")
		).toBeGreaterThan(entrypoint.indexOf("composery persistence apply"));
		expect(entrypoint).toContain(
			'if [ "${PORT:-8080}" = "${COMPOSERY_IDE_PORT:-8081}" ]'
		);
		// The config path has to track paths.config in patches/naming.diff.
		expect(readRepoFile("packages/ide/patches/naming.diff")).toContain(
			'envPaths("composery", { suffix: "" })'
		);
		expect(removal).toContain(
			'config_path="${COMPOSERY_CONFIG:-/home/user/.config/composery/config.yaml}"'
		);
		expect(removal).toContain('chown user:user "$config_path"');
		// Only 1/true may enable a switch that unprotects the instance, so an
		// unrecognised value keeps the password rather than removing it.
		expect(removal).toContain("1 | true) ;;");
		expect(removal).toContain("*) exit 0 ;;");
		// Trim the edges only. Deleting all whitespace turns "t rue" into the
		// destructive value "true" and violates fail-towards-protected parsing.
		expect(removal).toContain('${removal#"${removal%%[![:space:]]*}"}');
		expect(removal).toContain('${removal%"${removal##*[![:space:]]}"}');
		expect(removal).not.toContain("//[[:space:]]/");
		expect(removal).not.toContain("password-removed");
	});

	test("wires every environment variable the docs promise", () => {
		// COMPOSERY_DISABLE_FILE_UPLOADS was documented for a release with no env
		// var behind it: upstream left --disable-file-uploads CLI-only, and
		// Composery passes no CLI flags. Documented but inert is the worst case -
		// the operator believes uploads are blocked - so pin docs to real wiring.
		const documented = [
			...readRepoFile("docs/configuration.md").matchAll(
				/`(COMPOSERY_[A-Z_]+)`/g
			)
		].flatMap((match) => match[1] ?? []);
		const wired = envNamesUnder([
			"Dockerfile",
			"packages/cli/crates",
			"packages/ide/overlay/src",
			"packages/ide/patches",
			"packages/ide/scripts",
			"rootfs",
			"scripts"
		]);

		expect(documented.length).toBeGreaterThan(20);
		expect(documented.filter((name) => !wired.has(name))).toEqual([]);
	});

	test("bridges cloud identity and the managed password into the IDE service", () => {
		const entrypoint = readRepoFile("rootfs/opt/composery/entrypoint.sh");
		const service = readRepoFile("rootfs/usr/lib/systemd/system/ide.service");

		// The bare name is a trap: "HASHED_PASSWORD" also matches inside
		// "COMPOSERY_HASHED_PASSWORD", so asserting it cannot tell the two apart.
		// The IDE reads the prefixed name (rebrand.mjs rewrites cli.ts), so
		// ^COMPOSERY_ already carries it and the cloud env file must use it too.
		expect(entrypoint).toContain("^COMPOSERY_");
		expect(entrypoint).not.toMatch(/\|HASHED_PASSWORD\|/);
		expect(entrypoint).toContain("umask 077");
		expect(service).toContain("EnvironmentFile=-/run/composery.env");
		expect(
			readRepoFile("packages/web/convex/boxes/infra/runtimeArtifacts.ts")
		).toContain("`COMPOSERY_HASHED_PASSWORD=${quoteEnvFileValue");
		expect(readRepoFile("packages/ide/scripts/rebrand.mjs")).toContain(
			'"process.env.COMPOSERY_HASHED_PASSWORD"'
		);
	});
});
