"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/base/input";
import { api } from "@/convex/_generated/api";
import type { CapacityUsage } from "@/convex/boxes/boxCapacity";
import { useBusyAction } from "@/hooks/use-busy-action";

function draftValue(value: number | null) {
	return value === null ? "" : String(value);
}

function parsedLimit(value: string) {
	return value === "" ? null : Number(value);
}

function validLimit(value: number | null) {
	return (
		value === null ||
		(Number.isInteger(value) && value >= 1 && value <= 100_000)
	);
}

export function ConsoleCapacity({
	capacity,
	serverLimit,
	snapshotLimit
}: {
	capacity: CapacityUsage;
	serverLimit: number | null;
	snapshotLimit: number | null;
}) {
	const setLimits = useMutation(api.staff.settings.setHetznerLimits);
	const { run, busy } = useBusyAction();
	const [serverDraft, setServerDraft] = useState(draftValue(serverLimit));
	const [snapshotDraft, setSnapshotDraft] = useState(draftValue(snapshotLimit));
	const [lastSynced, setLastSynced] = useState(
		`${serverLimit ?? ""}:${snapshotLimit ?? ""}`
	);
	const synced = `${serverLimit ?? ""}:${snapshotLimit ?? ""}`;
	if (synced !== lastSynced) {
		setLastSynced(synced);
		setServerDraft(draftValue(serverLimit));
		setSnapshotDraft(draftValue(snapshotLimit));
	}

	const nextServerLimit = parsedLimit(serverDraft);
	const nextSnapshotLimit = parsedLimit(snapshotDraft);
	const bothSetOrCleared =
		(nextServerLimit === null) === (nextSnapshotLimit === null);
	const valid =
		bothSetOrCleared &&
		validLimit(nextServerLimit) &&
		validLimit(nextSnapshotLimit);
	const dirty =
		serverDraft !== draftValue(serverLimit) ||
		snapshotDraft !== draftValue(snapshotLimit);
	const serverOvercommit =
		serverLimit !== null && capacity.serverCommitments > serverLimit;
	const snapshotOvercommit =
		snapshotLimit !== null && capacity.snapshotCommitments > snapshotLimit;
	const status =
		capacity.blockReason === "limits_not_configured"
			? "Set both allocations before checkout can start."
			: serverOvercommit || snapshotOvercommit
				? `Existing commitments exceed the configured ${serverOvercommit && snapshotOvercommit ? "server and snapshot allocations" : serverOvercommit ? "server allocation" : "snapshot allocation"}. New checkout is blocked; existing boxes keep priority.`
				: capacity.blockReason === "server_limit"
					? "Server capacity is fully committed."
					: capacity.blockReason === "snapshot_limit"
						? "Snapshot capacity is fully committed."
						: capacity.blockReason === "manual_pause"
							? "Capacity is available, but checkout is manually paused."
							: `${capacity.availableNewBoxes} additional box${capacity.availableNewBoxes === 1 ? "" : "es"} can be reserved.`;

	return (
		<div className="rounded-2xl border border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<div>
					<h2 className="text-sm font-medium">Hetzner capacity</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">{status}</p>
				</div>
				<AnimatedIconButton
					disabled={!dirty || !valid || busy !== null}
					icon="check"
					iconPosition="start"
					onClick={() =>
						run("hetzner-capacity", "Hetzner capacity updated", () =>
							setLimits({
								serverLimit: nextServerLimit,
								snapshotLimit: nextSnapshotLimit
							})
						)
					}
					size="sm"
				>
					Save
				</AnimatedIconButton>
			</div>
			<div className="divide-y divide-border">
				<div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3">
					<div>
						<p className="text-sm">Server allocation</p>
						<p className="text-xs text-muted-foreground">
							{capacity.serverCommitments} committed: {capacity.liveBoxCount}{" "}
							boxes and {capacity.activeCheckoutCount} active checkouts
						</p>
					</div>
					<Input
						className="w-24 tabular-nums"
						disabled={busy !== null}
						max={100000}
						min={1}
						onChange={(event) => setServerDraft(event.target.value)}
						placeholder="Required"
						type="number"
						value={serverDraft}
					/>
				</div>
				<div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3">
					<div>
						<p className="text-sm">Snapshot allocation</p>
						<p className="text-xs text-muted-foreground">
							{capacity.snapshotCommitments} committed;{" "}
							{capacity.snapshotSlotsPerBox} reserved per box
						</p>
					</div>
					<Input
						className="w-24 tabular-nums"
						disabled={busy !== null}
						max={100000}
						min={1}
						onChange={(event) => setSnapshotDraft(event.target.value)}
						placeholder="Required"
						type="number"
						value={snapshotDraft}
					/>
				</div>
			</div>
		</div>
	);
}
