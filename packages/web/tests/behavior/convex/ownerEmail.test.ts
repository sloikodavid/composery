import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ownerNoticeEmail } from "@/convex/ownerEmail";

import {
	boxEvents,
	readBox,
	seedBox,
	seedUser,
	staffAlerts,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../support/convex.ts";

// The four things a box owner is told, and the two ways of getting one wrong:
// saying something that was never true of their box, or repeating something
// written for staff. The wiring tests below run the real lifecycle mutations
// rather than calling the sender, because "which events reach an owner" is a
// property of those mutations and a test that called `sendOwnerEmail` directly
// would keep passing after the call site was deleted.

const NOW = Date.UTC(2026, 6, 28, 9, 0, 0);
const BOX = { slug: "atlas", url: "https://composery.test/boxes/box_1" };
const AUTOMATIC_REASON =
	"Automatic suspension: Sustained egress bandwidth at 940 Mbps (threshold 500 Mbps) over the last 30 minutes.";
const STAFF_NOTE = "Chargeback opened, do not warn the customer";

function stubOwnerEmailEnv() {
	vi.stubEnv("RESEND_API_KEY", "re_test");
	vi.stubEnv("OWNER_EMAIL_FROM", "Composery <hello@mail.composery.test>");
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("what a deletion notice says", () => {
	test("names the subscription when the subscription is what ended", () => {
		const { subject, text } = ownerNoticeEmail(
			{ type: "deleted", trigger: "system:subscription_revoked" },
			BOX
		);

		expect(subject).toBe("Your Composery box atlas has been deleted");
		expect(text).toContain("Its subscription ended");
	});

	test("names the account deletion the owner asked for", () => {
		const { text } = ownerNoticeEmail(
			{ type: "deleted", trigger: "system:account_deletion" },
			BOX
		);

		expect(text).toContain("delete your Composery account");
	});

	test("says staff deleted it when staff did", () => {
		const { text } = ownerNoticeEmail(
			{ type: "deleted", trigger: "staff" },
			BOX
		);

		expect(text).toContain("Composery staff deleted it");
	});

	test("invents no reason for a re-driven deletion, which does not know one", () => {
		const { text } = ownerNoticeEmail(
			{ type: "deleted", trigger: "system:delete_retry" },
			BOX
		);

		expect(text).not.toContain("subscription");
		expect(text).not.toContain("account");
		expect(text).not.toContain("staff deleted");
	});

	test("says the deletion cannot be undone, whatever ordered it", () => {
		for (const trigger of [
			"system:subscription_revoked",
			"system:account_deletion",
			"staff",
			undefined
		] as const) {
			const { text } = ownerNoticeEmail({ type: "deleted", trigger }, BOX);
			expect(text).toContain("cannot be undone");
		}
	});
});

describe("what a suspension notice says", () => {
	test("repeats the measurement an automatic suspension was based on", () => {
		const { subject, text } = ownerNoticeEmail(
			{
				type: "suspended",
				trigger: "system:abuse_suspension",
				reason: AUTOMATIC_REASON
			},
			BOX
		);

		expect(subject).toBe("Your Composery box atlas has been suspended");
		expect(text).toContain(AUTOMATIC_REASON);
	});

	test("never repeats a staff note, which is written for other staff", () => {
		const { text } = ownerNoticeEmail(
			{ type: "suspended", trigger: "staff", reason: STAFF_NOTE },
			BOX
		);

		expect(text).not.toContain(STAFF_NOTE);
		expect(text).not.toContain("Chargeback");
		expect(text).toContain("A member of Composery staff suspended it.");
	});

	test("promises the files are still there, because they are", () => {
		const { text } = ownerNoticeEmail(
			{ type: "suspended", trigger: "staff", reason: undefined },
			BOX
		);

		expect(text).toContain("Nothing has been deleted");
	});
});

describe("the other two notices", () => {
	test("an unsuspension says the box is back", () => {
		const { subject, text } = ownerNoticeEmail({ type: "unsuspended" }, BOX);

		expect(subject).toBe("Your Composery box atlas is running again");
		expect(text).toContain("suspension on your box atlas has been lifted");
	});

	test("a failed create tells the owner not to report it", () => {
		const { subject, text } = ownerNoticeEmail({ type: "create_failed" }, BOX);

		expect(subject).toBe("Your Composery box atlas could not be created");
		expect(text).toContain("You do not need to report it");
	});
});

test("a deployment with no website origin loses the link, not the sentence", () => {
	const { text } = ownerNoticeEmail(
		{ type: "deleted", trigger: "staff" },
		{ slug: "atlas", url: undefined }
	);

	expect(text).not.toContain("undefined");
	expect(text).not.toContain("The box:");
	expect(text).toContain("Composery staff deleted it");
});

// --- Which lifecycle outcomes actually reach an owner ------------------------

async function openOperation(
	t: Harness,
	boxId: Id<"boxes">,
	type: "create" | "delete" | "reset" | "suspend" | "unsuspend" | "stop",
	metadata?: Record<string, unknown>
) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_operations", {
				box_id: boxId,
				type,
				status: "running",
				idempotency_key: `${type}:${boxId}`,
				trigger: type === "suspend" ? "system:abuse_suspension" : "staff",
				metadata,
				created_at: NOW,
				updated_at: NOW
			})
	);
}

