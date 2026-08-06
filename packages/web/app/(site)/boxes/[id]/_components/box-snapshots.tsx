"use client";

import { useMutation, useQuery } from "convex/react";
import { SnapshotsDialog } from "@/components/box/snapshots-dialog";
import { api } from "@/convex/_generated/api";
import { isOperationAllowed } from "@/convex/model/box/operation";
import { type BoxStatus } from "@/convex/model/box/status";
import type { BoxPlan, SnapshotSplit } from "@/convex/model/box/plan";

export function BoxSnapshots({
	onOpenChange,
	open,
	plan,
	slug,
	split,
	status
}: {
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	plan: BoxPlan;
	slug: string;
	split: SnapshotSplit;
	status: BoxStatus;
}) {
	const snapshots = useQuery(api.owner.boxes.snapshots, { slug });
	const createSnapshot = useMutation(api.owner.boxes.createSnapshot);
	const restoreSnapshot = useMutation(api.owner.boxes.restoreSnapshot);
	const deleteSnapshot = useMutation(api.owner.boxes.deleteSnapshot);
	const setSnapshotSplit = useMutation(api.owner.boxes.setSnapshotSplit);

	return (
		<SnapshotsDialog
			canRestore={isOperationAllowed(status, "restore")}
			canTake={isOperationAllowed(status, "snapshot")}
			onDelete={(id) => deleteSnapshot({ snapshotId: id })}
			onOpenChange={onOpenChange}
			onRestore={(id) => restoreSnapshot({ snapshotId: id })}
			onSplitChange={(manualCap) => setSnapshotSplit({ manualCap, slug })}
			onTake={() => createSnapshot({ slug })}
			open={open}
			plan={plan}
			split={split}
			snapshots={snapshots}
		/>
	);
}
