"use client";

import { useMutation, useQuery } from "convex/react";
import { SnapshotsDialog } from "@/components/snapshots-dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function ConsoleBoxSnapshots({
	boxId,
	status
}: {
	boxId: Id<"boxes">;
	status: string;
}) {
	const snapshots = useQuery(api.staff.boxes.boxSnapshots, { boxId });
	const createSnapshot = useMutation(api.staff.boxes.createBoxSnapshot);
	const restoreSnapshot = useMutation(api.staff.boxes.restoreSnapshot);
	const deleteSnapshot = useMutation(api.staff.boxes.deleteSnapshot);

	return (
		<SnapshotsDialog
			canRestore={status === "running" || status === "restore_failed"}
			canTake={status === "running"}
			onDelete={(id) => deleteSnapshot({ snapshotId: id })}
			onRestore={(id) => restoreSnapshot({ snapshotId: id })}
			onTake={() => createSnapshot({ boxId })}
			snapshots={snapshots}
		/>
	);
}
