import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import {
	boxOperations,
	readBox,
	seedBox,
	seedUser,
	stubDeploymentEnv,
	testConvex,
	type Harness
} from "../../../support/convex.ts";

// The owner-facing surface. Nearly every test here is an access-control test
// asked as a behaviour question: what does the API return to someone who is not
// the owner? The answer has to be indistinguishable from "no such box", because
// anything else confirms the box exists to a caller who may only be guessing
// slugs.
//
// Time is frozen for the same reason as in operations.test.ts - these mutations
// start real workflows - and because the reissue budget is a window measured
// from now.
const NOW = Date.UTC(2026, 2, 3, 4, 5, 6);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

async function twoOwners(t: Harness) {
	const mine = await seedUser(t, {
		clerkUserId: "owner",
		email: "owner@example.com"
	});
	const theirs = await seedUser(t, {
		clerkUserId: "stranger",
		email: "stranger@example.com"
	});
	return { mine, theirs };
}

describe("reading a box", () => {
	test("gives the owner their own box", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine"
		});

		const result = await mine.as.query(api.user.boxes.getById, { boxId });

		expect(result?.box).toMatchObject({ id: boxId, slug: "mine" });
	});

	test("hides a box from everyone but its owner", async () => {
		const t = testConvex();
		const { mine, theirs } = await twoOwners(t);
		const boxId = await seedBox(t, { user_id: mine.clerkUserId });

		expect(await theirs.as.query(api.user.boxes.getById, { boxId })).toBeNull();
	});

	test("hides a deleted box from its former owner", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			status: "deleted"
		});

		expect(await mine.as.query(api.user.boxes.getById, { boxId })).toBeNull();
	});

	// A malformed id must read as "no box", not as an error that says the id was
	// the wrong shape.
	test("reports no box for an id that is not a box id", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);

		expect(
			await mine.as.query(api.user.boxes.getById, { boxId: "not-an-id" })
		).toBeNull();
	});

	test("refuses an unauthenticated reader", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, { user_id: mine.clerkUserId });

		await expect(t.query(api.user.boxes.getById, { boxId })).rejects.toThrow(
			/Authentication required/
		);
	});

	// A suspended owner is told why rather than shown an empty account, so the
	// interface can explain itself.
	test("tells a suspended owner the reason instead of hiding their box", async () => {
		const t = testConvex();
		const suspended = await seedUser(t, {
			clerkUserId: "banned",
			suspended: true,
			suspendedReason: "abuse report"
		});
		const boxId = await seedBox(t, { user_id: suspended.clerkUserId });

		await expect(
			suspended.as.query(api.user.boxes.getById, { boxId })
		).rejects.toMatchObject({
			data: { kind: "user_suspended", reason: "abuse report" }
		});
	});
});

describe("listing boxes", () => {
	test("lists only the caller's own boxes", async () => {
		const t = testConvex();
		const { mine, theirs } = await twoOwners(t);
		await seedBox(t, { user_id: mine.clerkUserId, slug: "mine" });
		await seedBox(t, { user_id: theirs.clerkUserId, slug: "theirs" });

		const page = await mine.as.query(api.user.boxes.list, {
			paginationOpts: { cursor: null, numItems: 10 }
		});

		expect(page.page.map((box) => box.slug)).toEqual(["mine"]);
	});

	test("leaves deleted boxes out of the list", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		await seedBox(t, { user_id: mine.clerkUserId, slug: "live" });
		await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "gone",
			status: "deleted"
		});

		const page = await mine.as.query(api.user.boxes.list, {
			paginationOpts: { cursor: null, numItems: 10 }
		});

		expect(page.page.map((box) => box.slug)).toEqual(["live"]);
	});

	// A signed-in identity with no user row yet is a real state - the row is
	// created by a mutation the app fires alongside its first queries.
	test("returns an empty page to an identity with no user row yet", async () => {
		const t = testConvex();

		const page = await t
			.withIdentity({ subject: "brand_new", email: "new@example.com" })
			.query(api.user.boxes.list, {
				paginationOpts: { cursor: null, numItems: 10 }
			});

		expect(page).toMatchObject({ isDone: true, page: [] });
	});
});

