import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { BoxOperationType } from "@/convex/schema";

import {
	boxOperations,
	readBox,
	readOperation,
	seedBox,
	seedUser,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// `startOperation` is the only door into a box's lifecycle, and it is the lock
// that keeps two of them off the same box. Everything here runs the real
// mutation against the real workflow component, so the workflow id it records is
// one the component actually issued.
//
// The clock is frozen for the whole file. `startOperation` really does hand a
// workflow to the workpool, and a live timer would let that workflow run its
// steps - and rewrite the box status - between the mutation returning and the
// assertion reading. Freezing time is what makes "the row immediately after the
// call" a defined thing rather than a race.
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

const boxFor = seedBox;

async function start(
	t: Harness,
	boxId: Id<"boxes">,
	type: BoxOperationType,
	options: { idempotencyKey?: string; reservedSlug?: string } = {}
) {
	return await t.mutation(internal.boxes.operations.startOperation, {
		boxId,
		idempotencyKey: options.idempotencyKey ?? `${type}:${boxId}`,
		reservedSlug: options.reservedSlug,
		trigger: "owner",
		type
	});
}

describe("starting a box operation", () => {
	test("moves the box into the status its operation runs in", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, {
			user_id: owner.clerkUserId,
			status: "running"
		});

		await start(t, boxId, "stop");

		expect(await readBox(t, boxId)).toMatchObject({
			status: "stopping",
			updated_at: NOW
		});
	});

	// A snapshot runs beside a running box. Moving it to a transient status would
	// make the box look busy to its owner for the whole capture.
	test("leaves the box status alone for an operation that has no target status", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, {
			user_id: owner.clerkUserId,
			status: "running"
		});

		await start(t, boxId, "snapshot");

		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
	});

	test("records the operation as pending with the trigger that asked for it", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, { user_id: owner.clerkUserId });

		const operationId = await t.mutation(
			internal.boxes.operations.startOperation,
			{
				boxId,
				idempotencyKey: "sweep-key",
				trigger: "system:auto_repair",
				type: "stop"
			}
		);

		expect(await readOperation(t, operationId!)).toMatchObject({
			box_id: boxId,
			idempotency_key: "sweep-key",
			status: "pending",
			trigger: "system:auto_repair",
			type: "stop"
		});
	});

	// The whole reason this is one mutation. An operation row with no workflow id
	// is one nothing will ever close, and an open operation blocks every later
	// action on the box - permanently, because there is nothing left to fail it.
	test("records the workflow carrying the operation in the same transaction", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, { user_id: owner.clerkUserId });

		const operationId = await start(t, boxId, "stop");

		const operation = await readOperation(t, operationId!);
		expect(operation?.workflow_id).toEqual(expect.any(String));
		expect(operation?.workflow_id).not.toBe("");
	});

	test("refuses an operation the box's status does not allow", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, {
			user_id: owner.clerkUserId,
			status: "stopped"
		});

		await expect(start(t, boxId, "stop")).rejects.toThrow(
			/Cannot start stop while box is stopped/
		);
		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	test("refuses an operation on a box that does not exist", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, { user_id: owner.clerkUserId });
		await t.run(async (ctx) => await ctx.db.delete(boxId));

		await expect(start(t, boxId, "stop")).rejects.toThrow(/Box not found/);
	});
});

describe("the operation lock", () => {
	test("starts nothing a second time for a repeated idempotency key", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, { user_id: owner.clerkUserId });

		const first = await start(t, boxId, "stop", { idempotencyKey: "same" });
		const second = await start(t, boxId, "stop", { idempotencyKey: "same" });

		expect(first).not.toBeNull();
		expect(second).toBeNull();
		expect(await boxOperations(t, boxId)).toHaveLength(1);
	});

	test("refuses a different operation while one is still open", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, { user_id: owner.clerkUserId });

		await start(t, boxId, "snapshot");

		await expect(start(t, boxId, "stop")).rejects.toThrow(/busy/i);
	});

	// The lock has to release, or a box is bricked by its first operation. A
	// settled operation is not an open one.
	test("allows the next operation once the open one has settled", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, { user_id: owner.clerkUserId });

		const first = await start(t, boxId, "snapshot");
		await t.mutation(internal.boxes.status.settleOperation, {
			operationId: first!
		});

		await expect(start(t, boxId, "stop")).resolves.not.toBeNull();
	});

	// A failed operation frees the box too - otherwise every failure would need a
	// human to unstick the row before the owner could retry.
	test("allows a retry after the open operation failed", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, {
			user_id: owner.clerkUserId,
			status: "running"
		});

		const first = await start(t, boxId, "reset");
		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId,
			error: "boom",
			operationId: first!,
			targetBoxStatus: "reset_failed"
		});

		const retry = await start(t, boxId, "reset", {
			idempotencyKey: `reset:${boxId}`
		});
		expect(retry).not.toBeNull();
		expect(retry).not.toBe(first);
	});

	// Two boxes are independent. A lock keyed on anything coarser than the box
	// would make one box's repair block the whole fleet.
	test("locks one box without locking another", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const first = await boxFor(t, { user_id: owner.clerkUserId, slug: "one" });
		const second = await boxFor(t, { user_id: owner.clerkUserId, slug: "two" });

		await start(t, first, "snapshot");

		await expect(start(t, second, "snapshot")).resolves.not.toBeNull();
	});
});

describe("slug reservation", () => {
	test("refuses to reserve a slug another live box already holds", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const mine = await boxFor(t, { user_id: owner.clerkUserId, slug: "mine" });
		await boxFor(t, { user_id: "someone_else", slug: "taken" });

		await expect(
			start(t, mine, "change_slug", { reservedSlug: "taken" })
		).rejects.toThrow(/unavailable/i);
	});

	// A slug is only free once its box is really gone; a stopped or suspended box
	// still answers on its address.
	test("still refuses a slug held by a stopped box", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const mine = await boxFor(t, { user_id: owner.clerkUserId, slug: "mine" });
		await boxFor(t, {
			user_id: "someone_else",
			slug: "parked",
			status: "stopped"
		});

		await expect(
			start(t, mine, "change_slug", { reservedSlug: "parked" })
		).rejects.toThrow(/unavailable/i);
	});

	test("frees a slug once the box holding it is deleted", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const mine = await boxFor(t, { user_id: owner.clerkUserId, slug: "mine" });
		await boxFor(t, {
			user_id: "someone_else",
			slug: "gone",
			status: "deleted"
		});

		await expect(
			start(t, mine, "change_slug", { reservedSlug: "gone" })
		).resolves.not.toBeNull();
	});

	// The reservation is what stops two owners racing onto the same address while
	// the first rename is still in flight.
	test("holds the reserved slug against a second box for the length of the operation", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const first = await boxFor(t, { user_id: owner.clerkUserId, slug: "one" });
		const second = await boxFor(t, { user_id: owner.clerkUserId, slug: "two" });

		await start(t, first, "change_slug", { reservedSlug: "wanted" });

		await expect(
			start(t, second, "change_slug", { reservedSlug: "wanted" })
		).rejects.toThrow(/unavailable/i);
	});

	test("refuses a reserved slug that is not a legal slug at all", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await boxFor(t, { user_id: owner.clerkUserId });

		await expect(
			start(t, boxId, "change_slug", { reservedSlug: "Not A Slug" })
		).rejects.toThrow(/unavailable/i);
	});
});