async function emailedNotices(t: Harness, boxId: Id<"boxes">) {
	const events = await boxEvents(t, boxId);
	return events
		.filter((event) => event.type === "box.owner_emailed")
		.map((event) => event.metadata?.notice);
}

describe("which lifecycle outcomes email the owner", () => {
	test("a deletion does", async () => {
		stubOwnerEmailEnv();
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "deleting"
		});
		const operationId = await openOperation(t, boxId, "delete");

		await t.mutation(internal.boxes.status.markDeleted, { boxId, operationId });

		expect(await emailedNotices(t, boxId)).toEqual(["deleted"]);
	});

	test("a suspension does, and a stop does not", async () => {
		stubOwnerEmailEnv();
		const t = testConvex();
		const owner = await seedUser(t);
		const suspended = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "suspended-box",
			status: "suspending"
		});
		const stopped = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "stopped-box",
			status: "stopping"
		});

		await t.mutation(internal.boxes.status.setBoxStatusWithOperationSucceeded, {
			boxId: suspended,
			operationId: await openOperation(t, suspended, "suspend", {
				reason: AUTOMATIC_REASON
			}),
			status: "suspended"
		});
		await t.mutation(internal.boxes.status.setBoxStatusWithOperationSucceeded, {
			boxId: stopped,
			operationId: await openOperation(t, stopped, "stop"),
			status: "stopped"
		});

		expect(await emailedNotices(t, suspended)).toEqual(["suspended"]);
		expect(await emailedNotices(t, stopped)).toEqual([]);
	});

	test("an unsuspension does", async () => {
		stubOwnerEmailEnv();
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "unsuspending"
		});

		await t.mutation(internal.boxes.status.setBoxStatusWithOperationSucceeded, {
			boxId,
			operationId: await openOperation(t, boxId, "unsuspend"),
			status: "running"
		});

		expect(await emailedNotices(t, boxId)).toEqual(["unsuspended"]);
	});

	test("a failed create does, and a failed reset does not", async () => {
		stubOwnerEmailEnv();
		const t = testConvex();
		const owner = await seedUser(t);
		const created = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "new-box",
			status: "creating"
		});
		const reset = await seedBox(t, {
			user_id: owner.clerkUserId,
			slug: "old-box",
			status: "resetting"
		});

		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId: created,
			error: "hetzner said 409 on 10.0.0.4",
			operationId: await openOperation(t, created, "create"),
			targetBoxStatus: "create_failed"
		});
		await t.mutation(internal.boxes.status.markOperationFailed, {
			boxId: reset,
			error: "the host never answered",
			operationId: await openOperation(t, reset, "reset"),
			targetBoxStatus: "reset_failed"
		});

		expect(await emailedNotices(t, created)).toEqual(["create_failed"]);
		expect(await emailedNotices(t, reset)).toEqual([]);
	});
});

