import { describe, expect, it } from "vitest";
import { vBoxStatus, type BoxStatus } from "../schema";
import {
	OPERATION_ALLOWED_STATUSES,
	isActiveOperationStatus,
	isOperationAllowed
} from "./boxOperationRules";

// Derived from the schema so new statuses can't silently drift out of coverage.
const EVERY_STATUS: BoxStatus[] = vBoxStatus.members.map(
	(member) => member.value
);

describe("OPERATION_ALLOWED_STATUSES", () => {
	it("covers every operation type", () => {
		expect(Object.keys(OPERATION_ALLOWED_STATUSES).sort()).toEqual(
			[
				"provision",
				"delete",
				"reset",
				"stop",
				"start",
				"change_password",
				"change_slug",
				"suspend",
				"unsuspend",
				"restore",
				"snapshot"
			].sort()
		);
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
