"use client";

import {
	useAction,
	useMutation,
	usePaginatedQuery,
	useQuery
} from "convex/react";
import { useState, type ReactNode } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { BoxStatusAction } from "@/components/boxes/status-action";
import { ChangeSlugDialog } from "@/components/boxes/change-slug-dialog";
import { FlagsTable } from "@/components/boxes/flags-table";
import { MonitorCard } from "@/components/boxes/monitor-card";
import { OpenInConvex, OpenInHetzner, OpenInPolar } from "@/components/open-in";
import { RepairDialog } from "@/components/boxes/repair-dialog";
import { ResetDialog } from "@/components/boxes/reset-dialog";
import { SortHeader } from "@/components/sort-header";
import { StatusText } from "@/components/boxes/status-text";
import {
	DEFAULT_RANGE,
	type MetricsRange
} from "@/components/boxes/metrics-chart";
import { ConsoleBoxSnapshots } from "./console-box-snapshots";
import { SuspendDialog } from "./suspend-dialog";
import { Card, CardContent } from "@/components/base/card";
import { Separator } from "@/components/base/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableLoadingRow,
	TableRow
} from "@/components/base/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useBusyAction } from "@/hooks/use-busy-action";
import { useTableSort } from "@/hooks/use-table-sort";
import { formatDateTime } from "@/lib/datetime";