describe("when an owner cannot be reached", () => {
	test("a deployment without a sender configured emails nobody", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "deleting"
		});
		const operationId = await openOperation(t, boxId, "delete");

		await t.mutation(internal.boxes.status.markDeleted, { boxId, operationId });

		expect(await emailedNotices(t, boxId)).toEqual([]);
		expect(await readBox(t, boxId)).toMatchObject({ status: "deleted" });
	});

	test("an already-scrubbed account is not mailed at its placeholder address", async () => {
		stubOwnerEmailEnv();
		const t = testConvex();
		const owner = await seedUser(t, {
			email: "deleted-user-abc@deleted.invalid"
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(owner.userId, { deletion_finished_at: NOW - 1000 });
		});
		const boxId = await seedBox(t, {
			user_id: owner.clerkUserId,
			status: "deleting"
		});
		const operationId = await openOperation(t, boxId, "delete");

		await t.mutation(internal.boxes.status.markDeleted, { boxId, operationId });

		expect(await emailedNotices(t, boxId)).toEqual([]);
		expect(await readBox(t, boxId)).toMatchObject({ status: "deleted" });
	});

	// The guarantee the whole design rests on: the notice is the last thing in a
	// transaction that has already torn a box down, so a box with no owner row at
	// all still finishes its deletion and still closes its operation. A throw here
	// would fail the operation, and a failed delete operation is what leaves a box
	// holding its own lock in `delete_failed` for ever.
	// An owner notice keeps no row, so a delivery event for one finds nothing to
	// update. That is the whole design - a bounce has no action behind it - with
	// one exception: a complaint is a problem with the sender, not the recipient,
	// and owner notices share their sending reputation with these very alerts.
	test.each([
		["email.bounced", "warning", "A box owner notice was not delivered"],
		[
			"email.complained",
			"critical",
			"A box owner marked a Composery notice as spam"
		]
	])("a %s owner notice tells staff", async (type, severity, subject) => {
		const t = testConvex();

		await t.mutation(internal.staff.alerts.recordEmailEvent, {
			id: "email_owner_1",
			event: {
				type,
				created_at: "2026-07-28T09:00:00.000Z",
				data: {
					created_at: "2026-07-28T09:00:00.000Z",
					email_id: "email_owner_1",
					from: "Composery <hello@mail.composery.test>",
					to: "owner@example.com",
					subject: "Your Composery box atlas has been deleted",
					...(type === "email.bounced"
						? {
								bounce: {
									type: "Permanent",
									subType: "General",
									message: "The mailbox does not exist."
								}
							}
						: {})
				}
			}
		} as never);

		expect(await staffAlerts(t)).toMatchObject([
			{ severity, subject, text: expect.stringContaining("owner@example.com") }
		]);
	});

	test("a delivered owner notice tells staff nothing", async () => {
		const t = testConvex();

		await t.mutation(internal.staff.alerts.recordEmailEvent, {
			id: "email_owner_2",
			event: {
				type: "email.delivered",
				created_at: "2026-07-28T09:00:00.000Z",
				data: {
					created_at: "2026-07-28T09:00:00.000Z",
					email_id: "email_owner_2",
					from: "Composery <hello@mail.composery.test>",
					to: "owner@example.com",
					subject: "Your Composery box atlas has been deleted"
				}
			}
		} as never);

		expect(await staffAlerts(t)).toEqual([]);
	});

	test("a box whose owner row is gone still finishes its deletion", async () => {
		stubOwnerEmailEnv();
		const t = testConvex();
		const boxId = await seedBox(t, {
			user_id: "clerk_user_that_no_longer_exists",
			status: "deleting"
		});
		const operationId = await openOperation(t, boxId, "delete");

		await t.mutation(internal.boxes.status.markDeleted, { boxId, operationId });

		expect(await emailedNotices(t, boxId)).toEqual([]);
		expect(await readBox(t, boxId)).toMatchObject({ status: "deleted" });
		expect(await staffAlerts(t)).toEqual([]);
	});
});
