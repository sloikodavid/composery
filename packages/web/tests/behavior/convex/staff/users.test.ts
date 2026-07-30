import { describe, expect, test } from "vitest";
import { api, internal } from "@/convex/_generated/api";

import { seedUser, testConvex, type Harness } from "../../../support/convex.ts";

// Suspension is the moderation control, and the two rules on it are the ones
// that decide whether the console can be used to lock the console out: an admin
// must not suspend themselves, and must not suspend another admin. Neither rule
// had a test, and neither fails visibly - a broken one only shows up as an
// account nobody can reach.

function suspensionOf(t: Harness, clerkUserId: string) {
	return t.run(async (ctx) => {
		const user = await ctx.db
			.query("users")
			.withIndex("clerk_user_id", (query) =>
				query.eq("clerk_user_id", clerkUserId)
			)
			.first();
		return {
			suspended: user?.suspended,
			suspendedAt: user?.suspended_at,
			suspendedReason: user?.suspended_reason
		};
	});
}

describe("suspending an account", () => {
	test("records the reason and when it happened", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
		const customer = await seedUser(t, { clerkUserId: "customer" });

		await t.mutation(internal.staff.users.setUserSuspension, {
			callerClerkUserId: admin.clerkUserId,
			clerkUserId: customer.clerkUserId,
			reason: "chargeback pending",
			suspended: true
		});

		expect(await suspensionOf(t, customer.clerkUserId)).toEqual({
			suspended: true,
			suspendedAt: expect.any(Number),
			suspendedReason: "chargeback pending"
		});
	});

	// Lifting a suspension clears the note with it. A stale reason on a live
	// account is a sentence the console would keep showing about something that
	// is no longer true.
	test("clears the reason when the suspension is lifted", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
		const customer = await seedUser(t, {
			clerkUserId: "customer",
			suspended: true,
			suspendedReason: "chargeback pending"
		});

		await t.mutation(internal.staff.users.setUserSuspension, {
			callerClerkUserId: admin.clerkUserId,
			clerkUserId: customer.clerkUserId,
			suspended: false
		});

		expect(await suspensionOf(t, customer.clerkUserId)).toEqual({
			suspended: false,
			suspendedAt: undefined,
			suspendedReason: undefined
		});
	});

	test("refuses to suspend the account doing the suspending", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });

		await expect(
			t.mutation(internal.staff.users.setUserSuspension, {
				callerClerkUserId: admin.clerkUserId,
				clerkUserId: admin.clerkUserId,
				suspended: true
			})
		).rejects.toThrow(/your own account/i);
		expect((await suspensionOf(t, admin.clerkUserId)).suspended).toBe(false);
	});

	test("refuses to suspend another staff account", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
		const other = await seedUser(t, { clerkUserId: "other", role: "admin" });

		await expect(
			t.mutation(internal.staff.users.setUserSuspension, {
				callerClerkUserId: admin.clerkUserId,
				clerkUserId: other.clerkUserId,
				suspended: true
			})
		).rejects.toThrow(/Staff accounts/i);
	});

	// Unsuspending is not moderation of a person, so neither rule applies to it -
	// an admin locked out by an earlier mistake has to be reachable.
	test("still lifts a suspension from a staff account", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
		const other = await seedUser(t, {
			clerkUserId: "other",
			role: "admin",
			suspended: true
		});

		await t.mutation(internal.staff.users.setUserSuspension, {
			callerClerkUserId: admin.clerkUserId,
			clerkUserId: other.clerkUserId,
			suspended: false
		});

		expect((await suspensionOf(t, other.clerkUserId)).suspended).toBe(false);
	});

	test("refuses an identity with no account", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });

		await expect(
			t.mutation(internal.staff.users.setUserSuspension, {
				callerClerkUserId: admin.clerkUserId,
				clerkUserId: "never-signed-in",
				suspended: true
			})
		).rejects.toThrow(/User not found/);
	});

	test("refuses the public action to a customer", async () => {
		const t = testConvex();
		const customer = await seedUser(t, { clerkUserId: "customer" });

		await expect(
			customer.as.action(api.staff.users.setUserSuspended, {
				clerkUserId: "someone",
				suspended: true
			})
		).rejects.toThrow(/Staff access required/);
	});
});
