import { ConvexError } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "@/convex/_generated/api";
import {
	ROLE_CAPABILITIES,
	accountBlock,
	emailFromIdentity,
	requireCapability,
	roleHasCapability,
	rolesWithCapability
} from "@/convex/users";

import {
	seedBox,
	seedUser,
	stubDeploymentEnv,
	testConvex
} from "../../support/convex.ts";

// Every Convex entry point in this deployment starts by turning a Clerk identity
// into a `users` row and asking what that row may do. These run the real
// mutations and queries against the harness, so what is asserted is the answer a
// caller gets - not the shape of a helper.

afterEach(() => {
	vi.unstubAllEnvs();
});

async function readUser(t: ReturnType<typeof testConvex>, clerkUserId: string) {
	return await t.run(
		async (ctx) =>
			await ctx.db
				.query("users")
				.withIndex("clerk_user_id", (query) =>
					query.eq("clerk_user_id", clerkUserId)
				)
				.first()
	);
}

describe("identity to user record", () => {
	test("creates the caller's user row on first contact", async () => {
		const t = testConvex();

		await t
			.withIdentity({ subject: "clerk_1", email: "first@example.com" })
			.mutation(api.users.ensureCurrentUser, {});

		expect(await readUser(t, "clerk_1")).toMatchObject({
			clerk_user_id: "clerk_1",
			email: "first@example.com",
			role: "user",
			suspended: false
		});
	});

	test("gives a brand-new account no role but `user`", async () => {
		const t = testConvex();
		const as = t.withIdentity({
			subject: "clerk_1",
			email: "first@example.com"
		});

		await as.mutation(api.users.ensureCurrentUser, {});

		expect((await readUser(t, "clerk_1"))?.role).toBe("user");
		expect(await as.query(api.users.canAccessStaffConsole, {})).toBe(false);
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
		await t
			.withIdentity({ subject: "clerk_1", email: "new@example.com" })
			.mutation(api.users.ensureCurrentUser, {});

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

		await admin.as.mutation(api.users.ensureCurrentUser, {});

		expect((await readUser(t, "clerk_admin"))?.role).toBe("admin");
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

// One gate, two conditions, and the same words wherever a caller meets it.
describe("an account that may not act", () => {
	test("says nothing about an ordinary account", () => {
		expect(
			accountBlock({
				deletion_finished_at: undefined,
				deletion_pending: undefined,
				suspended: false,
				suspended_reason: undefined
			})
		).toBeNull();
	});

	test("forwards a suspension reason and falls back to support when there is none", () => {
		const withReason = accountBlock({
			deletion_finished_at: undefined,
			deletion_pending: undefined,
			suspended: true,
			suspended_reason: "abuse"
		});
		expect(withReason).toMatchObject({
			kind: "account_unavailable",
			title: "Your account is suspended",
			detail: "abuse"
		});

		const withoutReason = accountBlock({
			deletion_finished_at: undefined,
			deletion_pending: undefined,
			suspended: true,
			suspended_reason: "   "
		});
		expect(withoutReason?.detail).toContain("Contact support");
	});

	// A deletion outranks a suspension: the account is being torn down, so
	// "contact support to have this reviewed" would be the wrong offer.
	test("reports a pending deletion rather than the suspension it sets", () => {
		expect(
			accountBlock({
				deletion_finished_at: undefined,
				deletion_pending: true,
				suspended: true,
				suspended_reason: "abuse"
			})?.title
		).toBe("This account is being deleted");
	});

	test("refuses a suspended account a write path, and says why", async () => {
		const t = testConvex();
		stubDeploymentEnv();
		const user = await seedUser(t, {
			suspended: true,
			suspendedReason: "abuse"
		});
		await seedBox(t, { user_id: user.clerkUserId, slug: "box" });

		await expect(
			user.as.mutation(api.user.boxes.stop, { slug: "box" })
		).rejects.toMatchObject({
			data: { kind: "account_unavailable", detail: "abuse" }
		});
	});

	// The gap this closes: `deletion_pending` was checked by checkout alone, so an
	// account whose deletion was in flight could still start, stop, reset and
	// rename the very boxes that deletion was tearing down.
	test("refuses a box action while the account is being deleted", async () => {
		const t = testConvex();
		stubDeploymentEnv();
		const user = await seedUser(t, { deletionPending: true });
		await seedBox(t, { user_id: user.clerkUserId, slug: "box" });

		await expect(
			user.as.mutation(api.user.boxes.start, { slug: "box" })
		).rejects.toMatchObject({
			data: { title: "This account is being deleted" }
		});
	});

	test("refuses checkout while the account is being deleted", async () => {
		const t = testConvex();
		stubDeploymentEnv();
		const user = await seedUser(t, { deletionPending: true });

		await expect(
			user.as.action(api.user.checkout.createCheckout, {
				billingInterval: "month",
				plan: "air",
				slug: "another-box"
			})
		).rejects.toMatchObject({
			data: { title: "This account is being deleted" }
		});
	});

	// Reads are gated too, and by the same helper. The configuration page asked
	// only "are you signed in", so a suspended owner still read their box's
	// environment back.
	test("refuses a suspended account every owner-facing read", async () => {
		const t = testConvex();
		stubDeploymentEnv();
		const user = await seedUser(t, { suspended: true });
		await seedBox(t, { user_id: user.clerkUserId, slug: "box" });

		await expect(
			user.as.query(api.user.boxes.list, {
				paginationOpts: { cursor: null, numItems: 10 }
			})
		).rejects.toThrow(/suspended/i);
		await expect(
			user.as.query(api.user.boxConfig.get, { slug: "box" })
		).rejects.toThrow(/suspended/i);
	});

	test("shuts a suspended admin out of the console", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { role: "admin", suspended: true });

		expect(await admin.as.query(api.users.canAccessStaffConsole, {})).toBe(
			false
		);
		await expect(admin.as.query(api.staff.boxes.search, {})).rejects.toThrow(
			/Staff access required/
		);
	});

	// The staff powers of an account being deleted go with it, without waiting
	// for the finalizer to demote the row.
	test("shuts an admin being deleted out of the console", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { role: "admin", deletionPending: true });

		expect(await admin.as.query(api.users.canAccessStaffConsole, {})).toBe(
			false
		);
	});

	// `ensureCurrentUser` is the one write path a blocked account still reaches,
	// because it is what the app calls before it knows the account is blocked.
	// It must not clear the flag.
	test("keeps the suspension when a suspended account refreshes its row", async () => {
		const t = testConvex();
		const user = await seedUser(t, {
			suspended: true,
			suspendedReason: "abuse"
		});

		await user.as.mutation(api.users.ensureCurrentUser, {});

		expect(await readUser(t, user.clerkUserId)).toMatchObject({
			suspended: true,
			suspended_reason: "abuse"
		});
	});

	// Actions re-read the account through an internal query rather than `db`, and
	// that second path used to answer with a wording of its own ("Account is
	// suspended or not initialized") that conflated two different facts.
	test("refuses a blocked account through an action, in the same words", async () => {
		const t = testConvex();
		stubDeploymentEnv();
		const user = await seedUser(t, {
			suspended: true,
			suspendedReason: "abuse"
		});
		const boxId = await seedBox(t, { user_id: user.clerkUserId });

		await expect(
			user.as.action(api.boxes.auth.createAuthorizationCode, {
				boxId,
				codeChallenge: "a".repeat(43),
				redirectUri: "https://box.dev.composery.cloud/ide/",
				type: "password"
			})
		).rejects.toMatchObject({
			data: { kind: "account_unavailable", detail: "abuse" }
		});
	});

	test("tells an action caller with no row that the account is not set up", async () => {
		const t = testConvex();
		stubDeploymentEnv();
		const owner = await seedUser(t);
		const boxId = await seedBox(t, { user_id: owner.clerkUserId });

		await expect(
			t
				.withIdentity({ subject: "ghost", email: "ghost@example.com" })
				.action(api.boxes.auth.createAuthorizationCode, {
					boxId,
					codeChallenge: "a".repeat(43),
					redirectUri: "https://box.dev.composery.cloud/ide/",
					type: "password"
				})
		).rejects.toThrow(/not initialized/);
	});

	test("hands the action side the same row a query would read", async () => {
		const t = testConvex();
		const user = await seedUser(t, { suspended: true });

		expect(
			await t.query(internal.users.userByClerkId, {
				clerkUserId: user.clerkUserId
			})
		).toMatchObject({ suspended: true });
	});
});

describe("role capabilities", () => {
	test("gives customers no staff powers", () => {
		expect(ROLE_CAPABILITIES.user).toEqual([]);
		expect(roleHasCapability("user", "staff_console")).toBe(false);
	});

	test("makes the current admin role explicitly fully privileged", () => {
		expect(roleHasCapability("admin", "staff_console")).toBe(true);
		expect(roleHasCapability("admin", "box_operations")).toBe(true);
		expect(roleHasCapability("admin", "user_moderation")).toBe(true);
		expect(roleHasCapability("admin", "settings_management")).toBe(true);
		expect(roleHasCapability("admin", "checkout_management")).toBe(true);
		expect(roleHasCapability("admin", "staff_alerts")).toBe(true);
	});

	test("derives alert recipients from explicit role capabilities", () => {
		expect(rolesWithCapability("staff_alerts")).toEqual(["admin"]);
	});

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