describe("acting on a box", () => {
	test("stops a box the caller owns", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});

		await mine.as.mutation(api.user.boxes.stop, { slug: "mine" });

		expect(await readBox(t, boxId)).toMatchObject({ status: "stopping" });
	});

	test("refuses to act on a box the caller does not own", async () => {
		const t = testConvex();
		const { mine, theirs } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});

		await expect(
			theirs.as.mutation(api.user.boxes.stop, { slug: "mine" })
		).rejects.toThrow(/Box not found/);
		expect(await readBox(t, boxId)).toMatchObject({ status: "running" });
	});

	// Same message either way, so a stranger cannot learn which slugs exist by
	// comparing the errors.
	test("says the same thing about someone else's box as about no box at all", async () => {
		const t = testConvex();
		const { mine, theirs } = await twoOwners(t);
		await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});

		const forOthers = await theirs.as
			.mutation(api.user.boxes.stop, { slug: "mine" })
			.catch((error: unknown) => String((error as { data: string }).data));
		const forMissing = await theirs.as
			.mutation(api.user.boxes.stop, { slug: "nothing-here" })
			.catch((error: unknown) => String((error as { data: string }).data));

		expect(forOthers).toBe(forMissing);
	});

	test("refuses a reset whose confirmation does not match the slug", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});

		await expect(
			mine.as.mutation(api.user.boxes.reset, {
				confirmation: "Mine",
				slug: "mine"
			})
		).rejects.toThrow(/Type the box slug/);
		expect(await boxOperations(t, boxId)).toEqual([]);
	});

	test("resets when the confirmation matches", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});

		await mine.as.mutation(api.user.boxes.reset, {
			confirmation: "mine",
			slug: "mine"
		});

		expect(await readBox(t, boxId)).toMatchObject({ status: "resetting" });
	});
});

// Every reissuing operation spends from CLOUD_DOMAIN's weekly Let's Encrypt
// budget, which is shared by the whole fleet, so one box cannot be allowed to
// burn it.
describe("the certificate reissue budget", () => {
	async function pastReissues(
		t: Harness,
		boxId: Id<"boxes">,
		entries: { at: number; type: "reset" | "change_slug" }[]
	) {
		await t.run(async (ctx) => {
			for (const [index, entry] of entries.entries()) {
				await ctx.db.insert("box_operations", {
					box_id: boxId,
					type: entry.type,
					status: "succeeded",
					idempotency_key: `past-${index}`,
					trigger: "owner",
					created_at: entry.at,
					updated_at: entry.at
				});
			}
		});
	}

	test("refuses a reset once the week's reissues are spent", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});
		await pastReissues(
			t,
			boxId,
			Array.from({ length: 5 }, () => ({
				at: NOW - 1000,
				type: "reset" as const
			}))
		);

		await expect(
			mine.as.mutation(api.user.boxes.reset, {
				confirmation: "mine",
				slug: "mine"
			})
		).rejects.toThrow(/too often this week/);
	});

	// The two operations share one budget, so five renames also exhaust resets.
	test("counts renames and resets against the same budget", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});
		await pastReissues(t, boxId, [
			{ at: NOW - 1000, type: "change_slug" },
			{ at: NOW - 1000, type: "change_slug" },
			{ at: NOW - 1000, type: "change_slug" },
			{ at: NOW - 1000, type: "reset" },
			{ at: NOW - 1000, type: "reset" }
		]);

		await expect(
			mine.as.mutation(api.user.boxes.reset, {
				confirmation: "mine",
				slug: "mine"
			})
		).rejects.toThrow(/too often this week/);
	});

	// The window has to roll, or a box that was reset five times a year ago could
	// never be reset again.
	test("ignores reissues older than the window", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});
		await pastReissues(
			t,
			boxId,
			Array.from({ length: 5 }, () => ({
				at: NOW - WEEK_MS - 1,
				type: "reset" as const
			}))
		);

		await mine.as.mutation(api.user.boxes.reset, {
			confirmation: "mine",
			slug: "mine"
		});

		expect(await readBox(t, boxId)).toMatchObject({ status: "resetting" });
	});

	test("still allows the fifth reissue of the week", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});
		await pastReissues(
			t,
			boxId,
			Array.from({ length: 4 }, () => ({
				at: NOW - 1000,
				type: "reset" as const
			}))
		);

		await mine.as.mutation(api.user.boxes.reset, {
			confirmation: "mine",
			slug: "mine"
		});

		expect(await readBox(t, boxId)).toMatchObject({ status: "resetting" });
	});
});

