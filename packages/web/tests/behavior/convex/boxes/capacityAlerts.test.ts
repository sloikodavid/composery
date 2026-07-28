import { describe, expect, test } from "vitest";
import { capacityAlertTransition } from "@/convex/boxes/capacityAlerts";

describe("capacityAlertTransition", () => {
	test("opens one incident when a configured allocation is exhausted", () => {
		expect(
			capacityAlertTransition(null, {
				blockReason: "server_limit",
				limitBlockReason: "server_limit"
			})
		).toEqual({ type: "blocked", reason: "server_limit" });
	});

	test("does not repeat an unchanged capacity incident", () => {
		expect(
			capacityAlertTransition("snapshot_limit", {
				blockReason: "manual_pause",
				limitBlockReason: "snapshot_limit"
			})
		).toEqual({ type: "none" });
	});

	test("reports recovery even while checkout remains manually paused", () => {
		expect(
			capacityAlertTransition("server_limit", {
				blockReason: "manual_pause",
				limitBlockReason: null
			})
		).toEqual({ type: "recovered", reason: "server_limit" });
	});

	test("clears the old episode without a false recovery when limits are removed", () => {
		expect(
			capacityAlertTransition("server_limit", {
				blockReason: "limits_not_configured",
				limitBlockReason: null
			})
		).toEqual({ type: "clear" });
	});
});
