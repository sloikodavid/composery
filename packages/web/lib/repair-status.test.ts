import { describe, expect, it } from "vitest";
import type { RecoveryStatus } from "@/convex/boxes/recoveryTypes";
import { buildChecks, diskState, summarize } from "./repair-status";

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
	return summarize(status, buildChecks(status));
}

describe("repair status", () => {
	it("shows every layer of the box", () => {
		expect(buildChecks(HEALTHY).map((check) => check.label)).toEqual([
			"Website",
			"Server",
			"Docker",
			"Reverse proxy",
			"Runtime container",
			"Editor",
			"Web server",
			"Persistence",
			"Disk",
			"Persistence engine"
		]);
	});

	it("calls a fully healthy box healthy", () => {
		expect(summaryOf(HEALTHY)).toEqual({
			label: "Everything looks healthy",
			tone: "ok"
		});
	});

	it("counts stopped and missing services as issues", () => {
		expect(summaryOf({ ...HEALTHY, ide: "inactive" })).toEqual({
			label: "1 issue found",
			tone: "warn"
		});
		expect(
			summaryOf({ ...HEALTHY, ide: "missing", caddy: "inactive" })
		).toEqual({ label: "2 issues found", tone: "warn" });
	});

	it("leads with unreachability, since nothing below it can be trusted", () => {
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
	it("never reports healthy when checks could not be read", () => {
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
	it("tones the disk by how full it is, muted only when unmeasured", () => {
		expect(diskState(null)).toEqual({ label: "Unknown", tone: "muted" });
		expect(diskState(0)).toEqual({ label: "0% used", tone: "ok" });
		expect(diskState(74)).toEqual({ label: "74% used", tone: "ok" });
		expect(diskState(75)).toEqual({ label: "75% used", tone: "warn" });
		expect(diskState(90)).toEqual({ label: "90% used", tone: "bad" });
	});
});
