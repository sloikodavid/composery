"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { BoxStatusAction } from "@/components/box-status-action";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { ChangeSlugDialog } from "@/components/change-slug-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FlagsTable } from "@/components/flags-table";
import { MonitorCard } from "@/components/monitor-card";
import { OpenInConvex } from "@/components/open-in-convex";
import { OpenInHetzner } from "@/components/open-in-hetzner";
import { OpenInPolar } from "@/components/open-in-polar";
import { SortHeader } from "@/components/sort-header";
import { StatusText } from "@/components/status-text";
import { DEFAULT_RANGE, type MetricsRange } from "@/components/metrics-chart";
import { ConsoleBoxSnapshots } from "./console-box-snapshots";
import { SuspendDialog } from "@/components/suspend-dialog";
import { Card, CardContent } from "@/components/card";
import { Separator } from "@/components/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableRow
} from "@/components/table";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";
import { useTableSort } from "@/hooks/use-table-sort";
import { formatDateTime } from "@/lib/datetime";

type OperationRow = {
	_id: string;
	created_at: number;
	last_error?: string;
	status: string;
	type: string;
};

type EventRow = {
	_id: string;
	created_at: number;
	message?: string;
	type: string;
};

const OPERATION_SORT = {
	type: (operation: OperationRow) => operation.type,
	status: (operation: OperationRow) => operation.status,
	created_at: (operation: OperationRow) => operation.created_at
};

const EVENT_SORT = {
	type: (event: EventRow) => event.type,
	created_at: (event: EventRow) => event.created_at
};

