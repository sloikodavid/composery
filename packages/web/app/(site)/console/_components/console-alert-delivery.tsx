"use client";

import { useQuery } from "convex/react";
import { TriangleAlertIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatDateTime } from "@/lib/datetime";

// Only renders when the alert channel itself is unhealthy, so a working
// deployment shows nothing here.
//
// It names the alerts rather than counting them: this panel is read at the one
// moment staff cannot rely on being told anything by email, and a bare count
// would send whoever is reading it to the Convex dashboard for the subject line
// it already has in hand.
export function ConsoleAlertDelivery() {
	const health = useQuery(api.staff.alerts.health, {});
	if (!health) return null;

	const configurationIssues = [
		health.sendingConfigured ? null : "Resend sending is not configured",
		health.recipientCount === 0 ? "no alert recipient is configured" : null,
		health.deliveryTrackingConfigured
			? null
			: "Resend delivery tracking is not configured"
	].filter((issue) => issue !== null);

	if (configurationIssues.length === 0 && health.recentIssues.length === 0) {
		return null;
	}

	return (
		<div className="rounded-2xl border border-destructive/40 bg-card px-4 py-3">
			<div className="flex items-start gap-2">
				<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
				<div className="min-w-0 space-y-2 text-sm">
					<p className="font-medium text-foreground">Staff alert delivery</p>
					{configurationIssues.length > 0 ? (
						<p className="text-muted-foreground">
							{configurationIssues.join("; ")}.
						</p>
					) : null}
					{health.recentIssues.length > 0 ? (
						<ul className="space-y-1 text-muted-foreground">
							{health.recentIssues.map((issue) => (
								<li className="min-w-0" key={issue.id}>
									<span className="text-foreground">{issue.subject}</span>{" "}
									<span className="wrap-break-word whitespace-normal">
										{issue.error ??
											issue.lastEmailEvent ??
											`queue: ${issue.queueStatus}`}
									</span>{" "}
									<span className="text-xs">
										{formatDateTime(issue.createdAt)}
									</span>
								</li>
							))}
						</ul>
					) : null}
				</div>
			</div>
		</div>
	);
}
