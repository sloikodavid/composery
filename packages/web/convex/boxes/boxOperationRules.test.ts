import { describe, expect, it } from "vitest";
import {
	vBoxOperationType,
	vBoxStatus,
	type BoxOperationType,
	type BoxStatus
} from "../schema";
import {
	OPERATION_ALLOWED_STATUSES,
	isActiveOperationStatus,
	isOperationAllowed
} from "./boxOperationRules";

// Both derived from the schema so a new status or operation type cannot silently
// drift out of coverage. Restating either list here would mean a new operation
// gets an empty allowlist and is simply never permitted, with every test still
// green.
const EVERY_STATUS: BoxStatus[] = vBoxStatus.members.map(
	(member) => member.value
);
const EVERY_OPERATION: BoxOperationType[] = vBoxOperationType.members.map(
	(member) => member.value
);

describe("OPERATION_ALLOWED_STATUSES", () => {
	it("covers every operation type", () => {
		expect(Object.keys(OPERATION_ALLOWED_STATUSES).sort()).toEqual(
			[...EVERY_OPERATION].sort()
		);
	});

	it("gives every operation at least one status it can start from", () => {
		for (const type of EVERY_OPERATION) {
			expect(OPERATION_ALLOWED_STATUSES[type].length).toBeGreaterThan(0);
		}
	});

	it("never references an unknown box status", () => {
		const known = new Set<string>(EVERY_STATUS);
		for (const allowed of Object.values(OPERATION_ALLOWED_STATUSES)) {
			for (const status of allowed) {
				expect(known.has(status)).toBe(true);
			}
		}
	});

	it("never allows operating on an already-deleted box", () => {
		for (const type of Object.keys(OPERATION_ALLOWED_STATUSES) as Array<
			keyof typeof OPERATION_ALLOWED_STATUSES
		>) {
			expect(isOperationAllowed("deleted", type)).toBe(false);
			expect(isOperationAllowed("deleting", type)).toBe(false);
		}
	});
});

describe("isOperationAllowed (state-machine transitions)", () => {
	it("starts a running box only from stopped", () => {
		expect(isOperationAllowed("stopped", "start")).toBe(true);
		expect(isOperationAllowed("running", "start")).toBe(false);
		expect(isOperationAllowed("suspended", "start")).toBe(false);
	});

	it("stops a running box only while running", () => {
		expect(isOperationAllowed("running", "stop")).toBe(true);
		expect(isOperationAllowed("stopped", "stop")).toBe(false);
		expect(isOperationAllowed("suspended", "stop")).toBe(false);
	});

	it("suspends from running or stopped, unsuspends only from suspended", () => {
		expect(isOperationAllowed("running", "suspend")).toBe(true);
		expect(isOperationAllowed("stopped", "suspend")).toBe(true);
		expect(isOperationAllowed("suspended", "suspend")).toBe(false);
		expect(isOperationAllowed("suspended", "unsuspend")).toBe(true);
		expect(isOperationAllowed("running", "unsuspend")).toBe(false);
	});

	it("resets from running or reset_failed", () => {
		expect(isOperationAllowed("running", "reset")).toBe(true);
		expect(isOperationAllowed("reset_failed", "reset")).toBe(true);
		expect(isOperationAllowed("stopped", "reset")).toBe(false);
	});

	it("snapshots and restores only a running box", () => {
		expect(isOperationAllowed("running", "snapshot")).toBe(true);
		expect(isOperationAllowed("stopped", "snapshot")).toBe(false);
		expect(isOperationAllowed("running", "restore")).toBe(true);
		expect(isOperationAllowed("suspended", "restore")).toBe(false);
	});

	it("retries provisioning from provisioning or provisioning_failed", () => {
		expect(isOperationAllowed("provisioning", "provision")).toBe(true);
		expect(isOperationAllowed("provisioning_failed", "provision")).toBe(true);
		expect(isOperationAllowed("running", "provision")).toBe(false);
	});

	// Repair needs a running box with real files and a reachable host, and must
	// be retryable from its own failed state so a crashed repair can resume from
	// its parking volume. A box that never provisioned has no files worth keeping,
	// so it is excluded; a powered-off box (stopped, suspended) has no host to
	// reach over SSH, which is every repair step.
	it("repairs a usable box or retries a failed repair, but not empty or off boxes", () => {
		expect(isOperationAllowed("running", "repair")).toBe(true);
		expect(isOperationAllowed("repair_failed", "repair")).toBe(true);
		expect(isOperationAllowed("reset_failed", "repair")).toBe(true);
		expect(isOperationAllowed("restore_failed", "repair")).toBe(true);
		expect(isOperationAllowed("provisioning_failed", "repair")).toBe(false);
		expect(isOperationAllowed("stopped", "repair")).toBe(false);
		expect(isOperationAllowed("suspended", "repair")).toBe(false);
		expect(isOperationAllowed("repairing", "repair")).toBe(false);
	});

	it("allows deleting a box that is mid-repair or repair_failed", () => {
		expect(isOperationAllowed("repairing", "delete")).toBe(true);
		expect(isOperationAllowed("repair_failed", "delete")).toBe(true);
	});

	// Update recreates the container on a new image, so it needs a live host to
	// reach over SSH, exactly like Repair. Retrying from its own failed state
	// covers the transient case (registry unreachable, pull timed out).
	it("updates a running box or retries a failed update, but not an off box", () => {
		expect(isOperationAllowed("running", "update")).toBe(true);
		expect(isOperationAllowed("update_failed", "update")).toBe(true);
		expect(isOperationAllowed("stopped", "update")).toBe(false);
		expect(isOperationAllowed("suspended", "update")).toBe(false);
		expect(isOperationAllowed("updating", "update")).toBe(false);
		expect(isOperationAllowed("provisioning_failed", "update")).toBe(false);
	});

	// The rollback path. A box broken by an update is recovered by repairing it:
	// Repair renders the compose file from `box.runtime_image`, which an update
	// only advances after the new image has answered, so repairing a failed
	// update reinstates the last image known to serve. If this ever returns
	// false, a failed update has no recovery that keeps the box's files.
	it("repairs a box left broken by a failed update", () => {
		expect(isOperationAllowed("update_failed", "repair")).toBe(true);
	});

	it("allows deleting from every live state except deleting/deleted", () => {
		for (const status of EVERY_STATUS) {
			const allowed = isOperationAllowed(status, "delete");
			if (status === "deleting" || status === "deleted") {
				expect(allowed).toBe(false);
			} else {
				expect(allowed).toBe(true);
			}
		}
	});
});

describe("isActiveOperationStatus", () => {
	it("treats pending and running as active, the rest as settled", () => {
		expect(isActiveOperationStatus("pending")).toBe(true);
		expect(isActiveOperationStatus("running")).toBe(true);
		expect(isActiveOperationStatus("succeeded")).toBe(false);
		expect(isActiveOperationStatus("failed")).toBe(false);
	});
});
