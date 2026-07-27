import { describe, expect, it } from "vitest";
import { BOX_STATUSES, type BoxOperationType, type BoxStatus } from "../schema";
import {
	boxEventType,
	OPERATION_ALLOWED_STATUSES,
	OPERATION_FAILURE_STATUS
} from "./operationRules";
import { operationLiveness } from "./operationSweep";

// "An operation is in flight." Spelled out rather than derived from a name
// pattern: `running` ends the same way and is the healthiest state a box has.
const TRANSIENT_STATUSES: BoxStatus[] = [
	"creating",
	"stopping",
	"starting",
	"resetting",
	"repairing",
	"updating",
	"restoring",
	"suspending",
	"unsuspending",
	"deleting"
];

describe("operationLiveness", () => {
	// The reason this exists at all. An operation whose workflow was never
	// recorded has nothing that will ever close it, and an active operation blocks
	// every later action on its box - so leaving it open makes the box unusable
	// permanently rather than temporarily.
	it("treats an operation with no workflow as orphaned", () => {
		expect(
			operationLiveness({ workflowId: undefined, workflowStatus: null })
		).toMatchObject({ orphaned: true });
	});

	it("treats a workflow the component has lost as orphaned", () => {
		expect(
			operationLiveness({ workflowId: "wf_1", workflowStatus: null })
		).toMatchObject({ orphaned: true });
	});

	it.each(["completed", "failed", "canceled"])(
		"treats a %s workflow with a still-open operation as orphaned",
		(type) => {
			expect(
				operationLiveness({ workflowId: "wf_1", workflowStatus: { type } })
			).toMatchObject({ orphaned: true });
		}
	);

	// The case that must never be closed on a timer. A repair copies a whole disk
	// twice and legitimately runs for hours; failing it while it works would race
	// the workflow for the box's status and could strand the box's files.
	it("leaves a workflow that is still running alone, however long it has run", () => {
		expect(
			operationLiveness({
				workflowId: "wf_1",
				workflowStatus: { type: "inProgress" }
			})
		).toEqual({ orphaned: false });
	});

	it("always explains why it closed an operation", () => {
		for (const status of [null, { type: "failed" }, { type: "canceled" }]) {
			const result = operationLiveness({
				workflowId: "wf_1",
				workflowStatus: status
			});
			expect(result.orphaned).toBe(true);
			if (result.orphaned) expect(result.error.length).toBeGreaterThan(0);
		}
	});
});

// The sweep puts a rescued box into the status `OPERATION_FAILURE_STATUS` names,
// so that table has to answer for every operation type - and has to name a status
// that actually exists.
describe("OPERATION_FAILURE_STATUS", () => {
	const types = Object.keys(OPERATION_FAILURE_STATUS) as BoxOperationType[];

	it("covers every operation type", () => {
		expect(types.length).toBeGreaterThanOrEqual(14);
	});

	it.each(types)("%s names a real box status", (type) => {
		const status = OPERATION_FAILURE_STATUS[type];
		if (status !== undefined) expect(BOX_STATUSES).toContain(status);
	});

	// The event grammar is a function now, so the only thing left to check is that
	// it agrees with the operation type it was derived from.
	it.each(types)("%s derives its failure event from its own name", (type) => {
		expect(boxEventType(type, "failed")).toBe(`box.${type}_failed`);
	});

	// A failure has to leave the box somewhere it can be acted on again, or the
	// rescue puts it in a state nothing can move it out of. Delete is the one that
	// must always work: a box that cannot be removed keeps billing and keeps
	// holding a Hetzner server.
	it.each(types)("%s leaves the box in a status delete can act on", (type) => {
		const status = OPERATION_FAILURE_STATUS[type];
		if (status === undefined) return;
		expect(OPERATION_ALLOWED_STATUSES.delete).toContain(status);
	});

	// A failure must never park the box in a status that means "an operation is in
	// flight" - the operation is precisely what has just stopped, so the box would
	// look busy with nothing running and refuse every action.
	it.each(types)("%s does not leave the box looking busy", (type) => {
		const status = OPERATION_FAILURE_STATUS[type];
		if (status === undefined) return;
		expect(TRANSIENT_STATUSES).not.toContain(status);
	});
});
