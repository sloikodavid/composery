import { describe, expect, it } from "vitest";
import { renderRuntimeArtifacts } from "./runtimeArtifacts";
import { INSPECT_SCRIPT, bootstrapScript, parseRuntimeInspection } from "./ssh";

describe("runtime inspection", () => {
	it("parses known component states and ignores untrusted extra output", () => {
		expect(
			parseRuntimeInspection(`banner from host
docker=active
outer_caddy=inactive
composery=active
disk_used_percent=91
persistence=active
caddy=missing
ide=unexpected
arbitrary=value
`)
		).toEqual({
			hostReachable: true,
			httpReachable: false,
			diskUsedPercent: 91,
			engine: "unknown",
			docker: "active",
			outerCaddy: "inactive",
			composery: "active",
			persistence: "active",
			caddy: "missing",
			ide: "unknown"
		});
	});

	it("returns unknown states when output is incomplete", () => {
		expect(parseRuntimeInspection("")).toEqual({
			hostReachable: true,
			httpReachable: false,
			diskUsedPercent: null,
			engine: "unknown",
			docker: "unknown",
			outerCaddy: "unknown",
			composery: "unknown",
			persistence: "unknown",
			caddy: "unknown",
			ide: "unknown"
		});
	});

	// `df` failing still prints the key, with nothing after it. Reading that as a
	// number gives 0, and the dialog would calmly show an empty disk for a box
	// whose disk we never measured.
	it("reports an unmeasurable disk as unknown, not as empty", () => {
		expect(parseRuntimeInspection("disk_used_percent=\n").diskUsedPercent).toBe(
			null
		);
		expect(
			parseRuntimeInspection("disk_used_percent=0\n").diskUsedPercent
		).toBe(0);
	});

	// The box owner is root on their own host, so this output is whatever that
	// host chose to print. Nothing out of range may be shown as a real reading.
	it("refuses disk readings a real filesystem could not produce", () => {
		for (const raw of ["-5", "101", "1e999", "nonsense", "0x10"]) {
			expect(
				parseRuntimeInspection(`disk_used_percent=${raw}\n`).diskUsedPercent
			).toBe(null);
		}
		expect(
			parseRuntimeInspection("disk_used_percent=100\n").diskUsedPercent
		).toBe(100);
	});

	// Every key printed by the script, read back out of the script itself:
	// literal `echo key=` / `printf 'key=%s`, plus the loop that prints one line
	// per service it iterates.
	function emittedKeys(script: string) {
		const literal = [...script.matchAll(/(?:echo |printf ')([a-z_]+)=/g)].map(
			(match) => match[1]
		);
		const loop = script.match(/for service in ([a-z ]+); do/);
		return [...new Set([...literal, ...(loop?.[1].trim().split(/\s+/) ?? [])])];
	}

	// The parser is only as good as the script feeding it. Renaming a key on
	// either side leaves its field permanently "unknown", which looks like a
	// quiet box rather than a broken check - so pin the two together.
	it("prints a key for every field the Repair dialog reads", () => {
		const keys = emittedKeys(INSPECT_SCRIPT);
		expect(keys).toHaveLength(8);

		const stdout = keys
			.map((key) => {
				if (key === "disk_used_percent") return `${key}=42`;
				if (key === "engine") return `${key}=copy`;
				return `${key}=active`;
			})
			.join("\n");

		expect(parseRuntimeInspection(stdout)).toEqual({
			hostReachable: true,
			httpReachable: false,
			diskUsedPercent: 42,
			engine: "copy",
			docker: "active",
			outerCaddy: "active",
			composery: "active",
			persistence: "active",
			caddy: "active",
			ide: "active"
		});
	});
});

describe("runtime bootstrap and repair scripts", () => {
	const artifacts = renderRuntimeArtifacts({
		cloudBoxId: "box_123",
		cloudOrigin: "https://www.composery.io",
		domain: "my-box.composery.cloud",
		runtimeAuthHash: "$argon2id$v=19$m=1,t=1,p=1$salt$hash",
		runtimeImage: "ghcr.io/sloikodavid/composery@sha256:abc",
		runtimePort: 8080
	});
	const repair = bootstrapScript({ ...artifacts, repair: true });
	const bootstrap = bootstrapScript(artifacts);

	// Force-recreate is the entire difference between a repair and a no-op: a
	// wedged container whose config still matches is exactly what `up -d` skips.
	it("force-recreates every container only when repairing", () => {
		expect(repair).toContain("up -d --force-recreate");
		expect(bootstrap).toContain("up -d\n");
		expect(bootstrap).not.toContain("--force-recreate");
	});

	// The promise the owner is shown is "your box is fixed". `up -d` returning
	// only means the container was created, so a repair that stops there would
	// report success over a crash-looping editor.
	it("waits for the editor to answer before calling a repair done", () => {
		expect(repair).toContain("systemctl is-active --quiet ide.service");
		expect(repair).toContain("exit 1");
		expect(repair.trimEnd().endsWith("exit 1")).toBe(true);
		expect(bootstrap).not.toContain("ide.service");
	});

	it("rewrites all three runtime files and re-pulls the image", () => {
		expect(repair).toContain("/opt/composery-web/compose.yml");
		expect(repair).toContain("/opt/composery-web/composery.env");
		expect(repair).toContain("/opt/composery-web/Caddyfile");
		expect(repair).toContain(artifacts.compose);
		expect(repair).toContain(artifacts.env);
		expect(repair).toContain(artifacts.caddyfile);
		expect(repair).toContain("compose -p composery -f");
		expect(repair).toContain(" pull ");
		expect(repair).toContain("set -euo pipefail");
	});

	// Repair exists to get a broken box serving again. Under `set -e` a pruned
	// digest or an unreachable registry would abort the script before anything
	// restarted, leaving the box as broken as it was - the "repair does nothing"
	// report. Bootstrap keeps failing there, because a first boot with no image
	// has nothing to fall back to.
	it("repairs with the local image when the pull fails, but never bootstraps", () => {
		expect(repair).toMatch(/ pull \|\| echo /);
		expect(bootstrap).not.toContain("||");
		expect(bootstrap).toMatch(/ pull\n/);
	});

	// Repair is offered as the safe option, and the box's files live in named
	// volumes. Nothing here may remove them.
	it("never removes the volumes holding the box's files", () => {
		expect(repair).not.toMatch(/\bdown\b/);
		expect(repair).not.toMatch(/\bvolume\s+rm\b/);
		expect(repair).not.toMatch(/\brm\s+-/);
		expect(repair).not.toMatch(/--volumes\b/);
	});

	// A file whose contents happen to contain the delimiter would end its
	// heredoc early and hand the remainder to the shell as root.
	it("keeps heredoc delimiters out of the contents it writes", () => {
		for (const delimiter of [
			"__COMPOSERY_COMPOSE__",
			"__COMPOSERY_ENV__",
			"__COMPOSERY_CADDY__"
		]) {
			expect(repair.split(delimiter)).toHaveLength(3);
		}
	});
});
