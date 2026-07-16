"use client";

import { useMutation, useQuery } from "convex/react";
import { SnapshotsDialog } from "@/components/snapshots-dialog";
import { api } from "@/convex/_generated/api";

export function BoxSnapshots({
	slug,
	status
}: {
	slug: string;
	status: string;
}) {
	const snapshots = useQuery(api.user.boxes.snapshots, { slug });
	const createSnapshot = useMutation(api.user.boxes.createSnapshot);
	const restoreSnapshot = useMutation(api.user.boxes.restoreSnapshot);
	const deleteSnapshot = useMutation(api.user.boxes.deleteSnapshot);

	return (
		<SnapshotsDialog
			canRestore={status === "running" || status === "restore_failed"}
			canTake={status === "running"}
			onDelete={(id) => deleteSnapshot({ snapshotId: id })}
			onRestore={(id) => restoreSnapshot({ snapshotId: id })}
			onTake={() => createSnapshot({ slug })}
			snapshots={snapshots}
		/>
	);
}
