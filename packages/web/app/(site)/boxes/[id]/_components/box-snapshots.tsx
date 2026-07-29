"use client";

import { useMutation, useQuery } from "convex/react";
import { SnapshotsDialog } from "@/components/boxes/snapshots-dialog";
import { api } from "@/convex/_generated/api";
import type { BoxPlan, SnapshotSplit } from "@/lib/box-plan";

export function BoxSnapshots({
	plan,
	slug,
	split,
	status
}: {
	plan: BoxPlan;
	slug: string;
	split: SnapshotSplit;
	status: string;
}) {
	const snapshots = useQuery(api.user.boxes.snapshots, { slug });
	const createSnapshot = useMutation(api.user.boxes.createSnapshot);
	const restoreSnapshot = useMutation(api.user.boxes.restoreSnapshot);
	const deleteSnapshot = useMutation(api.user.boxes.deleteSnapshot);
	const setSnapshotSplit = useMutation(api.user.boxes.setSnapshotSplit);

	return (
		<SnapshotsDialog
			canRestore={status === "running" || status === "restore_failed"}
			canTake={status === "running"}
			onDelete={(id) => deleteSnapshot({ snapshotId: id })}
			onRestore={(id) => restoreSnapshot({ snapshotId: id })}
			onSplitChange={(manualCap) => setSnapshotSplit({ manualCap, slug })}
			onTake={() => createSnapshot({ slug })}
			plan={plan}
			split={split}
			snapshots={snapshots}
		/>
	);
}
