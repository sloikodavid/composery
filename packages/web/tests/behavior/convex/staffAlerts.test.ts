import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "@/convex/_generated/api";

import {
	seedUser,
	staffAlerts,
	stubDeploymentEnv,
	testConvex
} from "../../support/convex.ts";

// The queue side of a staff alert: who it goes to, and what the row says
// afterwards. Every other suite runs with no Resend key at all, so the branch
// that actually hands an alert to the component - the one every incident in
// production takes - was only ever exercised in its disabled form.

const NOW = Date.UTC(2026, 6, 28, 9, 0, 0);

function stubSender() {
	vi.stubEnv("RESEND_API_KEY", "re_test");
	vi.stubEnv("ALERT_EMAIL_FROM", "Composery <alerts@mail.composery.test>");
}

const ALERT = {
	key: "test-alert",
	severity: "warning" as const,
	subject: "Something needs a person",
	text: "The details."
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	stubDeploymentEnv();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("queueing a staff alert", () => {
	test("hands it to Resend once for every admin", async () => {
		stubSender();
		const t = testConvex();
		await seedUser(t, { clerkUserId: "admin_one", role: "admin" });
		await seedUser(t, { clerkUserId: "admin_two", role: "admin" });
		await seedUser(t, { clerkUserId: "customer", role: "user" });

		await t.mutation(internal.staffAlerts.raise, ALERT);

		expect(await staffAlerts(t)).toMatchObject([
			{
				key: "test-alert",
				queue_status: "queued",
				recipient_count: 2,
				email_id: expect.any(String)
			}
		]);
	});

	test("records that a configured deployment has nobody to tell", async () => {
		stubSender();
		const t = testConvex();
		await seedUser(t, { role: "user" });

		await t.mutation(internal.staffAlerts.raise, ALERT);

		expect(await staffAlerts(t)).toMatchObject([
			{ queue_status: "no_recipients", recipient_count: 0 }
		]);
	});

	test("keeps the alert when there is no sender, rather than losing it", async () => {
		const t = testConvex();
		await seedUser(t, { role: "admin" });

		await t.mutation(internal.staffAlerts.raise, ALERT);

		expect(await staffAlerts(t)).toMatchObject([
			{ queue_status: "disabled", subject: "Something needs a person" }
		]);
	});

	// The retry sweep is what makes the row above a delay rather than a loss.
	test("the retry sweep queues an alert once its sender appears", async () => {
		const t = testConvex();
		await seedUser(t, { role: "admin" });
		await t.mutation(internal.staffAlerts.raise, ALERT);

		stubSender();
		await t.mutation(internal.staffAlerts.retryPending, {});

		expect(await staffAlerts(t)).toMatchObject([
			{ queue_status: "queued", recipient_count: 1 }
		]);
	});

	test("a second alert on the same key does not send twice", async () => {
		stubSender();
		const t = testConvex();
		await seedUser(t, { role: "admin" });

		await t.mutation(internal.staffAlerts.raise, ALERT);
		await t.mutation(internal.staffAlerts.raise, {
			...ALERT,
			subject: "Same incident, said again"
		});

		expect(await staffAlerts(t)).toMatchObject([
			{ subject: "Something needs a person" }
		]);
	});
});