describe("changing a box's address", () => {
	test("reserves the new slug on the operation that will take it", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "old",
			status: "running"
		});

		const result = await mine.as.mutation(api.user.boxes.changeSlug, {
			newSlug: "new",
			slug: "old"
		});

		expect(result).toEqual({ slug: "new" });
		expect(await boxOperations(t, boxId)).toMatchObject([
			{ type: "change_slug", reserved_slug: "new", status: "pending" }
		]);
	});

	test("normalises the requested slug before reserving it", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "old",
			status: "running"
		});

		const result = await mine.as.mutation(api.user.boxes.changeSlug, {
			newSlug: "  New-Slug  ",
			slug: "old"
		});

		expect(result).toEqual({ slug: "new-slug" });
		expect(await boxOperations(t, boxId)).toMatchObject([
			{ reserved_slug: "new-slug" }
		]);
	});

	test("refuses a slug another box already holds", async () => {
		const t = testConvex();
		const { mine, theirs } = await twoOwners(t);
		await seedBox(t, { user_id: mine.clerkUserId, slug: "old" });
		await seedBox(t, { user_id: theirs.clerkUserId, slug: "taken" });

		await expect(
			mine.as.mutation(api.user.boxes.changeSlug, {
				newSlug: "taken",
				slug: "old"
			})
		).rejects.toThrow(/unavailable/i);
	});

	test("refuses a slug that is not a legal address", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		await seedBox(t, { user_id: mine.clerkUserId, slug: "old" });

		await expect(
			mine.as.mutation(api.user.boxes.changeSlug, {
				newSlug: "-",
				slug: "old"
			})
		).rejects.toThrow(/unavailable/i);
	});
});

describe("snapshots", () => {
	async function completeSnapshot(
		t: Harness,
		boxId: Id<"boxes">,
		userId: string,
		status: "complete" | "failed" = "complete"
	) {
		return await t.run(
			async (ctx) =>
				await ctx.db.insert("box_snapshots", {
					box_id: boxId,
					user_id: userId,
					class: "manual",
					status,
					hetzner_image_id: 42,
					created_at: NOW - 10_000
				})
		);
	}

	test("shows the owner their box's snapshots", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, { user_id: mine.clerkUserId, slug: "mine" });
		const snapshotId = await completeSnapshot(t, boxId, mine.clerkUserId);

		const rows = await mine.as.query(api.user.boxes.snapshots, {
			slug: "mine"
		});

		expect(rows).toMatchObject([{ id: snapshotId, status: "complete" }]);
	});

	test("shows a stranger nothing for a box they do not own", async () => {
		const t = testConvex();
		const { mine, theirs } = await twoOwners(t);
		const boxId = await seedBox(t, { user_id: mine.clerkUserId, slug: "mine" });
		await completeSnapshot(t, boxId, mine.clerkUserId);

		expect(
			await theirs.as.query(api.user.boxes.snapshots, { slug: "mine" })
		).toEqual([]);
	});

	test("refuses to restore a snapshot belonging to someone else's box", async () => {
		const t = testConvex();
		const { mine, theirs } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});
		const snapshotId = await completeSnapshot(t, boxId, mine.clerkUserId);

		await expect(
			theirs.as.mutation(api.user.boxes.restoreSnapshot, { snapshotId })
		).rejects.toThrow(/Snapshot not found/);
	});

	test("refuses to restore a snapshot that never finished", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});
		const snapshotId = await completeSnapshot(
			t,
			boxId,
			mine.clerkUserId,
			"failed"
		);

		await expect(
			mine.as.mutation(api.user.boxes.restoreSnapshot, { snapshotId })
		).rejects.toThrow(/finished snapshot/);
	});

	test("restores a finished snapshot for its owner", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, {
			user_id: mine.clerkUserId,
			slug: "mine",
			status: "running"
		});
		const snapshotId = await completeSnapshot(t, boxId, mine.clerkUserId);

		await mine.as.mutation(api.user.boxes.restoreSnapshot, { snapshotId });

		expect(await readBox(t, boxId)).toMatchObject({ status: "restoring" });
	});

	test("refuses to delete a snapshot belonging to someone else's box", async () => {
		const t = testConvex();
		const { mine, theirs } = await twoOwners(t);
		const boxId = await seedBox(t, { user_id: mine.clerkUserId, slug: "mine" });
		const snapshotId = await completeSnapshot(t, boxId, mine.clerkUserId);

		await expect(
			theirs.as.mutation(api.user.boxes.deleteSnapshot, { snapshotId })
		).rejects.toThrow(/Snapshot not found/);
		expect(
			await t.run(async (ctx) => await ctx.db.get(snapshotId))
		).toMatchObject({ status: "complete" });
	});

	test("marks the owner's snapshot for deletion", async () => {
		const t = testConvex();
		const { mine } = await twoOwners(t);
		const boxId = await seedBox(t, { user_id: mine.clerkUserId, slug: "mine" });
		const snapshotId = await completeSnapshot(t, boxId, mine.clerkUserId);

		await mine.as.mutation(api.user.boxes.deleteSnapshot, { snapshotId });

		expect(
			await t.run(async (ctx) => await ctx.db.get(snapshotId))
		).toMatchObject({ status: "deleting" });
	});
});
