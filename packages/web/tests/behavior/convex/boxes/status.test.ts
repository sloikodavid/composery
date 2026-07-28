import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import {
	boxEvents,
	readBox,
	readOperation,
	seedBox,
	seedUser,
	staffAlerts,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// How a box's operations end. The invariant every test here defends is that a
// finished operation is never left active: an active operation blocks every
// later action on its box, so a failure that fails to record itself is worse
// than the failure.

const NOW = Date.UTC(2026, 3, 4, 5, 6, 7);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

async function openOperation(
	t: Harness,
	boxId: Id<"boxes">,
	type: "reset" | "repair" | "snapshot" | "stop" | "update" = "reset"
) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_operations", {
				box_id: boxId,
				type,
				status: "pending",
				idempotency_key: `${type}:${boxId}`,
				trigger: "owner",
				workflow_id: "wf_1",
				created_at: NOW,
				updated_at: NOW
			})
	);
}

describe("recording an operation failure", () => {
	test("closes the operation with the error the caller reported", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "resetting"
		});
		const operationId = await openOperation(t, boxId);

		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "the host never answered",
			eventType: "box.reset_failed",
			operationId,
			targetBoxStatus: "reset_failed"
		});

		expect(await readOperation(t, operationId)).toMatchObject({
			status: "failed",
			last_error: "the host never answered",
			finished_at: NOW
		});
	});

	test("puts the box into the status that failure leaves it in", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "resetting"
		});
		const operationId = await openOperation(t, boxId);

		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "boom",
			eventType: "box.reset_failed",
			operationId,
			targetBoxStatus: "reset_failed"
		});

		expect(await readBox(t, boxId)).toMatchObject({ status: "reset_failed" });
	});

	// A snapshot never moved the box, so its failure has nothing to put back.
	test("leaves the box alone for a failure with no status to restore", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "running"
		});
		const operationId = await openOperation(t, boxId, "snapshot");

		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "hetzner said no",
			eventType: "box.snapshot_failed",
			operationId
		});

		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
		expect(await readOperation(t, operationId)).toMatchObject({
			status: "failed"
		});
	});

	test("writes the failure to the box's event log", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "repairing"
		});
		const operationId = await openOperation(t, boxId, "repair");

		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "ssh refused",
			eventType: "box.repair_failed",
			operationId,
			targetBoxStatus: "repair_failed"
		});

		expect(await boxEvents(t, boxId)).toMatchObject([
			{ type: "box.repair_failed", message: "ssh refused" }
		]);
	});

	// A box deleted while one of its operations was in flight used to leave that
	// operation active forever, because recording the failure threw on the missing
	// box before it got to the row. Closing the operation is the part that has to
	// happen regardless.
	test("still closes the operation when the box it belonged to is gone", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });
		const operationId = await openOperation(t, boxId);
		await t.run(async (ctx) => await ctx.db.delete(boxId));

		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "box vanished",
			eventType: "box.reset_failed",
			operationId,
			targetBoxStatus: "reset_failed"
		});

		expect(await readOperation(t, operationId)).toMatchObject({
			status: "failed",
			last_error: "box vanished"
		});
	});
});

describe("staff alerting on failure", () => {
	test("raises a critical alert for an operation that can leave a box broken", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "broken",
			status: "repairing"
		});
		const operationId = await openOperation(t, boxId, "repair");

		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "ssh refused",
			eventType: "box.repair_failed",
			operationId,
			targetBoxStatus: "repair_failed"
		});

		expect(await staffAlerts(t)).toMatchObject([
			{ severity: "critical", key: `box-operation-failed:${operationId}` }
		]);
	});

	test("raises only a warning for an operation whose failure changes nothing", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "stopping"
		});
		const operationId = await openOperation(t, boxId, "stop");

		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "transient",
			eventType: "box.stop_failed",
			operationId,
			targetBoxStatus: "running"
		});

		expect(await staffAlerts(t)).toMatchObject([{ severity: "warning" }]);
	});

	// The alert key is per operation, so one failure raises one alert however
	// many times the recorder runs - a retried mutation must not page staff twice.
	test("raises one alert however often the same failure is recorded", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });
		const operationId = await openOperation(t, boxId);

		for (let attempt = 0; attempt < 3; attempt += 1) {
			await t.mutation(internal.boxes.status.markOperationFailed, {
				boxId,
				error: "boom",
				eventType: "box.reset_failed",
				operationId,
				targetBoxStatus: "reset_failed"
			});
		}

		expect(await staffAlerts(t)).toHaveLength(1);
	});
});

