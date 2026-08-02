"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { CapacityUsage } from "@/convex/boxes/capacity";
import { useBusyAction } from "@/hooks/use-busy-action";
import { useSettingDraft } from "@/hooks/use-setting-draft";
import { NumberField, SettingsCard, SettingsRow } from "./settings-card";

const LIMIT_MAX = 100_000;

function draftValue(value: number | null) {
	return value === null ? "" : String(value);
}

// An empty field is "no allocation configured", which is a real state - capacity
// admission fails closed on it - so it parses to null rather than to zero.
function parsedLimit(value: string) {
	return value === "" ? null : Number(value);
}

function validLimit(value: number | null) {
	return (
		value === null ||
		(Number.isInteger(value) && value >= 1 && value <= LIMIT_MAX)
	);
}

function capacityStatus(
	capacity: CapacityUsage,
	serverLimit: number | null,
	snapshotLimit: number | null
) {
	if (capacity.blockReason === "limits_not_configured") {
		return "Set both allocations before checkout can start.";
	}

	const serverOvercommit =
		serverLimit !== null && capacity.serverCommitments > serverLimit;
	const snapshotOvercommit =
		snapshotLimit !== null && capacity.snapshotCommitments > snapshotLimit;
	if (serverOvercommit || snapshotOvercommit) {
		const which =
			serverOvercommit && snapshotOvercommit
				? "server and snapshot allocations"
				: serverOvercommit
					? "server allocation"
					: "snapshot allocation";
		return `Existing commitments exceed the configured ${which}. New checkout is blocked; existing boxes keep priority.`;
	}

	if (capacity.blockReason === "server_limit") {
		return "Server capacity is fully committed.";
	}
	if (capacity.blockReason === "snapshot_limit") {
		return "Snapshot capacity is fully committed.";
	}
	if (capacity.blockReason === "manual_pause") {
		return "Capacity is available, but checkout is manually paused.";
	}
	return `${capacity.availableNewBoxes} additional box${capacity.availableNewBoxes === 1 ? "" : "es"} can be reserved.`;
}

export function Capacity({
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
	const { draft, dirty, setField } = useSettingDraft({
		server: draftValue(serverLimit),
		snapshot: draftValue(snapshotLimit)
	});

	const nextServerLimit = parsedLimit(draft.server ?? "");
	const nextSnapshotLimit = parsedLimit(draft.snapshot ?? "");
	// Both or neither: one allocation alone cannot admit a box, and the mutation
	// refuses the half-configured pair, so the button refuses it too.
	const bothSetOrCleared =
		(nextServerLimit === null) === (nextSnapshotLimit === null);
	const valid =
		bothSetOrCleared &&
		validLimit(nextServerLimit) &&
		validLimit(nextSnapshotLimit);

	return (
		<SettingsCard
			onSave={() =>
				run("hetzner-capacity", "Hetzner capacity updated", () =>
					setLimits({
						serverLimit: nextServerLimit,
						snapshotLimit: nextSnapshotLimit
					})
				)
			}
			saveDisabled={!dirty || !valid || busy !== null}
			subtitle={capacityStatus(capacity, serverLimit, snapshotLimit)}
			title="Hetzner capacity"
		>
			<SettingsRow
				label={
					<div>
						<p className="text-sm">Server allocation</p>
						<p className="text-xs text-muted-foreground">
							{capacity.serverCommitments} committed: {capacity.liveBoxCount}{" "}
							boxes and {capacity.activeCheckoutCount} active checkouts
						</p>
					</div>
				}
			>
				<NumberField
					disabled={busy !== null}
					inputClassName="w-24"
					max={LIMIT_MAX}
					min={1}
					onChange={(value) => setField("server", value)}
					placeholder="Required"
					value={draft.server ?? ""}
				/>
			</SettingsRow>
			<SettingsRow
				label={
					<div>
						<p className="text-sm">Snapshot allocation</p>
						<p className="text-xs text-muted-foreground">
							{capacity.snapshotCommitments} committed;{" "}
							{capacity.snapshotSlotsPerBox} reserved per new box
						</p>
					</div>
				}
			>
				<NumberField
					disabled={busy !== null}
					inputClassName="w-24"
					max={LIMIT_MAX}
					min={1}
					onChange={(value) => setField("snapshot", value)}
					placeholder="Required"
					value={draft.snapshot ?? ""}
				/>
			</SettingsRow>
		</SettingsCard>
	);
}
