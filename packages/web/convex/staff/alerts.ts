import { query } from "../_generated/server";
import { requireCapability } from "../authorization";
import {
	staffAlertDeliveryFailed,
	staffAlertDeliveryTrackingConfigured,
	staffAlertEmailConfigured,
	staffAlertRecipientEmails
} from "../staffAlerts";

const RECENT_ALERT_LIMIT = 50;
const STALE_DELIVERY_MS = 30 * 60 * 1000;

export const health = query({
	args: {},
	handler: async (ctx) => {
		await requireCapability(ctx, "staff_console");
		const recipientEmails = await staffAlertRecipientEmails(ctx);
		const recent = await ctx.db
			.query("staff_alerts")
			.withIndex("created_at")
			.order("desc")
			.take(RECENT_ALERT_LIMIT);
		const now = Date.now();

		return {
			sendingConfigured: staffAlertEmailConfigured(),
			deliveryTrackingConfigured: staffAlertDeliveryTrackingConfigured(),
			recipientCount: recipientEmails.length,
			recentIssues: recent
				.filter(
					(alert) =>
						alert.queue_status !== "queued" ||
						staffAlertDeliveryFailed(alert.last_email_event) ||
						alert.last_email_event === "email.delivery_delayed" ||
						(now - alert.created_at >= STALE_DELIVERY_MS &&
							(!alert.last_email_event ||
								alert.last_email_event === "email.sent"))
				)
				.slice(0, 10)
				.map((alert) => ({
					id: alert._id,
					subject: alert.subject,
					queueStatus: alert.queue_status,
					lastEmailEvent: alert.last_email_event ?? null,
					error: alert.delivery_error ?? null,
					createdAt: alert.created_at
				}))
		};
	}
});
