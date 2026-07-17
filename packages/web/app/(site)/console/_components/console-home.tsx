"use client";

import { useMutation, useQuery } from "convex/react";
import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConsoleStats } from "./console-stats";
import { ConsoleCheckoutLimit } from "./console-checkout-limit";
import { ConsoleCapacity } from "./console-capacity";
import { ConsoleGrantBox } from "./console-grant-box";
import { ConsoleSnapshotPolicy } from "./console-snapshot-policy";
import { ConsoleThresholds } from "./console-thresholds";
import { FlagsTable } from "@/components/flags-table";
import { DismissButton } from "@/components/dismiss-button";
import {
	DEFAULT_METRIC,
	DEFAULT_RANGE,
	MetricSelect,
	MetricsLineChart,
	MetricsRangeSelect,
	metricField,
	type MetricsRange
} from "@/components/metrics-chart";
import { OpenInConvex } from "@/components/open-in-convex";
import { OpenInHetzner } from "@/components/open-in-hetzner";
import { OpenInPolar } from "@/components/open-in-polar";
import { SortHeader } from "@/components/sort-header";
import { StatusText } from "@/components/status-text";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableLoadingRow,
	TableRow
} from "@/components/table";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";
import { useTableSort } from "@/hooks/use-table-sort";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { consoleBoxPath } from "@/lib/box-route";

type ConsoleBox = NonNullable<
	ReturnType<typeof useQuery<typeof api.staff.boxes.searchBoxes>>
>[number];

type CheckoutIntent = NonNullable<
	ReturnType<typeof useQuery<typeof api.staff.checkout.activeCheckoutIntents>>
>[number];

const CONSOLE_BOX_SORT = {
	slug: (box: ConsoleBox) => box.slug,
	user: (box: ConsoleBox) => box.userEmail || box.userId,
	createdAt: (box: ConsoleBox) => box.createdAt,
	status: (box: ConsoleBox) => box.status
};

const INTENT_SORT = {
	slug: (intent: CheckoutIntent) => intent.slug,
	user: (intent: CheckoutIntent) => intent.userEmail || intent.userId,
	status: (intent: CheckoutIntent) => intent.polarCheckoutStatus ?? "active",
	createdAt: (intent: CheckoutIntent) => intent.createdAt,
	expiresAt: (intent: CheckoutIntent) => intent.expiresAt ?? 0
};

type FailedOperation = NonNullable<
	ReturnType<typeof useQuery<typeof api.staff.boxes.recentFailedOperations>>
>[number];

