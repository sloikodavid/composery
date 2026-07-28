import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { readRepoFile, repoRoot } from "../support/repo.ts";

// A shell script with its comment lines removed, for assertions about what a
// script *does* and in what order. These scripts explain themselves at length,
// so matching the raw text lets a comment satisfy a requirement the code never
// implements, and lets a step named in the comment above a command appear to
// run before it. Both happened here.
function readShellCode(path: string): string {
	return readRepoFile(path)
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("#"))
		.join("\n");
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
		expect(caddyfile).toContain("handle_path /ide/*");
		expect(caddyfile).toContain("handle /_composery/healthz*");
		expect(caddyfile).toContain("handle /_composery/api/v1/*");
		expect(caddyfile).toContain("@outside_ide path /ide/proxy");
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
		expect(probe).toContain('new URL("/_composery", instanceUrl)');
		expect(apiPath).not.toContain('"/v1"');
		expect(apiPatch).not.toContain('+  app.router.get("/__composery"');
		expect(readinessPatch).not.toContain('+  app.router.use("/healthz"');
	});

	test("uses Host instead of client-controlled forwarded host headers", () => {
		const hostPatch = readRepoFile(
			"packages/ide/patches/request-host-trust.diff"
		);

		expect(hostPatch).toContain(
			'+  const [host] = splitOnFirstEquals(getFirstHeader(req, "host") || "")'
		);
		expect(hostPatch).toContain(
			'-  const forwardedRaw = getFirstHeader(req, "forwarded")'
		);
		expect(hostPatch).toContain(
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

		// Order matters: putting the delta back first would restore the password.
		// remove-password runs in the shared finalize tail, which the copy path
		// reaches only after `persistence apply` and the overlay path only after
		// the kernel has mounted the delta (the post-pivot re-exec into finalize),
		// so it always runs once the delta is live for either engine.
		expect(entrypoint).toContain("/opt/composery/remove-password.sh");
		expect(
			entrypoint.indexOf("/opt/composery/remove-password.sh")
		).toBeLessThan(entrypoint.indexOf("persistence select-engine"));
		expect(entrypoint.indexOf("composery persistence apply")).toBeLessThan(
			entrypoint.lastIndexOf("finalize")
		);
		expect(entrypoint).toContain(
			'if [ "${PORT:-8080}" = "${COMPOSERY_IDE_PORT:-8081}" ]'
		);
		// The config path has to track paths.config, which rebrand.mjs now sets:
		// the patch stack renames nothing, so the rule is the only home for it.
		expect(readRepoFile("packages/ide/scripts/rebrand.mjs")).toContain(
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

	test("selects the persistence engine before applying, mirroring COMPOSERY_INIT", () => {
		const entrypoint = readShellCode("rootfs/opt/composery/entrypoint.sh");

		// Same auto|overlay|copy plus exit-64-on-unknown contract COMPOSERY_INIT uses.
		expect(entrypoint).toContain('case "${COMPOSERY_PERSISTENCE:-auto}" in');
		expect(entrypoint).toContain("auto | overlay | copy) ;;");
		expect(entrypoint).toMatch(
			/Unsupported COMPOSERY_PERSISTENCE[\s\S]*?exit 64/
		);

		// The choice is recorded for `persistence status`, and the copy engine
		// still applies the delta - selection runs first.
		expect(entrypoint).toContain("persistence select-engine");
		expect(entrypoint.indexOf("persistence select-engine")).toBeLessThan(
			entrypoint.indexOf("persistence apply")
		);

		// The overlay engine is finished: its branch hands off to init/overlay.sh
		// (build the overlay, pivot, finalize) rather than failing loudly.
		expect(entrypoint).toMatch(
			/"\$engine" = overlay[\s\S]*?exec \/opt\/composery\/init\/overlay\.sh/
		);
		expect(entrypoint).not.toMatch(/"\$engine" = overlay[\s\S]*?exit 1/);
	});

	test("the overlay engine boot follows the spike's proven order", () => {
		const overlay = readShellCode("rootfs/opt/composery/init/overlay.sh");
		const entrypoint = readShellCode("rootfs/opt/composery/entrypoint.sh");

		// Hygiene (recreate work/, reconcile stale whiteouts / opaque dirs) runs
		// before the mount and sources the reserved upper/work paths from Rust
		// rather than a second hardcoded copy.
		expect(overlay).toContain("persistence overlay-hygiene");
		expect(overlay.indexOf("persistence overlay-hygiene")).toBeLessThan(
			overlay.indexOf("mount -t overlay")
		);
		// Private propagation before any move (spike: pivot_root refuses a shared /).
		expect(overlay.indexOf("mount --make-rprivate /")).toBeLessThan(
			overlay.indexOf("pivot_root")
		);
		// Kernel filesystems, the volume, AND the resolver files (Hazard D: no DNS
		// in the pivoted root without them).
		expect(overlay).toContain("mount --rbind /proc");
		for (const file of ["/etc/resolv.conf", "/etc/hosts", "/etc/hostname"]) {
			expect(overlay).toContain(file);
		}
		// /opt/composery and /opt/persistence bound so image code cannot become a
		// user delta under overlay (the structural integrity exclusion).
		expect(overlay).toContain("for d in /opt/composery /opt/persistence");
		// Pivot, then re-enter the shared finalize tail through the entrypoint.
		expect(overlay).toContain("pivot_root . mnt/oldroot");
		expect(overlay.indexOf("pivot_root")).toBeLessThan(
			overlay.indexOf("COMPOSERY_OVERLAY_STAGE=finalize")
		);
		expect(overlay).toContain("exec /opt/composery/entrypoint.sh");
		expect(entrypoint).toMatch(
			/COMPOSERY_OVERLAY_STAGE:-\}" = finalize[\s\S]*?finalize/
		);
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

	// The cloud configuration surface is a third copy of these names, after the
	// docs and the code that reads them. A key offered there but not wired is a
	// switch an owner flips that does nothing at all - the same inert-path failure
	// the test above exists to catch, one layer further out. The managed and
	// infrastructure variables are checked from the other direction: offering any
	// of them would let a saved configuration take a box off its own password or
	// detach it from the control plane.
	test("only offers box configuration for variables that are documented and wired", () => {
		// Read rather than imported. This suite lives in the root TypeScript
		// project, which resolves modules differently from packages/web's, so
		// importing a Convex source file here fights the two configurations for no
		// benefit - and every other assertion in this file already reads its
		// evidence off disk.
		const RUNTIME_CONFIG_KEYS = [
			...readRepoFile("packages/web/convex/boxes/runtimeConfig.ts").matchAll(
				/^\t\tkey: "([A-Z_]+)"/gm
			)
		].map((match) => match[1] as string);
		const documented = new Set(
			[
				...readRepoFile("docs/configuration.md").matchAll(
					/`(COMPOSERY_[A-Z_]+)`/g
				)
			].flatMap((match) => match[1] ?? [])
		);
		const wired = envNamesUnder([
			"Dockerfile",
			"packages/cli/crates",
			"packages/ide/overlay/src",
			"packages/ide/patches",
			"packages/ide/scripts",
			"rootfs",
			"scripts"
		]);

		const offered = RUNTIME_CONFIG_KEYS.filter((key: string) =>
			key.startsWith("COMPOSERY_")
		);
		expect(offered.length).toBeGreaterThan(10);
		expect(offered.filter((key: string) => !documented.has(key))).toEqual([]);
		expect(offered.filter((key: string) => !wired.has(key))).toEqual([]);

		// Variables the website owns, or that the rendered compose file and
		// Caddyfile are written against. None may be owner-configurable.
		for (const managed of [
			"COMPOSERY_HASHED_PASSWORD",
			"COMPOSERY_PASSWORD",
			"COMPOSERY_REMOVE_PASSWORD",
			"COMPOSERY_CLOUD_BOX_ID",
			"COMPOSERY_CLOUD_ORIGIN",
			// Written by the website so a box knows which digest it was started as.
			// An owner who could set it would make their box report a version it is
			// not running.
			"COMPOSERY_RUNTIME_IMAGE",
			"COMPOSERY_INIT",
			"COMPOSERY_IDE_PORT",
			"COMPOSERY_DOCKER_VOLUME_PATH",
			"COMPOSERY_PERSISTENCE",
			"COMPOSERY_CONFIG"
		]) {
			expect(RUNTIME_CONFIG_KEYS).not.toContain(managed);
		}
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
