"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
	AnimatedIconAnchor,
	AnimatedIconButton,
	AnimatedIconLink
} from "@/ui/animated-icon";
import { BoxStatusAction } from "@/ui/box/status-action";
import { ChangeSlugDialog } from "@/ui/box/change-slug-dialog";
import { MonitorCard } from "@/ui/box/monitor-card";
import { RepairDialog } from "@/ui/box/repair-dialog";
import { ResetDialog } from "@/ui/box/reset-dialog";
import { UpdateDialog } from "@/ui/box/update-dialog";
import { DEFAULT_RANGE, type MetricsRange } from "@/ui/box/metrics-chart";
import { BoxSnapshots } from "./box-snapshots";
import { Card, CardContent } from "@/ui/base/card";
import { buttonVariants } from "@/ui/base/button";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/ui/hooks/use-busy-action";
import { boxPath } from "@/convex/model/box/path";
import { BOX_PLANS } from "@/convex/model/box/plan";
import { formatDate } from "@/ui/lib/datetime";
import { failureNotice } from "@/convex/model/box/operation";
import { cn } from "@/ui/lib/utils";

export function BoxDetail({ boxId }: { boxId: string }) {
	const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);
	const detail = useQuery(api.owner.boxes.getById, { boxId });
	const metricsSeries = useQuery(
		api.owner.boxes.metricsSeries,
		detail ? { slug: detail.box.slug, range } : "skip"
	);
	const customerPortalUrl = useAction(api.owner.boxes.customerPortalUrl);
	const stopBox = useMutation(api.owner.boxes.stop);
	const startBox = useMutation(api.owner.boxes.start);
	const resetBox = useMutation(api.owner.boxes.reset);
	const retryCreate = useMutation(api.owner.boxes.retryCreate);
	const changeSlug = useMutation(api.owner.boxes.changeSlug);
	const repair = useAction(api.owner.boxes.repair);
	const updateBox = useAction(api.owner.boxes.update);
	const recoveryStatus = useAction(api.owner.boxes.recoveryStatus);
	const runtimeLogs = useAction(api.owner.boxes.runtimeLogs);
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
				failure={failureNotice(detail.failure, "owner")}
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
						disabled: busy === "create",
						onClick: () =>
							run("create", "Creating box", () =>
								retryCreate({ slug: box.slug })
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
						Comped {BOX_PLANS[box.plan].label}
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
						{BOX_PLANS[box.plan].label} - {billingLine}
					</AnimatedIconButton>
				)}
				<AnimatedIconAnchor
					className={cn(buttonVariants({ variant: "outline" }))}
					href={new URL("change-password", box.runtimeUrl).toString()}
					icon="lock"
					iconPosition="start"
					rel="noreferrer"
					target="_blank"
				>
					Change password
				</AnimatedIconAnchor>
				<AnimatedIconLink
					className={cn(buttonVariants({ variant: "outline" }))}
					href={`${boxPath(boxId)}/configuration`}
					icon="pen-tool"
					iconPosition="start"
				>
					Configure
				</AnimatedIconLink>
				<ChangeSlugDialog
					onSubmit={(newSlug) => changeSlug({ slug: box.slug, newSlug })}
					slug={box.slug}
				/>
				<BoxSnapshots
					plan={box.plan}
					slug={box.slug}
					split={box.snapshots}
					status={box.status}
				/>
				<UpdateDialog
					boxStatus={box.status}
					busy={busy}
					onUpdate={() =>
						run("update", "Updating box", () => updateBox({ slug: box.slug }))
					}
					runtime={detail.runtime}
					slug={box.slug}
					update={detail.update}
				/>
				<RepairDialog
					boxStatus={box.status}
					busy={busy}
					check={() => recoveryStatus({ slug: box.slug })}
					onRepair={() =>
						run("repair", "Repairing box", () => repair({ slug: box.slug }))
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
