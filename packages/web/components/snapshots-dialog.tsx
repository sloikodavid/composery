"use client";

import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from "@/components/dialog";
import { SortHeader } from "@/components/sort-header";
import { StatusText } from "@/components/status-text";
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
import type { Id } from "@/convex/_generated/dataModel";
import { useBusyAction } from "@/hooks/use-busy-action";
import { useTableSort } from "@/hooks/use-table-sort";
import { formatDate, formatDateTime } from "@/lib/datetime";

export type SnapshotRow = {
	id: Id<"box_snapshots">;
	class: "manual" | "scheduled";
	status: "pending" | "creating" | "complete" | "failed" | "deleting";
	sizeBytes: number | null;
	createdAt: number;
	completedAt: number | null;
	expiresAt: number | null;
};

const CLASS_LABEL = {
	manual: "Manual",
	scheduled: "Automatic"
} as const;

const SNAPSHOT_SORT = {
	created: (row: SnapshotRow) => row.createdAt,
	type: (row: SnapshotRow) => row.class,
	size: (row: SnapshotRow) => row.sizeBytes ?? 0,
	status: (row: SnapshotRow) => row.status
};

function formatSize(bytes: number | null) {
	if (bytes === null) return "—";
	const gb = bytes / 1e9;
	return gb >= 1
		? `${gb.toFixed(2)} GB`
		: `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function SnapshotsDialog({
	canRestore,
	canTake,
	onDelete,
	onRestore,
	onTake,
	snapshots
}: {
	canRestore: boolean;
	canTake: boolean;
	onDelete: (id: Id<"box_snapshots">) => Promise<unknown>;
	onRestore: (id: Id<"box_snapshots">) => Promise<unknown>;
	onTake: () => Promise<unknown>;
	snapshots: SnapshotRow[] | undefined;
}) {
	const [open, setOpen] = useState(false);
	const { busy, run } = useBusyAction();
	const { sort, sortedRows } = useTableSort(snapshots ?? [], SNAPSHOT_SORT);

	return (
		<>
			<AnimatedIconButton
				icon="download"
				iconPosition="start"
				onClick={() => setOpen(true)}
				variant="outline"
			>
				Snapshot…
			</AnimatedIconButton>
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent size="panel">
					<DialogHeader>
						<DialogTitle>Snapshots</DialogTitle>
						<DialogDescription>
							Restore points for this box. Taking one doesn&apos;t interrupt it.
						</DialogDescription>
					</DialogHeader>

					<div className="flex justify-end">
						<AnimatedIconButton
							disabled={!canTake || busy === "take"}
							icon="download"
							iconPosition="start"
							onClick={() => run("take", "Snapshot started", onTake)}
						>
							New snapshot
						</AnimatedIconButton>
					</div>

					<div className="overflow-hidden rounded-2xl border border-border bg-card">
						<Table className="table-fixed min-w-[40rem]">
							<TableHeader>
								<TableRow>
									<TableHead className="pl-4">
										<SortHeader label="Created" sort={sort} sortKey="created" />
									</TableHead>
									<TableHead className="w-28">
										<SortHeader label="Type" sort={sort} sortKey="type" />
									</TableHead>
									<TableHead className="w-24">
										<SortHeader label="Size" sort={sort} sortKey="size" />
									</TableHead>
									<TableHead className="w-32">
										<SortHeader label="Status" sort={sort} sortKey="status" />
									</TableHead>
									<TableHead className="w-20 pr-2 text-right">
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{snapshots === undefined ? (
									<TableLoadingRow span={5} />
								) : sortedRows.length > 0 ? (
									<>
										{sortedRows.map((snapshot) => {
											const restoreDisabled =
												!canRestore ||
												snapshot.status !== "complete" ||
												busy === "restore";
											return (
												<TableRow
													className="h-14 [&>td]:align-top"
													key={snapshot.id}
												>
													<TableCell className="pl-4">
														<div className="min-w-0">
															<p className="font-medium text-foreground">
																{formatDateTime(snapshot.createdAt)}
															</p>
															{snapshot.expiresAt ? (
																<p className="text-xs text-muted-foreground">
																	Expires {formatDate(snapshot.expiresAt)}
																</p>
															) : null}
														</div>
													</TableCell>
													<TableCell className="text-muted-foreground">
														{CLASS_LABEL[snapshot.class]}
													</TableCell>
													<TableCell className="tabular-nums text-muted-foreground">
														{formatSize(snapshot.sizeBytes)}
													</TableCell>
													<TableCell>
														<StatusText status={snapshot.status} />
													</TableCell>
													<TableCell className="pr-2 text-right">
														<div className="flex items-center justify-end gap-1">
															<ConfirmDialog
																confirmLabel="Restore"
																description="Replaces the box's current files and state with this snapshot. The box restarts briefly, and this can't be undone."
																destructive
																onConfirm={() =>
																	run("restore", "Restoring snapshot", () =>
																		onRestore(snapshot.id)
																	)
																}
																title="Restore snapshot"
															>
																{(openConfirm) => (
																	<AnimatedIconButton
																		aria-label="Restore snapshot"
																		disabled={restoreDisabled}
																		icon="rotate-cw"
																		iconPosition="only"
																		onClick={openConfirm}
																		size="icon-sm"
																		variant="outline"
																	/>
																)}
															</ConfirmDialog>
															<ConfirmDialog
																confirmLabel="Delete"
																description="Permanently removes this snapshot. This can't be undone."
																destructive
																onConfirm={() =>
																	run("delete", "Snapshot deleted", () =>
																		onDelete(snapshot.id)
																	)
																}
																title="Delete snapshot"
															>
																{(openConfirm) => (
																	<AnimatedIconButton
																		aria-label="Delete snapshot"
																		disabled={busy === "delete"}
																		icon="delete"
																		iconPosition="only"
																		onClick={openConfirm}
																		size="icon-sm"
																		variant="destructive"
																	/>
																)}
															</ConfirmDialog>
														</div>
													</TableCell>
												</TableRow>
											);
										})}
									</>
								) : (
									<TableEmptyRow span={5}>No snapshots yet.</TableEmptyRow>
								)}
							</TableBody>
						</Table>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
