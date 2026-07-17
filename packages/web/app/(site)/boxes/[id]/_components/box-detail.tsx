"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
	AnimatedIconAnchor,
	AnimatedIconButton
} from "@/components/animated-icon";
import { BoxStatusAction } from "@/components/box-status-action";
import { ChangeSlugDialog } from "@/components/change-slug-dialog";
import { MonitorCard } from "@/components/monitor-card";
import { RecoveryDialog } from "@/components/recovery-dialog";
import { RuntimeHealthNotice } from "@/components/runtime-health-notice";
import { DEFAULT_RANGE, type MetricsRange } from "@/components/metrics-chart";
import { BoxSnapshots } from "./box-snapshots";
import { Card, CardContent } from "@/components/card";
import { buttonVariants } from "@/components/button";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";
import { formatDate } from "@/lib/datetime";

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
	const recoveryStatus = useAction(api.user.boxes.recoveryStatus);
	const recover = useAction(api.user.boxes.recover);
	const runtimeHealth = useAction(api.user.boxes.runtimeHealth);
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
			<RuntimeHealthNotice
				check={() => runtimeHealth({ slug: box.slug })}
				detail="The server may still be running. Use Recovery to check each layer and try data-preserving repairs before resetting it."
				status={box.status}
			/>
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
					className={buttonVariants({ variant: "outline" })}
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
				<RecoveryDialog
					busy={busy}
					check={() => recoveryStatus({ slug: box.slug })}
					onRecover={(type) =>
						run(`recovery-${type}`, "Recovery started", () =>
							recover({ slug: box.slug, type })
						)
					}
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
