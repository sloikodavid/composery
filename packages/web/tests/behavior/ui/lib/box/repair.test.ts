import { describe, expect, test } from "vitest";
import type { RecoveryStatus } from "@/convex/model/box/recovery";
import { buildChecks, diskState, summarize } from "@/ui/lib/box/repair";

const HEALTHY: RecoveryStatus = {
	hostReachable: true,
	httpReachable: true,
	diskUsedPercent: 12,
	engine: "copy",
	docker: "active",
	outerCaddy: "active",
	composery: "active",
	persistence: "active",
	caddy: "active",
	ide: "active"
};

function summaryOf(status: RecoveryStatus) {
	return summarize(status);
}

describe("repair status", () => {
	test("shows every layer of the box", () => {
		expect(buildChecks(HEALTHY)).toEqual([
			{
				label: "Website",
				description: "Reachable at its public URL.",
				state: { label: "Online", tone: "ok" }
			},
			{
				label: "Server",
				description: "The host it runs on.",
				state: { label: "Reachable", tone: "ok" }
			},
			{
				label: "Docker",
				description: "Container engine.",
				state: { label: "Running", tone: "ok" }
			},
			{
				label: "Reverse proxy",
				description: "Terminates HTTPS at the edge.",
				state: { label: "Running", tone: "ok" }
			},
			{
				label: "Runtime container",
				description: "Everything runs in here.",
				state: { label: "Running", tone: "ok" }
			},
			{
				label: "Editor",
				description: "The editor and terminal.",
				state: { label: "Running", tone: "ok" }
			},
			{
				label: "Web server",
				description: "Serves the editor.",
				state: { label: "Running", tone: "ok" }
			},
			{
				label: "Persistence",
				description: "Saves your files.",
				state: { label: "Running", tone: "ok" }
			},
			{
				label: "Disk",
				description: "Space in use.",
				state: { label: "12% used", tone: "ok" }
			},
			{
				label: "Persistence engine",
				description: "How your changes are saved.",
				state: { label: "Copy", tone: "ok" }
			}
		]);
	});

	test("maps unavailable layers and the overlay engine to their exact states", () => {
		expect(buildChecks(HEALTHY).at(-1)?.state).toEqual({
			label: "Copy",
			tone: "ok"
		});

		const checks = buildChecks({
			...HEALTHY,
			hostReachable: false,
			httpReachable: false,
			docker: "inactive",
			outerCaddy: "missing",
			composery: "unknown",
			engine: "overlay"
		});

		expect(checks.slice(0, 5).map((check) => check.state)).toEqual([
			{ label: "Not responding", tone: "bad" },
			{ label: "Unreachable", tone: "bad" },
			{ label: "Stopped", tone: "warn" },
			{ label: "Missing", tone: "bad" },
			{ label: "Unknown", tone: "muted" }
		]);
		expect(checks.at(-1)?.state).toEqual({ label: "Overlay", tone: "ok" });
		expect(
			buildChecks({ ...HEALTHY, engine: "unknown" }).at(-1)?.state
		).toEqual({ label: "Unknown", tone: "muted" });
	});

	test("calls a fully healthy box healthy", () => {
		expect(summaryOf(HEALTHY)).toEqual({
			label: "Everything looks healthy",
			tone: "ok"
		});
	});

	test("counts stopped and missing services as issues", () => {
		expect(summaryOf({ ...HEALTHY, ide: "inactive" })).toEqual({
			label: "1 issue found",
			tone: "warn"
		});
		expect(
			summaryOf({ ...HEALTHY, ide: "missing", caddy: "inactive" })
		).toEqual({ label: "2 issues found", tone: "warn" });
	});

	test("leads with unreachability, since nothing below it can be trusted", () => {
		expect(
			summaryOf({
				...HEALTHY,
				hostReachable: false,
				httpReachable: false,
				docker: "unknown"
			})
		).toEqual({ label: "The box is unreachable", tone: "bad" });
	});

	// The case that has to stay honest: SSH connects, so the host looks fine,
	// but the probe comes back empty and every service is "unknown". Counting
	// only bad/warn tones would call that "Everything looks healthy" - a green
	// dialog for a box the owner opened precisely because it is broken.
	test("never reports healthy when checks could not be read", () => {
		expect(
			summaryOf({
				hostReachable: true,
				httpReachable: true,
				diskUsedPercent: null,
				engine: "unknown",
				docker: "unknown",
				outerCaddy: "unknown",
				composery: "unknown",
				persistence: "unknown",
				caddy: "unknown",
				ide: "unknown"
			})
		).toEqual({ label: "Some checks could not be read", tone: "warn" });

		expect(summaryOf({ ...HEALTHY, ide: "unknown" })).toEqual({
			label: "Some checks could not be read",
			tone: "warn"
		});
	});

	// `muted` has to mean "unknown" and nothing else, or the check above cannot
	// tell an unread disk from a roomy one.
	test("tones the disk by how full it is, muted only when unmeasured", () => {
		expect(diskState(null)).toEqual({ label: "Unknown", tone: "muted" });
		expect(diskState(0)).toEqual({ label: "0% used", tone: "ok" });
		expect(diskState(74)).toEqual({ label: "74% used", tone: "ok" });
		expect(diskState(75)).toEqual({ label: "75% used", tone: "warn" });
		expect(diskState(90)).toEqual({ label: "90% used", tone: "bad" });
	});
});
