"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
	AnimatedIconAnchor,
	AnimatedIconButton
} from "@/components/animated-icon";
import { BoxStatusAction } from "@/components/boxes/status-action";
import { ChangeSlugDialog } from "@/components/boxes/change-slug-dialog";
import { MonitorCard } from "@/components/boxes/monitor-card";
import { RepairDialog } from "@/components/boxes/repair-dialog";
import { ResetDialog } from "@/components/boxes/reset-dialog";
import {
	DEFAULT_RANGE,
	type MetricsRange
} from "@/components/boxes/metrics-chart";
import { BoxSnapshots } from "./box-snapshots";
import { Card, CardContent } from "@/components/base/card";
import { buttonVariants } from "@/components/base/button";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export function BoxDetail({ boxId }: { boxId: string }) {
	const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);
	const detail = useQuery(api.user.boxes.getById, { boxId });
	const metricsSeries = useQuery(
		api.user.boxes.metricsSeries,
		detail ? { slug: detail.box.slug, range } : "skip"
	);
	const customerPortalUrl = useAction(api.user.boxes.customerPortalUrl);
	const stopBox = useMutation(api.user.boxes.stop);
	const startBox = useMutation(api.user.boxes.start);
	const resetBox = useMutation(api.user.boxes.reset);
	const retryProvision = useMutation(api.user.boxes.retryProvision);
	const changeSlug = useMutation(api.user.boxes.changeSlug);
	const repair = useAction(api.user.boxes.repair);
	const recoveryStatus = useAction(api.user.boxes.recoveryStatus);
	const runtimeLogs = useAction(api.user.boxes.runtimeLogs);
	const { busy, run } = useBusyAction();

	if (detail === undefined) return null;

	if (!detail) {
		return (
			<Card className="page-fade-in">
				<CardContent>
					<p className="text-sm text-muted-foreground">Box not found.</p>
				</CardContent>
			</Card>
		);
	}

	const { box, subscription } = detail;
	const periodEnd = formatDate(subscription?.currentPeriodEnd);
	const billingLine = subscription?.cancelAtPeriodEnd
		? periodEnd
			? `Cancels ${periodEnd}`
			: "Cancellation scheduled"
		: periodEnd
			? `Renews ${periodEnd}`
			: "Billing date unavailable";

	return (
		// 10rem + 1px is the page chrome above and below this column (header
		// incl. its border, main padding, breadcrumb row, gaps), so the card
		// fills the rest of the viewport without making the page scroll.
		<div className="page-fade-in flex h-[calc(100dvh-10rem-1px)] min-h-112 flex-col gap-4">
			<MonitorCard
				className="min-h-0 flex-1"
				loadLogs={() => runtimeLogs({ slug: box.slug })}
				note={detail.suspendedReason ?? undefined}
				onRangeChange={setRange}
				range={range}
				series={metricsSeries}
				status={box.status}
			/>

			<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
				<BoxStatusAction
					retry={{
						disabled: busy === "retry",
						onClick: () =>
							run("retry", "Retrying provisioning", () =>
								retryProvision({ slug: box.slug })
							)
					}}
					start={{
						disabled: busy === "start",
						onClick: () =>
							run("start", "Starting box", () => startBox({ slug: box.slug }))
					}}
					status={box.status}
					stop={{
						onConfirm: () =>
							run("stop", "Stopping box", () => stopBox({ slug: box.slug }))
					}}
				/>
				{box.comp ? (
					<AnimatedIconButton
						disabled
						icon="credit-card"
						iconPosition="start"
						variant="outline"
					>
						Comped plan
					</AnimatedIconButton>
				) : (
					<AnimatedIconButton
						disabled={busy === "portal"}
						icon="credit-card"
						iconPosition="start"
						onClick={() =>
							run("portal", null, async () => {
								const portal = await customerPortalUrl({ slug: box.slug });
								window.location.assign(portal.url);
							})
						}
						variant="outline"
					>
						{billingLine}
					</AnimatedIconButton>
				)}
				<AnimatedIconAnchor
					className={cn(buttonVariants({ variant: "outline" }))}
					href={new URL("/change-password", box.runtimeUrl).toString()}
					icon="lock"
					iconPosition="start"
					rel="noreferrer"
					target="_blank"
				>
					Change password
				</AnimatedIconAnchor>
				<ChangeSlugDialog
					onSubmit={(newSlug) => changeSlug({ slug: box.slug, newSlug })}
				/>
				<BoxSnapshots slug={box.slug} status={box.status} />
				<RepairDialog
					boxStatus={box.status}
					busy={busy}
					check={() => recoveryStatus({ slug: box.slug })}
					onRepair={() =>
						run("repair", "Repair started", () => repair({ slug: box.slug }))
					}
					repair={detail.repair}
					slug={box.slug}
				/>
				<ResetDialog
					busy={busy}
					onReset={() =>
						run("reset", "Resetting box", () =>
							resetBox({ slug: box.slug, confirmation: box.slug })
						)
					}
					slug={box.slug}
				/>
			</div>
		</div>
	);
}
