import { describe, expect, test } from "vitest";
import crons from "@/convex/crons";

// The catalogue sync is the floor under a webhook that was missed or never sent:
// `billing/polar.ts#boxPricing` reads Polar's synced products and reports null
// when it finds none, and the pricing page then shows no figure at all. Deleting
// this cron therefore costs the site its prices without failing anything else,
// which is exactly the kind of silence a scheduled job earns a test for.
describe("scheduled jobs", () => {
	test("keeps the Polar catalogue synced for the pricing page", () => {
		const job = crons.crons["sync Polar products"];

		expect(job).toBeDefined();
		expect(job.schedule).toMatchObject({ type: "hourly" });
	});
});
