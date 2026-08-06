"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { BoxStatusAction } from "@/components/box/status-action";
import { MonitorCard } from "@/components/box/monitor-card";
import { AgentStack } from "@/components/box/agent-stack";
import { SshDialog } from "@/components/box/ssh-dialog";
import { UsageCard } from "@/components/box/usage-card";
import { UpdateDialog } from "@/components/box/update-dialog";
import {
	DEFAULT_RANGE,
	type MetricsRange
} from "@/components/box/metrics-chart";
import { MoreMenu } from "./more-menu";
import { Card, CardContent } from "@/components/base/card";
import { Button } from "@/components/base/button";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";
import { BOX_PLANS } from "@/convex/model/box/plan";
import { formatDate } from "@/lib/datetime";
import { failureNotice } from "@/convex/model/box/operation";

export function BoxDetail({ boxId }: { boxId: string }) {
	const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);
	const [sshOpen, setSshOpen] = useState(false);
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

			<UsageCard readings={detail.usage} />

			{/* Every action lives in this one row: what an owner reaches for on
			    the left - the status action, connecting, updating - and the plan
			    and everything else on the right. */}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
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
					<Button
						disabled={box.status !== "running"}
						onClick={() => setSshOpen(true)}
						variant="outline"
					>
						<AgentStack />
						Connect remotely
					</Button>
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
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{box.comp ? (
						<AnimatedIconButton
							disabled
							icon="credit-card"
							iconPosition="start"
							variant="outline"
						>
							Comped - {BOX_PLANS[box.plan].label}
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
					<MoreMenu
						boxId={boxId}
						boxStatus={box.status}
						busy={busy}
						changeSlug={(newSlug) => changeSlug({ slug: box.slug, newSlug })}
						checkRepair={() => recoveryStatus({ slug: box.slug })}
						onRepair={() =>
							run("repair", "Repairing box", () => repair({ slug: box.slug }))
						}
						onReset={() =>
							run("reset", "Resetting box", () =>
								resetBox({
									slug: box.slug,
									confirmation: box.slug
								})
							)
						}
						plan={box.plan}
						repair={detail.repair}
						runtimeUrl={box.runtimeUrl}
						slug={box.slug}
						split={box.snapshots}
					/>
				</div>
			</div>

			<SshDialog
				host={new URL(box.runtimeUrl).host}
				onOpenChange={setSshOpen}
				open={sshOpen}
				slug={box.slug}
			/>
		</div>
	);
}
