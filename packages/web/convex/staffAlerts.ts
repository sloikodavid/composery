import { Resend, vOnEmailEventArgs, type EmailEvent } from "@convex-dev/resend";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalMutation,
	type DatabaseReader,
	type MutationCtx
} from "./_generated/server";
import { optionalEnv } from "./env";
import { rolesWithCapability, userHasCapability } from "./roles";
import { vStaffAlertSeverity } from "./schema";

const STAFF_ALERT_RECIPIENT_LIMIT = 50;
const STAFF_ALERT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const STAFF_ALERT_RETRY_BATCH = 20;
const STAFF_ALERT_PURGE_BATCH = 200;

export const resend: Resend = new Resend(components.resend, {
	onEmailEvent: internal.staffAlerts.recordEmailEvent,
	testMode: false
});

type AlertInput = {
	key: string;
	severity: Doc<"staff_alerts">["severity"];
	subject: string;
	text: string;
};

export function staffAlertEmailConfigured() {
	return Boolean(
		optionalEnv("RESEND_API_KEY") && optionalEnv("ALERT_EMAIL_FROM")
	);
}

export function staffAlertDeliveryTrackingConfigured() {
	return Boolean(optionalEnv("RESEND_WEBHOOK_SECRET"));
}

export function staffConsoleUrl(path = "/console") {
	const origin = optionalEnv("WEBSITE_ORIGIN")?.replace(/\/+$/g, "");
	return origin ? `${origin}${path}` : `the staff console (${path})`;
}

export async function staffAlertRecipientEmails(ctx: { db: DatabaseReader }) {
	const emails = new Set<string>();
	for (const role of rolesWithCapability("staff_alerts")) {
		const users = await ctx.db
			.query("users")
			.withIndex("role", (query) => query.eq("role", role))
			.collect();
		for (const user of users) {
			if (userHasCapability(user, "staff_alerts")) emails.add(user.email);
			if (emails.size >= STAFF_ALERT_RECIPIENT_LIMIT) return [...emails];
		}
	}
	return [...emails];
}

async function enqueueAlert(ctx: MutationCtx, alert: Doc<"staff_alerts">) {
	const from = optionalEnv("ALERT_EMAIL_FROM");
	if (!optionalEnv("RESEND_API_KEY") || !from) {
		await ctx.db.patch(alert._id, {
			queue_status: "disabled",
			updated_at: Date.now()
		});
		return;
	}

	const to = await staffAlertRecipientEmails(ctx);
	if (to.length === 0) {
		await ctx.db.patch(alert._id, {
			queue_status: "no_recipients",
			recipient_count: 0,
			updated_at: Date.now()
		});
		return;
	}

	try {
		const emailId = await resend.sendEmail(ctx, {
			from,
			to,
			subject: alert.subject,
			text: alert.text
		});
		await ctx.db.patch(alert._id, {
			queue_status: "queued",
			recipient_count: to.length,
			email_id: emailId,
			delivery_error: undefined,
			updated_at: Date.now()
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ctx.db.patch(alert._id, {
			queue_status: "queue_failed",
			recipient_count: to.length,
			delivery_error: message,
			updated_at: Date.now()
		});
		console.error("Failed to queue staff alert email", error);
	}
}

export async function sendStaffAlert(ctx: MutationCtx, input: AlertInput) {
	const existing = await ctx.db
		.query("staff_alerts")
		.withIndex("key", (query) => query.eq("key", input.key))
		.first();
	if (existing) return existing._id;

	const timestamp = Date.now();
	const alertId = await ctx.db.insert("staff_alerts", {
		...input,
		queue_status: "pending",
		recipient_count: 0,
		created_at: timestamp,
		updated_at: timestamp,
		purge_at: timestamp + STAFF_ALERT_RETENTION_MS
	});
	const alert = await ctx.db.get(alertId);
	if (alert) await enqueueAlert(ctx, alert);
	return alertId;
}

export const raise = internalMutation({
	args: {
		key: v.string(),
		severity: vStaffAlertSeverity,
		subject: v.string(),
		text: v.string()
	},
	handler: async (ctx, args) => {
		return await sendStaffAlert(ctx, args);
	}
});

function deliveryError(event: EmailEvent) {
	if (event.type === "email.bounced") return event.data.bounce.message;
	if (event.type === "email.failed") return event.data.failed.reason;
	if (event.type === "email.complained")
		return "Recipient marked the email as spam.";
	return undefined;
}

export function staffAlertDeliveryFailed(eventType: string | undefined) {
	return (
		eventType === "email.bounced" ||
		eventType === "email.failed" ||
		eventType === "email.complained"
	);
}

export const recordEmailEvent = internalMutation({
	args: vOnEmailEventArgs,
	handler: async (ctx, args) => {
		const alert = await ctx.db
			.query("staff_alerts")
			.withIndex("email_id", (query) => query.eq("email_id", args.id))
			.first();
		if (!alert) return;
		await ctx.db.patch(alert._id, {
			last_email_event: args.event.type,
			delivery_error: deliveryError(args.event),
			updated_at: Date.now()
		});
	}
});

export const retryPending = internalMutation({
	args: {},
	handler: async (ctx) => {
		if (!staffAlertEmailConfigured()) return 0;
		let retried = 0;
		for (const status of [
			"pending",
			"disabled",
			"no_recipients",
			"queue_failed"
		] as const) {
			const alerts = await ctx.db
				.query("staff_alerts")
				.withIndex("queue_status_created_at", (query) =>
					query.eq("queue_status", status)
				)
				.take(STAFF_ALERT_RETRY_BATCH - retried);
			for (const alert of alerts) {
				await enqueueAlert(ctx, alert);
				retried += 1;
			}
			if (retried >= STAFF_ALERT_RETRY_BATCH) break;
		}
		return retried;
	}
});

export const purgeExpired = internalMutation({
	args: {},
	handler: async (ctx) => {
		const alerts = await ctx.db
			.query("staff_alerts")
			.withIndex("purge_at", (query) =>
				query.gte("purge_at", 0).lte("purge_at", Date.now())
			)
			.take(STAFF_ALERT_PURGE_BATCH);
		for (const alert of alerts) await ctx.db.delete(alert._id);
		if (alerts.length === STAFF_ALERT_PURGE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.staffAlerts.purgeExpired, {});
		}
		return alerts.length;
	}
});
