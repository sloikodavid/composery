import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "@/convex/_generated/api";

import {
	seedUser,
	staffAlerts,
	stubDeploymentEnv,
	testConvex
} from "../../../support/convex.ts";

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

		await t.mutation(internal.staff.alerts.raise, ALERT);

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

		await t.mutation(internal.staff.alerts.raise, ALERT);

		expect(await staffAlerts(t)).toMatchObject([
			{ queue_status: "no_recipients", recipient_count: 0 }
		]);
	});

	test("keeps the alert when there is no sender, rather than losing it", async () => {
		const t = testConvex();
		await seedUser(t, { role: "admin" });

		await t.mutation(internal.staff.alerts.raise, ALERT);

		expect(await staffAlerts(t)).toMatchObject([
			{ queue_status: "disabled", subject: "Something needs a person" }
		]);
	});

	// The retry sweep is what makes the row above a delay rather than a loss.
	test("the retry sweep queues an alert once its sender appears", async () => {
		const t = testConvex();
		await seedUser(t, { role: "admin" });
		await t.mutation(internal.staff.alerts.raise, ALERT);

		stubSender();
		await t.mutation(internal.staff.alerts.retryPending, {});

		expect(await staffAlerts(t)).toMatchObject([
			{ queue_status: "queued", recipient_count: 1 }
		]);
	});

	test("a second alert on the same key does not send twice", async () => {
		stubSender();
		const t = testConvex();
		await seedUser(t, { role: "admin" });

		await t.mutation(internal.staff.alerts.raise, ALERT);
		await t.mutation(internal.staff.alerts.raise, {
			...ALERT,
			subject: "Same incident, said again"
		});

		expect(await staffAlerts(t)).toMatchObject([
			{ subject: "Something needs a person" }
		]);
	});
});

// What the console says about the channel itself. It is the one report a staff
// member can still read when no alert can reach them by email, so an entry in it
// has to mean something is actually wrong.
describe("alert delivery health", () => {
	async function staffHarness() {
		const t = testConvex();
		const admin = await seedUser(t, { role: "admin" });
		return { admin, t };
	}

	test("reports a configured, quiet deployment as healthy", async () => {
		stubSender();
		vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test");
		const { admin } = await staffHarness();

		expect(await admin.as.query(api.staff.alerts.health, {})).toMatchObject({
			sendingConfigured: true,
			deliveryTrackingConfigured: true,
			recipientCount: 1,
			recentIssues: []
		});
	});

	// Without the webhook secret no delivery event ever arrives, so an alert that
	// was handed over perfectly well sits at "sent" for ever. Ageing that into a
	// delivery issue, reported one alert at a time, buries the deployment's actual
	// problem - the missing secret - which the panel already states on its own
	// line.
	test("does not age a handed-over alert into an issue when nothing tracks delivery", async () => {
		stubSender();
		const { admin, t } = await staffHarness();
		await t.mutation(internal.staff.alerts.raise, ALERT);

		vi.setSystemTime(NOW + 60 * 60 * 1000);

		expect(await admin.as.query(api.staff.alerts.health, {})).toMatchObject({
			deliveryTrackingConfigured: false,
			recentIssues: []
		});
	});

	// The same alert on a deployment that can be told: silence past the window is
	// now genuinely unaccounted for.
	test("reports an alert Resend never accounted for once delivery is tracked", async () => {
		stubSender();
		vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test");
		const { admin, t } = await staffHarness();
		await t.mutation(internal.staff.alerts.raise, ALERT);

		vi.setSystemTime(NOW + 60 * 60 * 1000);

		expect(await admin.as.query(api.staff.alerts.health, {})).toMatchObject({
			recentIssues: [{ queueStatus: "queued", subject: ALERT.subject }]
		});
	});

	test("reports an alert this deployment could not hand over at all", async () => {
		const { admin, t } = await staffHarness();
		await t.mutation(internal.staff.alerts.raise, ALERT);

		expect(await admin.as.query(api.staff.alerts.health, {})).toMatchObject({
			sendingConfigured: false,
			recentIssues: [{ queueStatus: "disabled" }]
		});
	});

	test("refuses a customer the report", async () => {
		const t = testConvex();
		const customer = await seedUser(t, { role: "user" });

		await expect(
			customer.as.query(api.staff.alerts.health, {})
		).rejects.toThrow(/Staff access required/);
	});
});