type OperationRow = {
	_id: string;
	created_at: number;
	last_error?: string;
	metadata?: Record<string, unknown>;
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

const AUDIT_PAGE_SIZE = 100;

function operationDetail(operation: OperationRow) {
	if (operation.last_error) return operation.last_error;
	const reason = operation.metadata?.reason;
	return typeof reason === "string" && reason.trim()
		? `Reason: ${reason}`
		: null;
}

function BoxAuditHistory({ boxId }: { boxId: Id<"boxes"> }) {
	const operations = usePaginatedQuery(
		api.staff.boxes.auditOperations,
		{ boxId },
		{ initialNumItems: AUDIT_PAGE_SIZE }
	);
	const events = usePaginatedQuery(
		api.staff.boxes.auditEvents,
		{ boxId },
		{ initialNumItems: AUDIT_PAGE_SIZE }
	);
	const { sort: operationSort, sortedRows: sortedOperations } = useTableSort(
		operations.results as OperationRow[],
		OPERATION_SORT
	);
	const { sort: eventSort, sortedRows: sortedEvents } = useTableSort(
		events.results as EventRow[],
		EVENT_SORT
	);

	return (
		<>
			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<Table cols={["fluid", "datetime", "status", "actions-1"]}>
					<TableHeader>
						<TableRow>
							<TableHead className="pl-4">
								<SortHeader
									label="Operation"
									sort={operationSort}
									sortKey="type"
								/>
							</TableHead>
							<TableHead>
								<SortHeader
									label="Created"
									sort={operationSort}
									sortKey="created_at"
								/>
							</TableHead>
							<TableHead>
								<SortHeader
									label="Status"
									sort={operationSort}
									sortKey="status"
								/>
							</TableHead>
							<TableHead className="pr-4 text-right">
								<OpenInConvex
									iconOnly
									field="box_id"
									table="box_operations"
									value={boxId}
								/>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{operations.status === "LoadingFirstPage" ? (
							<TableLoadingRow />
						) : sortedOperations.length > 0 ? (
							sortedOperations.map((operation) => {
								const detail = operationDetail(operation);
								return (
									<TableRow
										className={detail ? "[&>td]:align-top" : undefined}
										key={operation._id}
									>
										<TableCell className="pl-4">
											<div className="min-w-0">
												<p className="font-medium wrap-break-word text-foreground">
													{operation.type}
												</p>
												{detail ? (
													<p className="wrap-break-word whitespace-normal text-muted-foreground">
														{detail}
													</p>
												) : null}
											</div>
										</TableCell>
										<TableCell>
											{formatDateTime(operation.created_at)}
										</TableCell>
										<TableCell>
											<StatusText status={operation.status} />
										</TableCell>
										<TableCell className="pr-4 text-right">
											<OpenInConvex
												iconOnly
												label={`Open ${operation.type} operation in Convex`}
												table="box_operations"
												value={operation._id}
											/>
										</TableCell>
									</TableRow>
								);
							})
						) : (
							<TableEmptyRow>No operations.</TableEmptyRow>
						)}
					</TableBody>
				</Table>
			</div>
			{operations.status === "CanLoadMore" ||
			operations.status === "LoadingMore" ? (
				<div className="flex justify-center">
					<AnimatedIconButton
						disabled={operations.status === "LoadingMore"}
						icon="plus"
						iconPosition="start"
						onClick={() => operations.loadMore(AUDIT_PAGE_SIZE)}
						variant="outline"
					>
						{operations.status === "LoadingMore"
							? "Loading…"
							: "Show more operations"}
					</AnimatedIconButton>
				</div>
			) : null}

			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<Table cols={["fluid", "datetime", "actions-1"]}>
					<TableHeader>
						<TableRow>
							<TableHead className="pl-4">
								<SortHeader label="Event" sort={eventSort} sortKey="type" />
							</TableHead>
							<TableHead>
								<SortHeader
									label="Created"
									sort={eventSort}
									sortKey="created_at"
								/>
							</TableHead>
							<TableHead className="pr-4 text-right">
								<OpenInConvex
									iconOnly
									field="box_id"
									table="box_events"
									value={boxId}
								/>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{events.status === "LoadingFirstPage" ? (
							<TableLoadingRow />
						) : sortedEvents.length > 0 ? (
							sortedEvents.map((event) => (
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
									<TableCell className="pr-4 text-right">
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
							<TableEmptyRow>No events.</TableEmptyRow>
						)}
					</TableBody>
				</Table>
			</div>
			{events.status === "CanLoadMore" || events.status === "LoadingMore" ? (
				<div className="flex justify-center">
					<AnimatedIconButton
						disabled={events.status === "LoadingMore"}
						icon="plus"
						iconPosition="start"
						onClick={() => events.loadMore(AUDIT_PAGE_SIZE)}
						variant="outline"
					>
						{events.status === "LoadingMore" ? "Loading…" : "Show more events"}
					</AnimatedIconButton>
				</div>
			) : null}
		</>
	);
}

export function ConsoleBoxDetail({ boxId }: { boxId: string }) {
	const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);
	const detail = useQuery(api.staff.boxes.boxDetail, { boxId });
	const metricsSeries = useQuery(
		api.staff.metrics.series,
		detail ? { boxId: detail.box.id, range } : "skip"
	);
	const flags = useQuery(
		api.staff.metrics.flags,
		detail ? { boxId: detail.box.id } : "skip"
	);
	const retryProvision = useMutation(api.staff.boxes.retryProvisionBox);
	const revokeComp = useMutation(api.staff.boxes.revokeComp);
	const resetBox = useMutation(api.staff.boxes.resetBox);
	const stopBox = useMutation(api.staff.boxes.stopBox);
	const startBox = useMutation(api.staff.boxes.startBox);
	const changeSlug = useMutation(api.staff.boxes.changeBoxSlug);
	const suspendBox = useAction(api.staff.boxes.suspendBox);
	const unsuspendBox = useAction(api.staff.boxes.unsuspendBox);
	const recover = useAction(api.staff.boxes.recover);
	const recoveryStatus = useAction(api.staff.boxes.recoveryStatus);
	const runtimeLogs = useAction(api.staff.boxes.runtimeLogs);
	const setUserSuspended = useAction(api.staff.users.setUserSuspended);
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

	const { box, user, subscription } = detail;
	const boxTransitioning =
		box.status === "suspending" || box.status === "unsuspending";

	const fields: Array<
		[string, string | number | null | undefined, ReactNode?]
	> = [
		["Box ID", box.id],
		["Slug", box.slug],
		["Created", formatDateTime(box.createdAt)],
		...(detail.suspendedReason
			? ([["Suspension reason", detail.suspendedReason]] as Array<
					[string, string | number | null | undefined, ReactNode?]
				>)
			: []),
		...(box.status === "deleted"
			? ([
					["Deleted", formatDateTime(box.deletedAt)],
					["Purges at", formatDateTime(box.purgeAt)]
				] as Array<[string, string | number | null | undefined, ReactNode?]>)
			: []),
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
		...(box.comp
			? ([
					["Comped by", box.compedBy ?? ""],
					["Comp reason", box.compReason ?? ""]
				] as Array<[string, string | number | null | undefined, ReactNode?]>)
			: []),
		...(box.status !== "deleted"
			? ([
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
						[box.hetznerServerType, box.hetznerLocation]
							.filter(Boolean)
							.join(" / ")
					],
					["IPv4", box.hetznerIpv4 ?? ""],
					["IPv6", box.hetznerIpv6 ?? ""],
					["DNS A", box.dnsRecordId ?? ""],
					["DNS AAAA", box.dnsRecordAaaaId ?? ""]
				] as Array<[string, string | number | null | undefined, ReactNode?]>)
			: [])
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

					{box.status !== "deleted" ? (
						<>
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
											run("stop", "Stopping box", () =>
												stopBox({ boxId: box.id })
											)
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
								{box.comp ? (
									<AnimatedIconButton
										disabled={busy === "revoke-comp"}
										icon="delete"
										iconPosition="start"
										onClick={() =>
											run("revoke-comp", "Comp revoked", () =>
												revokeComp({ boxId: box.id })
											)
										}
										variant="outline"
									>
										Revoke comp
									</AnimatedIconButton>
								) : null}
								<ConsoleBoxSnapshots boxId={box.id} status={box.status} />
								<RepairDialog
									boxStatus={box.status}
									busy={busy}
									check={() => recoveryStatus({ boxId: box.id })}
									onRepair={() =>
										run("repair", "Repair started", () =>
											recover({ boxId: box.id })
										)
									}
									slug={box.slug}
								/>
								<ResetDialog
									busy={busy}
									onReset={() =>
										run("reset", "Resetting box", () =>
											resetBox({ boxId: box.id })
										)
									}
									slug={box.slug}
								/>
							</div>
						</>
					) : null}
				</CardContent>
			</Card>

			{box.status !== "deleted" ? (
				<MonitorCard
					className="h-112"
					loadLogs={() => runtimeLogs({ boxId: box.id })}
					note={detail.suspendedReason ?? undefined}
					onRangeChange={setRange}
					range={range}
					series={metricsSeries}
					status={box.status}
				/>
			) : null}

			<FlagsTable boxId={box.id} flags={flags} />

			<BoxAuditHistory boxId={box.id} />
		</div>
	);
}
