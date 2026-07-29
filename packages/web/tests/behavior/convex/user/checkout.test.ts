import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Polar is the one thing here that cannot be exercised: `createCheckout` opens a
// real hosted checkout session. Stubbing the module rather than `fetch` keeps the
// test about what this action decides - which plan and interval it sells, what it
// reserves, what it carries into the order - instead of about Polar's wire
// format, which is Polar's to change.
const createCheckoutSession = vi.fn();
vi.mock("@/convex/billing/polar", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/convex/billing/polar")>();
	return {
		...actual,
		polarServer: () => ({ createCheckoutSession }),
		selectPolarCheckoutProduct: vi.fn()
	};
});

const { api } = await import("@/convex/_generated/api");
const { seedSettings, seedUser, stubDeploymentEnv, testConvex } =
	await import("../../../support/convex.ts");

const NOW = Date.UTC(2026, 6, 28, 10, 0, 0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
	createCheckoutSession.mockReset();
	createCheckoutSession.mockResolvedValue({
		customerId: "cus_1",
		expiresAt: new Date(NOW + 60_000),
		id: "checkout_1",
		status: "open",
		url: "https://polar.test/checkout_1"
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("opening a checkout", () => {
	test("reserves the slug for the plan being bought", async () => {
		const t = testConvex();
		await seedSettings(t);
		const user = await seedUser(t);

		const result = await user.as.action(api.user.checkout.createCheckout, {
			billingInterval: "year",
			plan: "pro",
			slug: "my-box"
		});

		expect(result).toMatchObject({ slug: "my-box" });
		const intent = await t.run(
			async (ctx) => await ctx.db.query("box_checkout_intents").first()
		);
		expect(intent).toMatchObject({
			plan: "pro",
			slug: "my-box",
			status: "active",
			polar_checkout_id: "checkout_1"
		});
	});

	// Only the chosen plan's two products reach Polar, so a customer can
	// reconsider monthly against annual in checkout but cannot walk out having
	// bought a plan the reservation was not admitted for.
	test("offers only the chosen plan's two intervals, selected one first", async () => {
		const t = testConvex();
		await seedSettings(t);
		const user = await seedUser(t);

		await user.as.action(api.user.checkout.createCheckout, {
			billingInterval: "month",
			plan: "air",
			slug: "my-box"
		});

		expect(createCheckoutSession.mock.calls[0]?.[1]).toMatchObject({
			productIds: ["air-monthly", "air-annual"]
		});
	});

	test("refuses a slug that is not available", async () => {
		const t = testConvex();
		await seedSettings(t);
		const owner = await seedUser(t);
		const other = await seedUser(t, {
			clerkUserId: "other",
			email: "other@example.com"
		});
		await t.run(async (ctx) => {
			await ctx.db.insert("boxes", {
				user_id: other.clerkUserId,
				slug: "my-box",
				plan: "air",
				manual_snapshot_cap: 0,
				status: "running",
				created_at: NOW - 1000,
				updated_at: NOW - 1000
			});
		});

		await expect(
			owner.as.action(api.user.checkout.createCheckout, {
				billingInterval: "month",
				plan: "air",
				slug: "my-box"
			})
		).rejects.toThrow(/unavailable/i);
		expect(createCheckoutSession).not.toHaveBeenCalled();
	});

	// A reservation that could not be paired with a Polar session must not keep
	// holding the slug and a capacity slot for an hour.
	test("releases the reservation when Polar cannot open a session", async () => {
		const t = testConvex();
		await seedSettings(t);
		const user = await seedUser(t);
		createCheckoutSession.mockRejectedValue(new Error("Polar is down"));

		await expect(
			user.as.action(api.user.checkout.createCheckout, {
				billingInterval: "month",
				plan: "air",
				slug: "my-box"
			})
		).rejects.toThrow("Polar is down");

		const intent = await t.run(
			async (ctx) => await ctx.db.query("box_checkout_intents").first()
		);
		expect(intent).toMatchObject({
			status: "released",
			release_reason: "polar_checkout_creation_failed"
		});
	});
});