export function ConsoleBoxDetail({ slug }: { slug: string }) {
	const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);
	const detail = useQuery(api.staff.boxes.boxDetail, { slug });
	const metricsSeries = useQuery(api.staff.metrics.series, { slug, range });
	const flags = useQuery(api.staff.metrics.flags, { slug });
	const retryProvision = useMutation(api.staff.boxes.retryProvisionBox);
	const resetBox = useMutation(api.staff.boxes.resetBox);
	const stopBox = useMutation(api.staff.boxes.stopBox);
	const startBox = useMutation(api.staff.boxes.startBox);
	const changeSlug = useMutation(api.staff.boxes.changeBoxSlug);
	const changePassword = useAction(api.staff.boxes.changeBoxPassword);
	const suspendBox = useAction(api.staff.boxes.suspendBox);
	const unsuspendBox = useAction(api.staff.boxes.unsuspendBox);
	const setUserSuspended = useAction(api.staff.users.setUserSuspended);
	const { busy, run } = useBusyAction();
	const { sort: operationSort, sortedRows: sortedOperations } = useTableSort(
		(detail?.operations ?? []) as OperationRow[],
		OPERATION_SORT
	);
	const { sort: eventSort, sortedRows: sortedEvents } = useTableSort(
		(detail?.events ?? []) as EventRow[],
		EVENT_SORT
	);

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

	const { box, user, subscription } = detail;
	const boxTransitioning =
		box.status === "suspending" || box.status === "unsuspending";

	const fields: Array<
		[string, string | number | null | undefined, ReactNode?]
	> = [
		[
			"User",
			user?.email ?? box.userId,
			user ? (
				<OpenInConvex
					className="-my-1"
					field="clerk_user_id"
					iconOnly
					key="user"
					table="users"
					value={user.clerkUserId}
				/>
			) : undefined
		],
		[
			"Subscription",
			box.polarSubscriptionId,
			<OpenInPolar
				className="-my-1"
				iconOnly
				key="subscription"
				subscriptionId={box.polarSubscriptionId}
			/>
		],
		["Subscription status", subscription?.status ?? "none"],
		["Current period end", formatDateTime(subscription?.currentPeriodEnd)],
		[
			"Cancel at period end",
			subscription ? String(subscription.cancelAtPeriodEnd) : "none"
		],
		[
			"Customer",
			box.polarCustomerId,
			<OpenInPolar
				className="-my-1"
				customerId={box.polarCustomerId}
				iconOnly
				key="customer"
			/>
		],
		[
			"Server",
			box.hetznerServerId ?? "",
			<OpenInHetzner
				className="-my-1"
				iconOnly
				key="server"
				serverId={box.hetznerServerId ?? null}
			/>
		],
		[
			"Placement",
			[box.hetznerServerType, box.hetznerLocation].filter(Boolean).join(" / ")
		],
		["IPv4", box.hetznerIpv4 ?? ""],
		["IPv6", box.hetznerIpv6 ?? ""],
		["DNS A", box.dnsRecordId ?? ""],
		["DNS AAAA", box.dnsRecordAaaaId ?? ""]
	];

	const suspendTargets = [
		...(box.status === "suspended" || boxTransitioning
			? []
			: [
					{
						label: "Box",
						description: "Stops the box and interrupts anything running in it.",
						onConfirm: (reason: string) =>
							run("suspend", "Suspending box", () =>
								suspendBox({ boxId: box.id, reason })
							)
					}
				]),
		...(user && !user.suspended
			? [
					{
						label: "User",
						description: "Suspends the account and every box it owns.",
						onConfirm: (reason: string) =>
							run("suspend", "Suspending user", () =>
								setUserSuspended({
									clerkUserId: user.clerkUserId,
									suspended: true,
									reason
								})
							)
					}
				]
			: [])
	];

	return (
		<div className="page-fade-in space-y-4">
			<Card>
				<CardContent className="space-y-6">
					<dl className="grid gap-4 text-sm sm:grid-cols-2">
						{fields.map(([label, value, action]) => (
							<div className="min-w-0 space-y-1.5" key={label}>
								<dt className="text-muted-foreground">{label}</dt>
								<dd className="flex items-center gap-1 font-medium text-foreground">
									<span className="min-w-0 break-all">{value || "none"}</span>
									{action}
								</dd>
							</div>
						))}
					</dl>

					<Separator />

					<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
						<BoxStatusAction
							retry={{
								disabled: busy === "provision",
								onClick: () =>
									run("provision", "Retrying provisioning", () =>
										retryProvision({ boxId: box.id })
									)
							}}
							start={{
								disabled: busy === "start",
								onClick: () =>
									run("start", "Starting box", () =>
										startBox({ boxId: box.id })
									)
							}}
							status={box.status}
							stop={{
								onConfirm: () =>
									run("stop", "Stopping box", () => stopBox({ boxId: box.id }))
							}}
							unsuspend={{
								// When the owner's whole account is suspended, this box-only
								// unsuspend would just power on a box they still can't reach;
								// "Unsuspend user" below is the right control there.
								disabled: busy === "unsuspend" || user?.suspended,
								onClick: () =>
									run("unsuspend", "Unsuspending box", () =>
										unsuspendBox({ boxId: box.id })
									)
							}}
						/>
						<ChangePasswordDialog
							label={box.slug}
							onSubmit={(password) =>
								changePassword({ boxId: box.id, password })
							}
						/>
						<ChangeSlugDialog
							onSubmit={(newSlug) => changeSlug({ boxId: box.id, newSlug })}
						/>
						{user?.suspended ? (
							<AnimatedIconButton
								disabled={busy === "unsuspend-user"}
								icon="play"
								iconPosition="start"
								onClick={() =>
									run("unsuspend-user", "Unsuspending user", () =>
										setUserSuspended({
											clerkUserId: user.clerkUserId,
											suspended: false
										})
									)
								}
								variant="outline"
							>
								Unsuspend user
							</AnimatedIconButton>
						) : null}
						{suspendTargets.length > 0 ? (
							<SuspendDialog targets={suspendTargets}>
								{(open) => (
									<AnimatedIconButton
										disabled={busy === "suspend"}
										icon="construction"
										iconPosition="start"
										onClick={open}
										variant="outline"
									>
										Suspend
									</AnimatedIconButton>
								)}
							</SuspendDialog>
						) : null}
						<ConsoleBoxSnapshots boxId={box.id} status={box.status} />
						<ConfirmDialog
							confirmLabel="Reset"
							description="Permanently deletes the files and state in this box. It cannot be undone."
							destructive
							onConfirm={() =>
								run("reset", "Resetting box", () => resetBox({ boxId: box.id }))
							}
							title="Reset"
						>
							{(open) => (
								<AnimatedIconButton
									disabled={busy === "reset"}
									icon="delete"
									iconPosition="start"
									onClick={open}
									variant="destructive"
								>
									Reset
								</AnimatedIconButton>
							)}
						</ConfirmDialog>
					</div>
				</CardContent>
			</Card>

			<MonitorCard
				action={api.staff.boxes.runtimeLogs}
				className="h-112"
				note={detail.suspendedReason ?? undefined}
				onRangeChange={setRange}
				range={range}
				series={metricsSeries}
				slug={box.slug}
				status={box.status}
			/>

			<FlagsTable flags={flags} />

			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<Table className="table-fixed min-w-[34rem]">
					<TableHeader>
						<TableRow>
							<TableHead className="pl-4">
								<SortHeader
									label="Operation"
									sort={operationSort}
									sortKey="type"
								/>
							</TableHead>
							<TableHead className="w-36">
								<SortHeader
									label="Created"
									sort={operationSort}
									sortKey="created_at"
								/>
							</TableHead>
							<TableHead className="w-36">
								<SortHeader
									label="Status"
									sort={operationSort}
									sortKey="status"
								/>
							</TableHead>
							<TableHead className="w-14 pr-2 text-right">
								<OpenInConvex
									iconOnly
									field="box_id"
									table="box_operations"
									value={box.id}
								/>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sortedOperations.length > 0 ? (
							sortedOperations.map((operation: OperationRow) => (
								<TableRow
									className={
										operation.last_error ? "[&>td]:align-top" : undefined
									}
									key={operation._id}
								>
									<TableCell className="pl-4">
										<div className="min-w-0">
											<p className="font-medium wrap-break-word text-foreground">
												{operation.type}
											</p>
											{operation.last_error ? (
												<p className="wrap-break-word whitespace-normal text-muted-foreground">
													{operation.last_error}
												</p>
											) : null}
										</div>
									</TableCell>
									<TableCell>{formatDateTime(operation.created_at)}</TableCell>
									<TableCell>
										<StatusText status={operation.status} />
									</TableCell>
									<TableCell className="pr-2 text-right">
										<OpenInConvex
											iconOnly
											label={`Open ${operation.type} operation in Convex`}
											table="box_operations"
											value={operation._id}
										/>
									</TableCell>
								</TableRow>
							))
						) : (
							<TableEmptyRow span={4}>No operations.</TableEmptyRow>
						)}
					</TableBody>
				</Table>
			</div>

			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<Table className="table-fixed min-w-[26rem]">
					<TableHeader>
						<TableRow>
							<TableHead className="pl-4">
								<SortHeader label="Event" sort={eventSort} sortKey="type" />
							</TableHead>
							<TableHead className="w-36">
								<SortHeader
									label="Created"
									sort={eventSort}
									sortKey="created_at"
								/>
							</TableHead>
							<TableHead className="w-14 pr-2 text-right">
								<OpenInConvex
									iconOnly
									field="box_id"
									table="box_events"
									value={box.id}
								/>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sortedEvents.length > 0 ? (
							sortedEvents.map((event: EventRow) => (
								<TableRow
									className={event.message ? "[&>td]:align-top" : undefined}
									key={event._id}
								>
									<TableCell className="pl-4">
										<div className="min-w-0">
											<p className="font-medium wrap-break-word text-foreground">
												{event.type}
											</p>
											{event.message ? (
												<p className="wrap-break-word whitespace-normal text-muted-foreground">
													{event.message}
												</p>
											) : null}
										</div>
									</TableCell>
									<TableCell>{formatDateTime(event.created_at)}</TableCell>
									<TableCell className="pr-2 text-right">
										<OpenInConvex
											iconOnly
											label={`Open ${event.type} event in Convex`}
											table="box_events"
											value={event._id}
										/>
									</TableCell>
								</TableRow>
							))
						) : (
							<TableEmptyRow span={3}>No events.</TableEmptyRow>
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