describe("settling an operation", () => {
	test("closes an operation the workflow body left open", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });
		const operationId = await openOperation(t, boxId);

		await t.mutation(internal.boxes.status.settleOperation, { operationId });

		expect(await readOperation(t, operationId)).toMatchObject({
			status: "succeeded",
			finished_at: NOW
		});
	});

	// The safety net must never overwrite a real outcome. A failed operation that
	// got settled to "succeeded" would tell the owner their box is fine.
	test("leaves an operation that already failed as failed", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });
		const operationId = await openOperation(t, boxId);
		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "boom",
			eventType: "box.reset_failed",
			operationId,
			targetBoxStatus: "reset_failed"
		});

		await t.mutation(internal.boxes.status.settleOperation, { operationId });

		expect(await readOperation(t, operationId)).toMatchObject({
			status: "failed",
			last_error: "boom"
		});
	});
});

// The component's own terminal callback. It is the only thing that can see a
// workflow cancelled from outside, or one whose failure recording itself threw.
describe("the workflow completion callback", () => {
	test("fails an operation whose workflow was cancelled", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "resetting"
		});
		const operationId = await openOperation(t, boxId);

		await t.mutation(internal.boxes.status.finishBoxOperation, {
			workflowId: "wf_1" as never,
			result: { kind: "canceled" },
			context: { boxId, operationId }
		});

		expect(await readOperation(t, operationId)).toMatchObject({
			status: "failed",
			last_error: "The operation was cancelled before it finished."
		});
		expect(await readBox(t, boxId)).toMatchObject({ status: "reset_failed" });
	});

	// Every box workflow closes its own operation on the way out, so a "success"
	// that left one open means the closing step never committed - which means we
	// do not actually know what the box did. Recording success there would assert
	// something unverified.
	test("fails an operation a successful workflow left open", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "resetting"
		});
		const operationId = await openOperation(t, boxId);

		await t.mutation(internal.boxes.status.finishBoxOperation, {
			workflowId: "wf_1" as never,
			result: { kind: "success", returnValue: null },
			context: { boxId, operationId }
		});

		expect(await readOperation(t, operationId)).toMatchObject({
			status: "failed",
			last_error: "The operation stopped without recording an outcome."
		});
	});

	test("repeats the error the component reported for a failed workflow", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });
		const operationId = await openOperation(t, boxId);

		await t.mutation(internal.boxes.status.finishBoxOperation, {
			workflowId: "wf_1" as never,
			result: { kind: "failed", error: "out of retries" },
			context: { boxId, operationId }
		});

		expect(await readOperation(t, operationId)).toMatchObject({
			last_error: "out of retries"
		});
	});

	// The normal case: the body already recorded the outcome, so the callback has
	// nothing to do and must not overwrite it.
	test("does not touch an operation that already finished", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "running"
		});
		const operationId = await openOperation(t, boxId);
		await t.mutation(internal.boxes.status.settleOperation, { operationId });

		await t.mutation(internal.boxes.status.finishBoxOperation, {
			workflowId: "wf_1" as never,
			result: { kind: "failed", error: "late news" },
			context: { boxId, operationId }
		});

		const operation = await readOperation(t, operationId);
		expect(operation).toMatchObject({ status: "succeeded" });
		expect(operation?.last_error).toBeUndefined();
		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
	});
});
