import { describe, expect, test } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

import { seedUser, testConvex, type Harness } from "../../../support/convex.ts";

// Support is given an email address, never a Clerk id, so the one search that
// has to work is the one that starts from an address - and it only works because
// the intent's owner is resolved back to a `users` row on the way.

async function seedIntent(
	t: Harness,
	seed: Partial<Doc<"box_checkout_intents">> & { user_id: string }
) {
	return await t.run(
		async (ctx) =>
			await ctx.db.insert("box_checkout_intents", {
				slug: "reserved",
				plan: "air",
				status: "active",
				created_at: 1,
				updated_at: 1,
				...seed
			})
	);
}

describe("finding an open checkout reservation", () => {
	test("lists every active reservation when nothing is searched for", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
		await seedIntent(t, { user_id: "someone", slug: "one" });
		await seedIntent(t, {
			user_id: "someone",
			slug: "two",
			status: "released"
		});

		const found = await admin.as.query(
			api.staff.checkout.activeCheckoutIntents,
			{
				query: ""
			}
		);

		expect(found.map((intent) => intent.slug)).toEqual(["one"]);
	});

	// Support is given an address, not a Clerk id, so the reservation has to be
	// findable by the one thing they hold. It is the owner's `users` row that
	// carries the address; the reservation itself only names the Clerk id.
	test("finds a reservation by its owner's email", async () => {
		const t = testConvex();
		const admin = await seedUser(t, { clerkUserId: "admin", role: "admin" });
		const owner = await seedUser(t, {
			clerkUserId: "owner",
			email: "person@example.com"
		});
		await seedIntent(t, { user_id: owner.clerkUserId, slug: "theirs" });

		const found = await admin.as.query(
			api.staff.checkout.activeCheckoutIntents,
			{ query: "  Person@Example.COM " }
		);

		expect(found.map((intent) => intent.slug)).toEqual(["theirs"]);
		expect(found[0].userEmail).toBe("person@example.com");
	});

	test("refuses a customer", async () => {
		const t = testConvex();
		const customer = await seedUser(t);

		await expect(
			customer.as.query(api.staff.checkout.activeCheckoutIntents, {})
		).rejects.toThrow(/Staff access required/);
	});
});
