"use client";

import { useMutation, useQuery } from "convex/react";
import { SnapshotsDialog } from "@/components/boxes/snapshots-dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { BoxPlan, SnapshotSplit } from "@/lib/box-plan";

export function ConsoleBoxSnapshots({
	boxId,
	plan,
	split,
	status
}: {
	boxId: Id<"boxes">;
	plan: BoxPlan;
	split: SnapshotSplit;
	status: string;
}) {
	const snapshots = useQuery(api.staff.boxes.snapshots, { boxId });
	const createSnapshot = useMutation(api.staff.boxes.createSnapshot);
	const restoreSnapshot = useMutation(api.staff.boxes.restoreSnapshot);
	const deleteSnapshot = useMutation(api.staff.boxes.deleteSnapshot);

	return (
		<SnapshotsDialog
			canRestore={status === "running" || status === "restore_failed"}
			canTake={status === "running"}
			onDelete={(id) => deleteSnapshot({ snapshotId: id })}
			onRestore={(id) => restoreSnapshot({ snapshotId: id })}
			onTake={() => createSnapshot({ boxId })}
			plan={plan}
			split={split}
			snapshots={snapshots}
		/>
	);
}
