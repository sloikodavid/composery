import { ConvexError } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "@/convex/_generated/api";
import { emailFromIdentity, requireCapability } from "@/convex/authorization";

import { seedBox, seedUser, testConvex } from "../../support/convex.ts";

// Every Convex entry point in this deployment starts by turning a Clerk identity
// into a `users` row and asking what that row may do. These run the real
// mutations and queries against the harness, so what is asserted is the answer a
// caller gets - not the shape of a helper.

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("identity to user record", () => {
	test("creates the caller's user row on first contact", async () => {
		const t = testConvex();

		const user = await t
			.withIdentity({ subject: "clerk_1", email: "first@example.com" })
			.mutation(api.users.ensureCurrentUser, {});

		expect(user).toEqual({
			clerkUserId: "clerk_1",
			email: "first@example.com",
			role: "user",
			suspended: false,
			suspendedReason: undefined
		});
	});

	test("gives a brand-new account no role but `user`", async () => {
		const t = testConvex();

		const capabilities = await t
			.withIdentity({ subject: "clerk_1", email: "first@example.com" })
			.mutation(api.users.ensureCurrentUser, {})
			.then(() =>
				t
					.withIdentity({ subject: "clerk_1", email: "first@example.com" })
					.query(api.users.currentUserCapabilities, {})
			);

		expect(capabilities).toEqual([]);
	});

	test("reuses the existing row when the same identity calls again", async () => {
		const t = testConvex();
		const as = t.withIdentity({ subject: "clerk_1", email: "a@example.com" });

		await as.mutation(api.users.ensureCurrentUser, {});
		await as.mutation(api.users.ensureCurrentUser, {});

		const rows = await t.run(
			async (ctx) => await ctx.db.query("users").collect()
		);
		expect(rows).toHaveLength(1);
	});

	test("follows an email change made in Clerk", async () => {
		const t = testConvex();

		await t
			.withIdentity({ subject: "clerk_1", email: "old@example.com" })
			.mutation(api.users.ensureCurrentUser, {});
		const updated = await t
			.withIdentity({ subject: "clerk_1", email: "new@example.com" })
			.mutation(api.users.ensureCurrentUser, {});

		expect(updated.email).toBe("new@example.com");
		const rows = await t.run(
			async (ctx) => await ctx.db.query("users").collect()
		);
		expect(rows.map((row) => row.email)).toEqual(["new@example.com"]);
	});

	// The row carries the role, and `ensureCurrentUser` runs on every page load.
	// If it rebuilt the row rather than patching it, every staff member would be
	// demoted by visiting the site.
	test("leaves an existing role alone when the row is refreshed", async () => {
		const t = testConvex();
		const admin = await seedUser(t, {
			clerkUserId: "clerk_admin",
			role: "admin"
		});

		const refreshed = await admin.as.mutation(api.users.ensureCurrentUser, {});

		expect(refreshed.role).toBe("admin");
	});

	test("refuses an unauthenticated caller", async () => {
		const t = testConvex();

		await expect(t.mutation(api.users.ensureCurrentUser, {})).rejects.toThrow(
			/Authentication required/
		);
	});

	// Clerk only puts `email` in the session token once someone customises it, so
	// this fires on a fresh deployment and the message has to say where to go.
	test("names the Clerk setting when the token carries no email claim", () => {
		expect(() =>
			emailFromIdentity({ subject: "clerk_1" } as never)
		).toThrowError(ConvexError);
		try {
			emailFromIdentity({ subject: "clerk_1" } as never);
		} catch (error) {
			expect(String((error as ConvexError<string>).data)).toContain(
				"Customize session token"
			);
		}
	});
});

describe("suspension", () => {
	test("refuses a suspended account a write path", async () => {
		const t = testConvex();
		const user = await seedUser(t, { suspended: true });
		const boxId = await t.run(
			async (ctx) =>
				await ctx.db.insert("boxes", {
					user_id: user.clerkUserId,
					slug: "box",
					plan: "air",
					manual_snapshot_cap: 0,
					status: "running",
					created_at: 1,
					updated_at: 1
				})
		);
		expect(boxId).toBeDefined();

		await expect(
			user.as.mutation(api.user.boxes.stop, { slug: "box" })
		).rejects.toThrow(/suspended/i);
	});

	test("reports no capabilities for a suspended admin", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { role: "admin", suspended: true });

		expect(await admin.as.query(api.users.currentUserCapabilities, {})).toEqual(
			[]
		);
		expect(await admin.as.query(api.users.canAccessStaffConsole, {})).toBe(
			false
		);
	});

	test("hides a suspended account from the action-side lookup", async () => {
		const t = testConvex();
		const user = await seedUser(t, { suspended: true });

		expect(
			await t.query(internal.users.activeUserByClerkId, {
				clerkUserId: user.clerkUserId
			})
		).toBeNull();
	});

	// `ensureCurrentUser` is the one write path a suspended account still reaches,
	// because it is what the app calls before it knows the account is suspended.
	// It must not clear the flag.
	test("keeps the suspension when a suspended account refreshes its row", async () => {
		const t = testConvex();
		const user = await seedUser(t, {
			suspended: true,
			suspendedReason: "abuse"
		});

		const refreshed = await user.as.mutation(api.users.ensureCurrentUser, {});

		expect(refreshed).toMatchObject({
			suspended: true,
			suspendedReason: "abuse"
		});
	});
});

describe("capabilities", () => {
	test("refuses a customer a staff-gated query", async () => {
		const t = testConvex();
		const user = await seedUser(t);

		await expect(user.as.query(api.staff.boxes.search, {})).rejects.toThrow(
			/Staff access required/
		);
	});

	test("admits an admin to the same query", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { role: "admin" });

		expect(await admin.as.query(api.staff.boxes.search, {})).toEqual([]);
	});

	test("refuses an authenticated caller with no user row at all", async () => {
		const t = testConvex();

		await expect(
			t
				.withIdentity({ subject: "ghost", email: "ghost@example.com" })
				.query(api.staff.boxes.search, {})
		).rejects.toThrow(/Staff access required/);
	});

	// Capabilities are per-power, not one staff bit: a query gated on
	// `staff_console` and a mutation gated on `box_operations` are separate asks,
	// and `requireCapability` has to check the one it was given.
	test("checks the capability it was asked about, not staff membership", async () => {
		const t = testConvex();
		const user = await seedUser(t);

		const denied = await t.run(async (ctx) => {
			try {
				await requireCapability(
					{ auth: fakeAuth(user.clerkUserId), db: ctx.db },
					"box_comp"
				);
				return false;
			} catch {
				return true;
			}
		});
		expect(denied).toBe(true);
	});

	test("refuses a staff-gated action to a customer", async () => {
		const t = testConvex();
		const user = await seedUser(t);
		const boxId = await seedBox(t, { user_id: user.clerkUserId });

		await expect(
			user.as.action(api.staff.boxes.repair, { boxId })
		).rejects.toThrow(/Staff access required/);
	});

	test("refuses a staff-gated action to an anonymous caller", async () => {
		const t = testConvex();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });

		await expect(t.action(api.staff.boxes.repair, { boxId })).rejects.toThrow(
			/Staff access required/
		);
	});
});

// `t.run` gives a mutation ctx with no identity attached, which is exactly what
// these two helpers need supplied - they take `{ auth, db }` rather than a whole
// ctx precisely so a caller can be named.
function fakeAuth(subject: string) {
	return {
		getUserIdentity: async () => ({
			subject,
			issuer: "https://clerk.test",
			tokenIdentifier: `https://clerk.test|${subject}`
		})
	} as never;
}
