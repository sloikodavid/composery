"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { BoxStatusAction } from "@/components/box-status-action";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { ChangeSlugDialog } from "@/components/change-slug-dialog";
import { MonitorCard } from "@/components/monitor-card";
import { DEFAULT_RANGE, type MetricsRange } from "@/components/metrics-chart";
import { BoxSnapshots } from "./box-snapshots";
import { Button } from "@/components/button";
import { Card, CardContent } from "@/components/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from "@/components/dialog";
import { Input } from "@/components/input";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";
import { formatDate } from "@/lib/datetime";

export function BoxDetail({ slug }: { slug: string }) {
	const router = useRouter();
	const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);
	const detail = useQuery(api.user.boxes.getBySlug, { slug });
	const metricsSeries = useQuery(api.user.boxes.metricsSeries, { slug, range });
	const changePassword = useAction(api.user.boxes.changePassword);
	const customerPortalUrl = useAction(api.user.boxes.customerPortalUrl);
	const stopBox = useMutation(api.user.boxes.stop);
	const startBox = useMutation(api.user.boxes.start);
	const resetBox = useMutation(api.user.boxes.reset);
	const retryProvision = useMutation(api.user.boxes.retryProvision);
	const changeSlug = useMutation(api.user.boxes.changeSlug);
	const [resetConfirmation, setResetConfirmation] = useState("");
	const [resetOpen, setResetOpen] = useState(false);
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
				action={api.user.boxes.runtimeLogs}
				className="min-h-0 flex-1"
				note={detail.suspendedReason ?? undefined}
				onRangeChange={setRange}
				range={range}
				series={metricsSeries}
				slug={box.slug}
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
				<ChangePasswordDialog
					label={box.slug}
					onSubmit={(password) => changePassword({ slug: box.slug, password })}
				/>
				<ChangeSlugDialog
					onSubmit={async (newSlug) => {
						const result = await changeSlug({ slug: box.slug, newSlug });
						router.push(`/boxes/${result.slug}`);
					}}
				/>
				<BoxSnapshots slug={box.slug} status={box.status} />
				<AnimatedIconButton
					icon="delete"
					iconPosition="start"
					onClick={() => setResetOpen(true)}
					variant="destructive"
				>
					Reset
				</AnimatedIconButton>
			</div>

			<Dialog onOpenChange={setResetOpen} open={resetOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reset</DialogTitle>
						<DialogDescription>
							This permanently deletes the files and state in this box. Type{" "}
							<span className="font-medium text-foreground">{box.slug}</span> to
							confirm.
						</DialogDescription>
					</DialogHeader>
					<Input
						onChange={(event) => setResetConfirmation(event.target.value)}
						placeholder={box.slug}
						value={resetConfirmation}
					/>
					<DialogFooter>
						<DialogClose render={<Button variant="outline">Cancel</Button>} />
						<Button
							disabled={busy === "reset" || resetConfirmation !== box.slug}
							onClick={() =>
								run("reset", "Resetting box", async () => {
									await resetBox({
										slug: box.slug,
										confirmation: resetConfirmation
									});
									setResetConfirmation("");
									setResetOpen(false);
								})
							}
							variant="destructive"
						>
							Reset
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
