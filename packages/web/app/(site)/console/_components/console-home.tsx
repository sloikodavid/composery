"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { ConsoleStats } from "./console-stats";
import { ConsoleSnapshotPolicy } from "./console-snapshot-policy";
import { ConsoleThresholds } from "./console-thresholds";
import { FlagsTable } from "@/components/flags-table";
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
import { Button } from "@/components/button";
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

			<div className="space-y-3">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<Input
						className="sm:max-w-sm"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search slug, user, subscription"
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
					<Table className="table-fixed min-w-[46rem]">
						<TableHeader>
							<TableRow>
								<TableHead className="pl-4">
									<SortHeader label="Box" sort={boxSort} sortKey="slug" />
								</TableHead>
								<TableHead className="w-48">
									<SortHeader label="User" sort={boxSort} sortKey="user" />
								</TableHead>
								<TableHead className="w-28">
									<SortHeader
										label="Created"
										sort={boxSort}
										sortKey="createdAt"
									/>
								</TableHead>
								<TableHead className="w-36">
									<SortHeader label="Status" sort={boxSort} sortKey="status" />
								</TableHead>
								<TableHead className="w-28 pr-2 text-right">
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
										<TableCell className="relative p-0">
											<Link
												className="absolute inset-0 flex items-center pl-4"
												data-link
												href={`/console/boxes/${box.slug}`}
											>
												<span className="truncate font-medium text-foreground">
													{box.slug}
												</span>
											</Link>
										</TableCell>
										<TableCell className="truncate">
											{box.userEmail || box.userId}
										</TableCell>
										<TableCell>{formatDate(box.createdAt)}</TableCell>
										<TableCell>
											<StatusText status={box.status} />
										</TableCell>
										<TableCell className="pr-2">
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
				<ConsoleThresholds thresholds={settings?.thresholds} />
				<ConsoleSnapshotPolicy policy={settings?.snapshotPolicy} />
			</div>

			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<Table className="table-fixed min-w-[52rem]">
					<TableHeader>
						<TableRow>
							<TableHead className="pl-4">
								<SortHeader label="Intent" sort={intentSort} sortKey="slug" />
							</TableHead>
							<TableHead className="w-48">
								<SortHeader label="User" sort={intentSort} sortKey="user" />
							</TableHead>
							<TableHead className="w-28">
								<SortHeader
									label="Created"
									sort={intentSort}
									sortKey="createdAt"
								/>
							</TableHead>
							<TableHead className="w-36">
								<SortHeader
									label="Expires"
									sort={intentSort}
									sortKey="expiresAt"
								/>
							</TableHead>
							<TableHead className="w-36">
								<SortHeader label="Status" sort={intentSort} sortKey="status" />
							</TableHead>
							<TableHead className="w-14 pr-2 text-right">
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
									<TableCell className="pl-4">
										<div className="min-w-0">
											<span className="block truncate font-medium text-foreground">
												{intent.slug}
											</span>
											<span className="block truncate text-muted-foreground">
												{intent.polarCheckoutId ?? intent.id}
											</span>
										</div>
									</TableCell>
									<TableCell className="truncate">
										{intent.userEmail || intent.userId}
									</TableCell>
									<TableCell>{formatDate(intent.createdAt)}</TableCell>
									<TableCell>{formatDateTime(intent.expiresAt)}</TableCell>
									<TableCell>
										<StatusText
											status={intent.polarCheckoutStatus ?? "active"}
										/>
									</TableCell>
									<TableCell className="pr-2">
										<div className="flex items-center justify-end gap-1">
											<Button
												onClick={() =>
													run("release", "Checkout released", () =>
														releaseIntent({
															intentId: intent.id,
															reason: "staff_release"
														})
													)
												}
												size="sm"
												variant="outline"
											>
												Release
											</Button>
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
