import { describe, expect, it } from "vitest";
import { renderRuntimeArtifacts } from "./runtimeArtifacts";
import {
	INSPECT_SCRIPT,
	bootstrapScript,
	copyFromParkingScript,
	copyToParkingScript,
	measureUsageScript,
	parseParkingVerification,
	parseRuntimeInspection,
	sshFailure,
	verifyParkingScript
} from "./ssh";

describe("ssh failures", () => {
	// What a failed repair actually leaves on stderr: compose progress, then the
	// one sentence the owner needs.
	it("reports the failure, not the progress that led to it", () => {
		expect(
			sshFailure(
				`caddy Pulling
composery Pulling
Container composery Started
The runtime came up but its editor never started.
`,
				1
			)
		).toBe("The runtime came up but its editor never started.");
	});

	it("falls back to the exit code when the script said nothing", () => {
		expect(sshFailure("", 137)).toBe("SSH command failed with exit 137.");
		expect(sshFailure("\n  \n", 2)).toBe("SSH command failed with exit 2.");
	});
});

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
	const repair = bootstrapScript({ ...artifacts, type: "repair" });
	const bootstrap = bootstrapScript(artifacts);
	const update = bootstrapScript({ ...artifacts, type: "update" });

	// Force-recreate is the entire difference between a repair and a no-op: a
	// wedged container whose config still matches is exactly what `up -d` skips.
	// An update always changes the compose file's image reference, so compose
	// recreates the service on its own; forcing it would only restart the
	// containers that did not change.
	it("force-recreates every container only when repairing", () => {
		expect(repair).toContain("up -d --force-recreate");
		expect(bootstrap).toContain("up -d\n");
		expect(bootstrap).not.toContain("--force-recreate");
		expect(update).not.toContain("--force-recreate");
	});

	// The promise the owner is shown is "your box is fixed". `up -d` returning
	// only means the container was created, so a repair that stops there would
	// report success over a crash-looping editor. An update makes the same
	// promise about a box that was working before it started, so it waits too -
	// and that wait is what lets a failed update leave the row on the last image
	// known to serve.
	it("waits for the editor to answer before calling a repair or update done", () => {
		for (const script of [repair, update]) {
			expect(script).toContain("systemctl is-active --quiet ide.service");
			expect(script).toContain("exit 1");
			expect(script.trimEnd().endsWith("exit 1")).toBe(true);
		}
		expect(bootstrap).not.toContain("ide.service");
	});

	// An update exists to move the box to a new image. If that image cannot be
	// pulled there is nothing to update to, and a tolerant pull would restart the
	// box on the image it already had - which then reports success and lets the
	// caller advance the row to a digest the host never ran. Repair's tolerance
	// is right for repair and wrong here.
	it("requires the pull to succeed when updating, unlike repairing", () => {
		expect(update).toMatch(/ pull\n/);
		expect(update).not.toMatch(/ pull \|\| echo /);
		expect(repair).toMatch(/ pull \|\| echo /);
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

describe("repair parking scripts", () => {
	const artifacts = renderRuntimeArtifacts({
		cloudBoxId: "box_123",
		cloudOrigin: "https://www.composery.io",
		domain: "my-box.composery.cloud",
		runtimeAuthHash: "$argon2id$v=19$m=1,t=1,p=1$salt$hash",
		runtimeImage: "ghcr.io/sloikodavid/composery@sha256:abc",
		runtimePort: 8080
	});
	const volumeId = 4242;
	const copyOut = copyToParkingScript(volumeId);
	const copyBack = copyFromParkingScript(artifacts, volumeId);
	const verifyOut = verifyParkingScript("out", volumeId);
	const verifyBack = verifyParkingScript("back", volumeId);
	const measure = measureUsageScript();

	const everyScript = [copyOut, copyBack, verifyOut, verifyBack, measure];

	// The whole point of deriving the set: a volume added to renderCompose later
	// is copied automatically. A hardcoded list would silently stop covering it.
	it("derives the volume set from the compose file, never a hardcoded list", () => {
		for (const script of everyScript) {
			expect(script).toContain(
				"docker compose -p composery -f /opt/composery-web/compose.yml config --volumes"
			);
		}
		// The copy logic must not name any volume itself. copyBack legitimately
		// embeds the whole compose file (which declares the names), so it is checked
		// separately - every other script has no business mentioning a volume name.
		for (const script of [copyOut, verifyOut, verifyBack, measure]) {
			for (const name of ["composery_data", "caddy_data", "caddy_config"]) {
				expect(script).not.toContain(name);
			}
		}
	});

	// The persistence delta stores xattrs, ACLs, file caps, hardlinks, whiteout
	// devices, and sparse files. Only these flags preserve them; cp -a would not.
	it("copies with the full-fidelity rsync flags in both directions", () => {
		expect(copyOut).toContain("rsync -aHAXS --numeric-ids --delete");
		expect(copyBack).toContain("rsync -aHAXS --numeric-ids --delete");
	});

	// The copy is only believed once an independent checksum pass proves it.
	it("verifies with a dry-run checksum compare that reports every difference", () => {
		for (const verify of [verifyOut, verifyBack]) {
			expect(verify).toContain("rsync -aHAXS --numeric-ids -ni -c --delete");
		}
	});

	it("verifies in the direction of whichever copy is authoritative", () => {
		// On the way out the box's volume is the source; on the way back the parked
		// copy is. A swapped direction would verify the wrong tree.
		expect(verifyOut).toContain('"$mp/" "/mnt/composery-parking/$key/"');
		expect(verifyBack).toContain('"/mnt/composery-parking/$key/" "$mp/"');
	});

	// The box is wiped for the whole repair, so a moving copy is pointless and
	// dangerous - stop the stack so the volumes are quiescent.
	it("stops the stack before copying it out", () => {
		expect(copyOut).toContain(
			"docker compose -p composery -f /opt/composery-web/compose.yml stop"
		);
	});

	// The parked copy is the only copy once the server is gone. Nothing on the
	// restore path may reformat the volume or remove a volume's contents.
	it("never reformats the volume or destroys data on the way back", () => {
		expect(copyBack).not.toContain("mkfs");
		expect(copyBack).not.toMatch(/\bvolume\s+rm\b/);
		expect(copyBack).not.toMatch(/\brm\s+-/);
		// It materializes the empty volumes without starting anything, then copies.
		expect(copyBack).toContain(
			"docker compose -p composery -f /opt/composery-web/compose.yml create"
		);
		expect(copyBack).toContain(
			"docker compose -p composery -f /opt/composery-web/compose.yml pull"
		);
		// And it lays the runtime files down first (needs the compose file present).
		expect(copyBack).toContain(artifacts.compose);
	});

	it("sizes from real used bytes", () => {
		expect(measure).toContain("du -sb");
		expect(measure).toContain("used_bytes=");
	});

	it("treats any itemized verification line as a difference, empty as clean", () => {
		expect(parseParkingVerification("")).toEqual([]);
		expect(parseParkingVerification("\n  \n")).toEqual([]);
		expect(
			parseParkingVerification(
				"composery_data: >f+++++++++ foo\ncaddy_data: cL+++ bar\n"
			)
		).toEqual(["composery_data: >f+++++++++ foo", "caddy_data: cL+++ bar"]);
	});
});
