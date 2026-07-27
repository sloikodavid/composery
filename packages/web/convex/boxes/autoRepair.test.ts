import { describe, expect, it } from "vitest";
import { isSystemTrigger, type OperationTrigger } from "../schema";
import {
	AUTO_REPAIR_TRIGGER,
	AUTO_REPAIR_WINDOW_MS,
	MAX_AUTO_REPAIRS_PER_WINDOW,
	OWNER_QUIET_WINDOW_MS,
	SUSTAINED_FAILURES,
	SWEPT_STATUSES,
	autoRepairDecision,
	type AutoRepairFacts
} from "./autoRepair";
import { OPERATION_ALLOWED_STATUSES } from "./operationRules";

const NOW = 10_000_000_000;

function facts(over: Partial<AutoRepairFacts> = {}): AutoRepairFacts {
	return {
		consecutiveFailures: SUSTAINED_FAILURES,
		lastOwnerOperationAt: null,
		recentAutoRepairs: [],
		status: "running",
		...over
	};
}

describe("autoRepairDecision", () => {
	it("repairs a box that has been down for the sustained window", () => {
		expect(autoRepairDecision(facts(), NOW)).toEqual({ repair: true });
	});

	it("does nothing for a box that is answering", () => {
		expect(autoRepairDecision(facts({ consecutiveFailures: 0 }), NOW)).toEqual({
			repair: false,
			reason: "healthy"
		});
	});

	// A box restarting, booting slowly, or briefly unreachable is not a box that
	// needs its host rebuilt. The threshold is what separates the two.
	it("waits for the failure to be sustained", () => {
		expect(
			autoRepairDecision(
				facts({ consecutiveFailures: SUSTAINED_FAILURES - 1 }),
				NOW
			)
		).toEqual({ repair: false, reason: "not_sustained" });
	});

	// The owner is root on this box and is expected to break it. Someone who
	// pressed a button minutes ago is working on it, and healing under them would
	// undo what they are doing.
	it("stays out of the way after an owner-initiated operation", () => {
		expect(
			autoRepairDecision(
				facts({ lastOwnerOperationAt: NOW - OWNER_QUIET_WINDOW_MS + 1 }),
				NOW
			)
		).toEqual({ repair: false, reason: "owner_recently_acted" });

		expect(
			autoRepairDecision(
				facts({ lastOwnerOperationAt: NOW - OWNER_QUIET_WINDOW_MS }),
				NOW
			)
		).toEqual({ repair: true });
	});

	// Each repair creates and deletes a Hetzner Volume and takes the box down, so
	// an unbounded healer is an unbounded bill and an unbounded outage. Past the
	// cap it is a person's problem, not the fleet's.
	it("stops after the attempt limit within the window", () => {
		const attempts = Array.from(
			{ length: MAX_AUTO_REPAIRS_PER_WINDOW },
			(_unused, index) => NOW - index * 1000
		);

		expect(
			autoRepairDecision(facts({ recentAutoRepairs: attempts }), NOW)
		).toEqual({ repair: false, reason: "attempt_limit_reached" });
	});

	it("counts only the attempts inside the window", () => {
		const expired = Array.from(
			{ length: MAX_AUTO_REPAIRS_PER_WINDOW },
			() => NOW - AUTO_REPAIR_WINDOW_MS
		);

		expect(
			autoRepairDecision(facts({ recentAutoRepairs: expired }), NOW)
		).toEqual({ repair: true });
	});

	// Asks the same table the backend enforces. A stopped or suspended box has no
	// host answering over SSH, and a box mid-operation must never have a repair
	// queued behind it.
	it("never repairs a box whose status does not allow it", () => {
		for (const status of [
			"stopped",
			"suspended",
			"repairing",
			"updating",
			"create_failed",
			"deleting",
			"deleted"
		] as const) {
			expect(autoRepairDecision(facts({ status }), NOW)).toEqual({
				repair: false,
				reason: "status_not_repairable"
			});
		}
	});

	// A failed update leaves the box on its old image in the row, so repairing it
	// rolls the update back. That makes it exactly the state automatic repair
	// should act on - and the reason the update workflow must not advance the row
	// before the box answers.
	it("repairs a box left broken by a failed update", () => {
		expect(autoRepairDecision(facts({ status: "update_failed" }), NOW)).toEqual(
			{
				repair: true
			}
		);
	});
});

// The gate matrix above is pure and was always tested. What was not tested is
// whether the sweep ever hands it a box in one of those states, and for a long
// time it did not: it only ever listed `status == "running"`, so the
// `update_failed` case above was unreachable in production while its test passed.
// A decision that cannot be reached is worse than a missing one, because the test
// suite reports it as covered.
describe("the sweep feeds every status the decision can act on", () => {
	it("probes exactly the statuses a repair may begin from", () => {
		expect([...SWEPT_STATUSES].sort()).toEqual(
			[...OPERATION_ALLOWED_STATUSES.repair].sort()
		);
	});

	it.each(OPERATION_ALLOWED_STATUSES.repair)(
		"sweeps %s, which the decision can approve",
		(status) => {
			expect(SWEPT_STATUSES).toContain(status);
			expect(autoRepairDecision(facts({ status }), NOW)).toEqual({
				repair: true
			});
		}
	);
});

// The quiet window means "a person is working on this box". It used to mean "any
// operation ran", which the fleet's own housekeeping satisfied: a nightly
// automatic snapshot suppressed repair for two hours every night, and a forced
// floor update suppressed it for two hours after the event most likely to have
// broken the box.
describe("trigger classification", () => {
	const humanTriggers: OperationTrigger[] = ["owner", "staff"];
	const systemTriggers: OperationTrigger[] = [
		"system:auto_repair",
		"system:runtime_floor",
		"system:auto_snapshot",
		"system:abuse_suspension",
		"system:subscription_revoked",
		"system:account_deletion"
	];

	it.each(humanTriggers)("%s counts as a person acting", (trigger) => {
		expect(isSystemTrigger(trigger)).toBe(false);
	});

	it.each(systemTriggers)("%s does not hold repair off", (trigger) => {
		expect(isSystemTrigger(trigger)).toBe(true);
	});

	// An operation recorded before the column existed. Reading it as a person's
	// keeps repair off a box someone may have been working on, which is the safe
	// direction for a value we cannot know.
	it("treats an unrecorded trigger as a person", () => {
		expect(isSystemTrigger(undefined)).toBe(false);
	});

	it("counts its own repairs against the attempt limit", () => {
		expect(isSystemTrigger(AUTO_REPAIR_TRIGGER)).toBe(true);
	});
});
