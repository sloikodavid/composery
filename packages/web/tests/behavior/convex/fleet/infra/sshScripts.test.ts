import { describe, expect, test } from "vitest";
import { renderRuntimeArtifacts } from "@/convex/fleet/infra/runtimeArtifacts";
import {
	INSPECT_SCRIPT,
	applyRuntimeConfigScript,
	bootstrapScript,
	copyFromParkingScript,
	copyToParkingScript,
	measureUsageScript,
	parkingVolumeDevicePath,
	parseParkingVerification,
	parseRuntimeInspection,
	repairScript,
	reloadCaddyfileScript,
	rewritePasswordScript,
	runtimeLogsScript,
	updateScript,
	sshFailure,
	unmountParkingScript,
	verifyParkingScript
} from "@/convex/fleet/infra/sshScripts";

describe("ssh failures", () => {
	// What a failed repair actually leaves on stderr: compose progress, then the
	// one sentence the owner needs.
	test("reports the failure, not the progress that led to it", () => {
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

	test("falls back to the exit code when the script said nothing", () => {
		expect(sshFailure("", 137)).toBe("SSH command failed with exit 137.");
		expect(sshFailure("\n  \n", 2)).toBe("SSH command failed with exit 2.");
	});

	test("removes whitespace around the last error line", () => {
		expect(sshFailure("progress\n  failed here  \n", 1)).toBe("failed here");
	});
});

describe("runtime inspection", () => {
	test("parses known component states and ignores untrusted extra output", () => {
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

	test("returns unknown states when output is incomplete", () => {
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

	test("accepts padded output and both persistence engines", () => {
		expect(parseRuntimeInspection("  engine=overlay  \n").engine).toBe(
			"overlay"
		);
		expect(parseRuntimeInspection("engine=copy\n").engine).toBe("copy");
	});

	// `df` failing still prints the key, with nothing after it. Reading that as a
	// number gives 0, and the dialog would calmly show an empty disk for a box
	// whose disk we never measured.
	test("reports an unmeasurable disk as unknown, not as empty", () => {
		expect(parseRuntimeInspection("disk_used_percent=\n").diskUsedPercent).toBe(
			null
		);
		expect(
			parseRuntimeInspection("disk_used_percent=0\n").diskUsedPercent
		).toBe(0);
	});

	// The box owner is root on their own host, so this output is whatever that
	// host chose to print. Nothing out of range may be shown as a real reading.
	test("refuses disk readings a real filesystem could not produce", () => {
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
	test("prints a key for every field the Repair dialog reads", () => {
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
	const repair = repairScript(artifacts);
	const bootstrap = bootstrapScript(artifacts);
	const update = updateScript(artifacts);

	// Force-recreate is the entire difference between a repair and a no-op: a
	// wedged container whose config still matches is exactly what `up -d` skips.
	// An update always changes the compose file's image reference, so compose
	// recreates the service on its own; forcing it would only restart the
	// containers that did not change.
	test("force-recreates every container only when repairing", () => {
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
	test("waits for the editor to answer before calling a repair or update done", () => {
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
	test("requires the pull to succeed when updating, unlike repairing", () => {
		expect(update).toMatch(/ pull\n/);
		expect(update).not.toMatch(/ pull \|\| echo /);
		expect(repair).toMatch(/ pull \|\| echo /);
	});

	test("rewrites all three runtime files and re-pulls the image", () => {
		expect(repair).toContain("/opt/composery-web/compose.yaml");
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
	test("repairs with the local image when the pull fails, but never bootstraps", () => {
		expect(repair).toMatch(/ pull \|\| echo /);
		expect(bootstrap).not.toContain("||");
		expect(bootstrap).toMatch(/ pull\n/);
	});

	// Repair is offered as the safe option, and the box's files live in named
	// volumes. Nothing here may remove them.
	test("never removes the volumes holding the box's files", () => {
		expect(repair).not.toMatch(/\bdown\b/);
		expect(repair).not.toMatch(/\bvolume\s+rm\b/);
		expect(repair).not.toMatch(/\brm\s+-/);
		expect(repair).not.toMatch(/--volumes\b/);
	});

	// A file whose contents happen to contain the delimiter would end its
	// heredoc early and hand the remainder to the shell as root.
	test("keeps heredoc delimiters out of the contents it writes", () => {
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
	test("derives the volume set from the compose file, never a hardcoded list", () => {
		for (const script of everyScript) {
			expect(script).toContain(
				"docker compose -p composery -f /opt/composery-web/compose.yaml config --volumes"
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
	test("copies with the full-fidelity rsync flags in both directions", () => {
		expect(copyOut).toContain("rsync -aHAXS --numeric-ids --delete");
		expect(copyBack).toContain("rsync -aHAXS --numeric-ids --delete");
	});

	// The copy is only believed once an independent checksum pass proves it.
	test("verifies with a dry-run checksum compare that reports every difference", () => {
		for (const verify of [verifyOut, verifyBack]) {
			expect(verify).toContain("rsync -aHAXS --numeric-ids -ni -c --delete");
		}
	});

	test("verifies in the direction of whichever copy is authoritative", () => {
		// On the way out the box's volume is the source; on the way back the parked
		// copy is. A swapped direction would verify the wrong tree.
		expect(verifyOut).toContain('"$mp/" "/mnt/composery-parking/$key/"');
		expect(verifyBack).toContain('"/mnt/composery-parking/$key/" "$mp/"');
	});

	// The box is wiped for the whole repair, so a moving copy is pointless and
	// dangerous - stop the stack so the volumes are quiescent.
	test("stops the stack before copying it out", () => {
		expect(copyOut).toContain(
			"docker compose -p composery -f /opt/composery-web/compose.yaml stop"
		);
	});

	// The parked copy is the only copy once the server is gone. Nothing on the
	// restore path may reformat the volume or remove a volume's contents.
	test("never reformats the volume or destroys data on the way back", () => {
		expect(copyBack).not.toContain("mkfs");
		expect(copyBack).not.toMatch(/\bvolume\s+rm\b/);
		expect(copyBack).not.toMatch(/\brm\s+-/);
		// It materializes the empty volumes without starting anything, then copies.
		expect(copyBack).toContain(
			"docker compose -p composery -f /opt/composery-web/compose.yaml create"
		);
		expect(copyBack).toContain(
			"docker compose -p composery -f /opt/composery-web/compose.yaml pull"
		);
		// And it lays the runtime files down first (needs the compose file present).
		expect(copyBack).toContain(artifacts.compose);
	});

	test("sizes from real used bytes", () => {
		expect(measure).toContain("du -sb");
		expect(measure).toContain("used_bytes=");
	});

	test("treats any itemized verification line as a difference, empty as clean", () => {
		expect(parseParkingVerification("")).toEqual([]);
		expect(parseParkingVerification("\n  \n")).toEqual([]);
		expect(
			parseParkingVerification(
				"composery_data: >f+++++++++ foo\ncaddy_data: cL+++ bar\n"
			)
		).toEqual(["composery_data: >f+++++++++ foo", "caddy_data: cL+++ bar"]);
		expect(parseParkingVerification("changed  \n")).toEqual(["changed"]);
	});
});

describe("the parking volume's device path", () => {
	// The stable by-id path is what lets the mount script find the attached
	// volume without guessing a /dev/sd* letter that can shift between boots.
	test("locates a volume deterministically from its id", () => {
		expect(parkingVolumeDevicePath(1234)).toBe(
			"/dev/disk/by-id/scsi-0HC_Volume_1234"
		);
	});

	test("is the path the mount script actually waits for", () => {
		expect(copyToParkingScript(1234)).toContain(parkingVolumeDevicePath(1234));
	});
});

// The three scripts that rewrite what a running box is started with. Each was
// written inline inside the action that sent it, where the only way to check the
// shell was to read it - and a template literal is a bad place to keep shell,
// because the two languages disagree about backslashes and `$`.
describe("rewriting a running box", () => {
	test("applies a configuration and waits for the editor to come back", () => {
		const script = applyRuntimeConfigScript("COMPOSERY_DISABLE_API=1");
		const leadingNewline = applyRuntimeConfigScript("\nA=1");

		expect(script).toContain("set -euo pipefail");
		// The env file is written through a quoted heredoc, so nothing in an
		// owner's value is expanded by the shell on the way in.
		expect(script).toContain("<<'__COMPOSERY_ENV__'");
		expect(script).toContain("COMPOSERY_DISABLE_API=1");
		expect(script).toContain("COMPOSERY_DISABLE_API=1\n__COMPOSERY_ENV__");
		expect(leadingNewline).toContain("\nA=1\n__COMPOSERY_ENV__");
		expect(script).toContain("--force-recreate --no-deps composery");
		// Recreating is not the same as serving: a configuration that stops the
		// box booting has to fail the operation, not report a clean apply.
		expect(script).toContain("systemctl is-active --quiet ide.service");
		expect(script.trimEnd().endsWith("exit 1")).toBe(true);
	});

	// An argon2 hash is full of `$`, and the check compares it against what the
	// running editor was actually started with. Both halves are escaping the
	// template literal could silently eat.
	test("proves the container came back on the new password hash", () => {
		const hash = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA";
		const script = rewritePasswordScript("A=1", hash);

		// The hash rides in through a quoted heredoc rather than the command line.
		expect(script).toContain("<<'__COMPOSERY_EXPECTED_HASH__'");
		expect(script).toContain(`
${hash}`);
		expect(script).toContain('if [ "$actual_hash" = "$expected_hash" ]');
		// `tr` gets its own escapes, not the shell's: the environ file is
		// NUL-separated, so these have to reach `tr` as backslash-000 and
		// backslash-n. A single backslash here would send a literal NUL byte and
		// a real newline, and the read would silently return nothing - which
		// reads as "the password did not take" on every change.
		expect(script).toContain(String.raw`tr "\000" "\n"`);
		expect(script).toContain('test "${pid:-0}" -gt 0');
		expect(script).toContain("COMPOSERY_HASHED_PASSWORD=");
	});

	test("reloads a new Caddyfile in place, or brings Caddy up if it is down", () => {
		const script = reloadCaddyfileScript("example.test { }");

		expect(script).toContain("<<'__COMPOSERY_CADDY__'");
		expect(script).toContain("example.test { }");
		expect(script).toContain("caddy reload --config /etc/caddy/Caddyfile");
		expect(script).toContain("|| docker compose");
		expect(script).toContain("up -d caddy");
	});
});

describe("releasing a parking volume", () => {
	// A settled copy is unmounted before the volume is detached and deleted, and
	// the step can be retried - a repair that resumes must not fail because the
	// volume is already unmounted.
	test("unmounts only what is mounted", () => {
		const script = unmountParkingScript();

		expect(script).toContain("mountpoint -q");
		expect(script).toContain("umount");
		expect(script).toContain("set -euo pipefail");
	});
});

describe("reading a box's logs", () => {
	test("asks the container's journal first and compose's capture second", () => {
		const script = runtimeLogsScript(200);

		expect(script).toContain("journalctl -u ide -u caddy -u persistence");
		expect(script).toContain("-n 200");
		expect(script).toContain("--tail 200");
		expect(script).toContain("||");
	});
});