function AlertDeliveryPanel() {
	const health = useQuery(api.staff.alerts.health, {});
	if (!health) return null;
	const configurationIssues = [
		!health.sendingConfigured ? "Resend sending is not configured" : null,
		health.recipientCount === 0 ? "no alert recipient is configured" : null,
		!health.deliveryTrackingConfigured
			? "Resend delivery tracking is not configured"
			: null
	].filter(Boolean);
	if (configurationIssues.length === 0 && health.recentIssues.length === 0) {
		return null;
	}

	return (
		<div className="rounded-2xl border border-destructive/40 bg-card px-4 py-3">
			<div className="flex items-start gap-2">
				<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
				<div className="min-w-0 text-sm">
					<p className="font-medium text-foreground">Staff alert delivery</p>
					{configurationIssues.length > 0 ? (
						<p className="text-muted-foreground">
							{configurationIssues.join("; ")}.
						</p>
					) : null}
					{health.recentIssues.length > 0 ? (
						<p className="text-muted-foreground">
							{health.recentIssues.length} recent alert
							{health.recentIssues.length === 1 ? " has" : "s have"} a queue or
							delivery issue. Review the <code>staff_alerts</code> table and
							Resend.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}

// Only renders when something is actually wrong, so a healthy console stays
// clean and this reads as an alert rather than a permanent panel.
function NeedsAttentionPanel() {
	const failures = useQuery(api.staff.boxes.recentFailedOperations, {});
	const dismissFailure = useMutation(api.staff.boxes.dismissFailedOperation);
	const dismissAllFailures = useMutation(
		api.staff.boxes.dismissAllFailedOperations
	);
	const { busy, run } = useBusyAction();
	if (!failures || failures.length === 0) return null;

	return (
		<div className="overflow-hidden rounded-2xl border border-destructive/40 bg-card">
			<div className="flex flex-wrap items-center gap-x-2 border-b border-border px-4 py-3">
				<TriangleAlertIcon className="size-4 text-destructive" />
				<span className="text-sm font-medium text-foreground">
					Needs attention
				</span>
				<span className="text-sm text-muted-foreground">
					{failures.length} failed operation{failures.length === 1 ? "" : "s"}{" "}
					in the last 7 days
				</span>
			</div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-full min-w-48 pl-4">Operation</TableHead>
						<TableHead>Box</TableHead>
						<TableHead>When</TableHead>
						<TableHead className="pr-4 text-right">
							<div className="flex items-center justify-end gap-1">
								<DismissButton
									disabled={busy !== null}
									onClick={() =>
										run("dismiss-all-failures", "Messages dismissed", () =>
											dismissAllFailures({})
										)
									}
								/>
								<OpenInConvex
									field="status"
									iconOnly
									table="box_operations"
									value="failed"
								/>
							</div>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody className="page-fade-in">
					{failures.map((failure: FailedOperation) => (
						<TableRow
							className={failure.lastError ? "[&>td]:align-top" : undefined}
							key={failure.id}
						>
							<TableCell className="max-w-0 pl-4">
								<div className="min-w-0">
									<p className="font-medium text-foreground">{failure.type}</p>
									{failure.lastError ? (
										<p className="wrap-break-word whitespace-normal text-muted-foreground">
											{failure.lastError}
										</p>
									) : null}
								</div>
							</TableCell>
							<TableCell>
								{failure.slug ? (
									<Link
										className="font-medium text-foreground hover:underline"
										href={consoleBoxPath(failure.boxId)}
									>
										{failure.slug}
									</Link>
								) : (
									<span className="text-muted-foreground">unknown</span>
								)}
							</TableCell>
							<TableCell>{formatDateTime(failure.createdAt)}</TableCell>
							<TableCell className="pr-4 text-right">
								<div className="flex items-center justify-end gap-1">
									<DismissButton
										disabled={busy !== null}
										onClick={() =>
											run(
												`dismiss-failure-${failure.id}`,
												"Message dismissed",
												() =>
													dismissFailure({
														operationId: failure.id
													})
											)
										}
									/>
									<OpenInConvex
										iconOnly
										label={`Open ${failure.type} operation in Convex`}
										table="box_operations"
										value={failure.id}
									/>
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

// The all-boxes overlay: the top boxes ranked by the selected metric's latest
// rolled-up hour, so a fleet of any size stays readable.
function GlobalMetricsPanel() {
	const [metricKey, setMetricKey] = useState(DEFAULT_METRIC);
	const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);
	const series = useQuery(api.staff.metrics.series, {
		metric: metricField(metricKey),
		range
	});

	return (
		<div className="relative rounded-2xl border border-border bg-card">
			<div className="absolute top-3 left-3 z-10 flex gap-2">
				<MetricSelect onChange={setMetricKey} value={metricKey} />
				<MetricsRangeSelect onChange={setRange} value={range} />
			</div>
			<div className="p-4 pt-12">
				<MetricsLineChart
					className="h-78"
					metricKey={metricKey}
					range={range}
					series={series}
				/>
			</div>
		</div>
	);
}

export function ConsoleHome() {
	const [query, setQuery] = useState("");
	const boxes = useQuery(api.staff.boxes.searchBoxes, { query });
	const intents = useQuery(api.staff.checkout.activeCheckoutIntents, {
		query
	});
	const settings = useQuery(api.staff.settings.get);
	const flags = useQuery(api.staff.metrics.flags, {});
	const setCheckoutEnabled = useMutation(api.staff.settings.setCheckoutEnabled);
	const setAutoSuspendEnabled = useMutation(
		api.staff.settings.setAutoSuspendEnabled
	);
	const releaseIntent = useMutation(api.staff.checkout.releaseCheckoutIntent);
	const { run } = useBusyAction();
	const { sort: boxSort, sortedRows: sortedBoxes } = useTableSort(
		boxes ?? [],
		CONSOLE_BOX_SORT
	);
	const { sort: intentSort, sortedRows: sortedIntents } = useTableSort(
		intents ?? [],
		INTENT_SORT
	);

	return (
		<div className="space-y-6">
			<ConsoleStats />

			<NeedsAttentionPanel />
			<AlertDeliveryPanel />

			<div className="space-y-3">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<Input
						className="sm:max-w-sm"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search ID, slug, user, subscription"
						value={query}
					/>
					<div className="grid grid-cols-2 gap-2 sm:flex">
						<AnimatedIconButton
							disabled={settings === undefined}
							icon="credit-card"
							iconPosition="start"
							onClick={() =>
								run("toggle", "Checkout updated", () =>
									setCheckoutEnabled({
										enabled: !(settings?.checkoutEnabled ?? true)
									})
								)
							}
							variant="outline"
						>
							{settings?.checkoutEnabled === false
								? "Enable checkout"
								: "Disable checkout"}
						</AnimatedIconButton>
						<AnimatedIconButton
							disabled={settings === undefined}
							icon="construction"
							iconPosition="start"
							onClick={() =>
								run("toggle-auto-suspend", "Auto-suspend updated", () =>
									setAutoSuspendEnabled({
										enabled: !(settings?.autoSuspendEnabled ?? false)
									})
								)
							}
							variant="outline"
						>
							{settings?.autoSuspendEnabled
								? "Disable auto-suspend"
								: "Enable auto-suspend"}
						</AnimatedIconButton>
					</div>
				</div>

				<div className="overflow-hidden rounded-2xl border border-border bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-full min-w-48 pl-4">
									<SortHeader label="Box" sort={boxSort} sortKey="slug" />
								</TableHead>
								<TableHead>
									<SortHeader label="User" sort={boxSort} sortKey="user" />
								</TableHead>
								<TableHead>
									<SortHeader
										label="Created"
										sort={boxSort}
										sortKey="createdAt"
									/>
								</TableHead>
								<TableHead>
									<SortHeader label="Status" sort={boxSort} sortKey="status" />
								</TableHead>
								<TableHead className="pr-4 text-right">
									<div className="flex items-center justify-end gap-1">
										<OpenInHetzner iconOnly label="Open servers in Hetzner" />
										<OpenInPolar iconOnly label="Open customers in Polar" />
										<OpenInConvex iconOnly table="boxes" />
									</div>
								</TableHead>
							</TableRow>
						</TableHeader>
						{boxes === undefined ? (
							<TableBody>
								<TableLoadingRow span={5} />
							</TableBody>
						) : boxes.length > 0 ? (
							<TableBody className="page-fade-in">
								{sortedBoxes.map((box: ConsoleBox) => (
									<TableRow
										className="h-14 has-[[data-link]:hover]:bg-muted/50"
										key={box.id}
									>
										<TableCell className="relative max-w-0 p-0">
											<Link
												className="absolute inset-0 flex flex-col items-start justify-center pl-4"
												data-link
												href={consoleBoxPath(box.id)}
											>
												<span className="truncate font-medium text-foreground">
													{box.slug}
												</span>
												<span className="truncate text-xs text-muted-foreground">
													{box.id}
												</span>
											</Link>
										</TableCell>
										<TableCell>{box.userEmail || box.userId}</TableCell>
										<TableCell>{formatDate(box.createdAt)}</TableCell>
										<TableCell>
											<StatusText status={box.status} />
										</TableCell>
										<TableCell className="pr-4">
											<div className="flex items-center justify-end gap-1">
												<OpenInHetzner
													iconOnly
													label={`Open ${box.slug} server in Hetzner`}
													serverId={box.hetznerServerId ?? null}
												/>
												<OpenInPolar
													iconOnly
													label={`Open ${box.slug} subscription in Polar`}
													subscriptionId={box.polarSubscriptionId}
												/>
												<OpenInConvex
													iconOnly
													label={`Open ${box.slug} in Convex`}
													table="boxes"
													value={box.id}
												/>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						) : (
							<TableBody>
								<TableEmptyRow span={5}>No boxes found.</TableEmptyRow>
							</TableBody>
						)}
					</Table>
				</div>
			</div>

			<div className="grid gap-3">
				{settings ? (
					<ConsoleCapacity
						capacity={settings.capacity}
						serverLimit={settings.hetznerServerLimit}
						snapshotLimit={settings.hetznerSnapshotLimit}
					/>
				) : null}
				<ConsoleGrantBox />
				<ConsoleCheckoutLimit max={settings?.maxActiveCheckoutIntentsPerUser} />
				<ConsoleThresholds thresholds={settings?.thresholds} />
				<ConsoleSnapshotPolicy policy={settings?.snapshotPolicy} />
			</div>

			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-full min-w-48 pl-4">
								<SortHeader label="Intent" sort={intentSort} sortKey="slug" />
							</TableHead>
							<TableHead>
								<SortHeader label="User" sort={intentSort} sortKey="user" />
							</TableHead>
							<TableHead>
								<SortHeader
									label="Created"
									sort={intentSort}
									sortKey="createdAt"
								/>
							</TableHead>
							<TableHead>
								<SortHeader
									label="Expires"
									sort={intentSort}
									sortKey="expiresAt"
								/>
							</TableHead>
							<TableHead>
								<SortHeader label="Status" sort={intentSort} sortKey="status" />
							</TableHead>
							<TableHead className="pr-4 text-right">
								<OpenInConvex iconOnly table="box_checkout_intents" />
							</TableHead>
						</TableRow>
					</TableHeader>
					{intents === undefined ? (
						<TableBody>
							<TableLoadingRow span={6} />
						</TableBody>
					) : intents.length > 0 ? (
						<TableBody className="page-fade-in">
							{sortedIntents.map((intent: CheckoutIntent) => (
								<TableRow key={intent.id}>
									<TableCell className="max-w-0 pl-4">
										<div className="min-w-0">
											<span className="block truncate font-medium text-foreground">
												{intent.slug}
											</span>
											<span className="block truncate text-muted-foreground">
												{intent.polarCheckoutId ?? intent.id}
											</span>
										</div>
									</TableCell>
									<TableCell>{intent.userEmail || intent.userId}</TableCell>
									<TableCell>{formatDate(intent.createdAt)}</TableCell>
									<TableCell>{formatDateTime(intent.expiresAt)}</TableCell>
									<TableCell>
										<StatusText
											status={intent.polarCheckoutStatus ?? "active"}
										/>
									</TableCell>
									<TableCell className="pr-4">
										<div className="flex items-center justify-end gap-1">
											<DismissButton
												onClick={() =>
													run("release", "Checkout released", () =>
														releaseIntent({
															intentId: intent.id,
															reason: "staff_release"
														})
													)
												}
											>
												Release
											</DismissButton>
											<OpenInConvex
												iconOnly
												label={`Open ${intent.slug} intent in Convex`}
												table="box_checkout_intents"
												value={intent.id}
											/>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					) : (
						<TableBody>
							<TableEmptyRow span={6}>
								No active checkout intents.
							</TableEmptyRow>
						</TableBody>
					)}
				</Table>
			</div>

			<GlobalMetricsPanel />

			<FlagsTable flags={flags} showBox />
		</div>
	);
}
