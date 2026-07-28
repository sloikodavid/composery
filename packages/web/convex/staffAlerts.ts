import { Resend, vOnEmailEventArgs, type EmailEvent } from "@convex-dev/resend";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalMutation,
	type DatabaseReader,
	type MutationCtx
} from "./_generated/server";
import { optionalEnv, optionalWebsiteUrl } from "./env";
import { rolesWithCapability, userHasCapability } from "./roles";
import { vStaffAlertSeverity } from "./schema";

const STAFF_ALERT_RECIPIENT_LIMIT = 50;
// Exported only because the operator runbook states it: `// runbook:` binds the
// number in the doc to this constant, and the test that pins the pair reads the
// exported value.
// runbook: Staff-alert record retention
export const STAFF_ALERT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const STAFF_ALERT_RETRY_BATCH = 20;
const STAFF_ALERT_PURGE_BATCH = 200;

// Built per use rather than once at module load.
//
// The client captures `RESEND_API_KEY` when it is constructed, while every "is
// email configured" answer below reads the variable when it is asked. A client
// built at import time makes those two disagree for as long as a deployment's
// module cache outlives an environment change - the configured-looking half
// reporting healthy while the sending half throws "API key is not set". One of
// them had to move, and this one is free to move: a client is a component handle
// beside a plain config object, and the config it sends is assembled per call
// regardless.
export function resendClient(): Resend {
	return new Resend(components.resend, {
		onEmailEvent: internal.staffAlerts.recordEmailEvent,
		testMode: false
	});
}

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
	return optionalWebsiteUrl(path) ?? `the staff console (${path})`;
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
		const emailId = await resendClient().sendEmail(ctx, {
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

function recipients(to: string | string[]) {
	return Array.isArray(to) ? to.join(", ") : to;
}

// A delivery failure for mail that is not a staff alert - which, since this
// deployment sends exactly two kinds, means a box owner notice (convex/ownerEmail.ts).
//
// Owner notices carry no row of their own, on the argument that an individual
// bounce has no action behind it: the address came from Clerk, there is no
// second channel, and the box has already been deleted or suspended either way.
// A complaint is the exception, and it is the reason this exists. Owner mail and
// staff alerts deliberately share one sender domain and therefore one sending
// reputation, so an owner marking a notice as spam degrades the channel the
// alerts themselves ride on. Left unreported, that arrives later as staff alerts
// mysteriously failing to deliver - the symptom, without the cause, at the exact
// moment the alert channel is the thing that is broken.
//
// Everything needed is on the event: Resend echoes the recipient and the
// subject, and an owner notice's subject names its box.
function undeliveredNoticeAlert(
	id: string,
	event: EmailEvent
): AlertInput | undefined {
	if (!staffAlertDeliveryFailed(event.type)) return undefined;

	const complaint = event.type === "email.complained";
	return {
		// Per message rather than per time window. The volume is bounded by real
		// lifecycle events - a box is deleted or suspended once - so a burst of
		// these is not noise to be collapsed, it is the news.
		key: `owner-notice-undelivered:${id}`,
		severity: complaint ? "critical" : "warning",
		subject: complaint
			? "A box owner marked a Composery notice as spam"
			: "A box owner notice was not delivered",
		text: `"${event.data.subject}" was not delivered to ${recipients(event.data.to)}.\n\n${
			deliveryError(event) ?? event.type
		}\n\n${
			complaint
				? "A complaint is a sending-reputation problem, not one owner's problem. Owner notices and these alerts share a verified sender domain, so repeated complaints degrade staff alert delivery too. Review what was sent and whether the two streams still belong on one domain."
				: "The owner was not told what happened to their box. Notices are not retried - the box has since moved on - so reaching them, if it matters, is a manual step."
		}\n\n${staffConsoleUrl()}`
	};
}

export const recordEmailEvent = internalMutation({
	args: vOnEmailEventArgs,
	handler: async (ctx, args) => {
		const alert = await ctx.db
			.query("staff_alerts")
			.withIndex("email_id", (query) => query.eq("email_id", args.id))
			.first();
		if (!alert) {
			const notice = undeliveredNoticeAlert(args.id, args.event);
			if (notice) await sendStaffAlert(ctx, notice);
			return;
		}
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
