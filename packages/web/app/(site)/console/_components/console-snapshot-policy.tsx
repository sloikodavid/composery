"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/input";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";
import {
	DEFAULT_SNAPSHOT_POLICY,
	type SnapshotPolicy
} from "@/convex/boxes/snapshotPolicy";

type FieldKey =
	| "manualCap"
	| "automaticCap"
	| "manualMinIntervalMinutes"
	| "manualRetentionDays"
	| "automaticRetentionDays";

const FIELDS: { key: FieldKey; label: string; unit: string }[] = [
	{ key: "manualCap", label: "Manual cap", unit: "snapshots" },
	{ key: "automaticCap", label: "Automatic cap", unit: "snapshots" },
	{
		key: "manualMinIntervalMinutes",
		label: "Manual cooldown",
		unit: "minutes"
	},
	{
		key: "manualRetentionDays",
		label: "Manual retention",
		unit: "days"
	},
	{
		key: "automaticRetentionDays",
		label: "Automatic retention",
		unit: "days"
	}
];

type Draft = Record<FieldKey, string>;

function toDraft(policy: SnapshotPolicy): Draft {
	return {
		manualCap: String(policy.manualCap),
		automaticCap: String(policy.automaticCap),
		manualMinIntervalMinutes: String(policy.manualMinIntervalMinutes),
		manualRetentionDays: String(policy.manualRetentionDays),
		automaticRetentionDays: String(policy.automaticRetentionDays)
	};
}

function toPolicy(draft: Draft): SnapshotPolicy {
	return {
		manualCap: Number(draft.manualCap),
		automaticCap: Number(draft.automaticCap),
		manualMinIntervalMinutes: Number(draft.manualMinIntervalMinutes),
		manualRetentionDays: Number(draft.manualRetentionDays),
		automaticRetentionDays: Number(draft.automaticRetentionDays)
	};
}

function draftsEqual(a: Draft, b: Draft): boolean {
	return (Object.keys(a) as FieldKey[]).every((key) => a[key] === b[key]);
}

export function ConsoleSnapshotPolicy({ policy }: { policy?: SnapshotPolicy }) {
	const setSnapshotPolicy = useMutation(api.staff.settings.setSnapshotPolicy);
	const { run, busy } = useBusyAction();
	const [draft, setDraft] = useState<Draft>(
		toDraft(policy ?? DEFAULT_SNAPSHOT_POLICY)
	);
	const [lastSynced, setLastSynced] = useState<SnapshotPolicy | undefined>(
		policy
	);

	if (policy !== lastSynced) {
		setLastSynced(policy);
		if (policy) setDraft(toDraft(policy));
	}

	const savedDraft = policy
		? toDraft(policy)
		: toDraft(DEFAULT_SNAPSHOT_POLICY);
	const dirty = !draftsEqual(draft, savedDraft);

	function updateField(key: FieldKey, value: string) {
		setDraft((d) => ({ ...d, [key]: value }));
	}

	function reset() {
		setDraft(toDraft(DEFAULT_SNAPSHOT_POLICY));
	}

	function save() {
		run("snapshot-policy", "Snapshot policy updated", () =>
			setSnapshotPolicy({ policy: toPolicy(draft) })
		);
	}

	return (
		<div className="rounded-2xl border border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<h2 className="text-sm font-medium">Snapshot policy</h2>
				<div className="flex gap-2">
					<AnimatedIconButton
						disabled={!dirty || busy !== null}
						icon="check"
						iconPosition="start"
						onClick={save}
						size="sm"
					>
						Save
					</AnimatedIconButton>
					<AnimatedIconButton
						disabled={busy !== null}
						icon="rotate-cw"
						iconPosition="start"
						onClick={reset}
						size="sm"
						variant="outline"
					>
						Reset
					</AnimatedIconButton>
				</div>
			</div>
			<div className="divide-y divide-border">
				{FIELDS.map((field) => (
					<div
						className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
						key={field.key}
					>
						<span className="text-sm">{field.label}</span>
						<div className="flex items-center gap-1.5">
							<Input
								className="w-20 tabular-nums"
								disabled={busy !== null}
								min={1}
								onChange={(event) => updateField(field.key, event.target.value)}
								type="number"
								value={draft[field.key]}
							/>
							<span className="w-20 shrink-0 text-xs text-muted-foreground">
								{field.unit}
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
