"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/input";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";
import { DEFAULT_THRESHOLDS } from "@/convex/boxes/metricThresholds";
import type { ThresholdSetting } from "@/convex/boxes/metricThresholds";

const SIGNAL_LABELS: Record<ThresholdSetting["signal"], string> = {
	egress_bandwidth: "Outbound bandwidth",
	egress_pps: "Outbound packet rate"
};

const SIGNAL_UNITS: Record<ThresholdSetting["signal"], string> = {
	egress_bandwidth: "Mbit/s",
	egress_pps: "packets/s"
};

// Bandwidth is stored in bytes/s (matches Hetzner's API and crossedValue) but
// edited in Mbit/s. PPS is pass-through.
const BITS_PER_BYTE = 8;
const MBIT_FACTOR = 1_000_000;

function toDisplayValue(signal: ThresholdSetting["signal"], stored: number) {
	if (signal === "egress_bandwidth") {
		return Math.round((stored * BITS_PER_BYTE) / MBIT_FACTOR);
	}
	return stored;
}

function toStoredValue(signal: ThresholdSetting["signal"], display: number) {
	if (signal === "egress_bandwidth") {
		return Math.round((display * MBIT_FACTOR) / BITS_PER_BYTE);
	}
	return display;
}

type Draft = {
	signal: ThresholdSetting["signal"];
	value: string;
	sustainedSamples: string;
};

function toDraft(threshold: ThresholdSetting): Draft {
	return {
		signal: threshold.signal,
		value: String(toDisplayValue(threshold.signal, threshold.value)),
		sustainedSamples: String(threshold.sustainedSamples)
	};
}

function toSetting(draft: Draft): ThresholdSetting {
	return {
		signal: draft.signal,
		value: toStoredValue(draft.signal, Number(draft.value)),
		sustainedSamples: Number(draft.sustainedSamples)
	};
}

function draftsEqual(a: Draft[], b: Draft[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((row, index) => {
		const other = b[index];
		return (
			row.signal === other?.signal &&
			row.value === other.value &&
			row.sustainedSamples === other.sustainedSamples
		);
	});
}

export function ConsoleThresholds({
	thresholds
}: {
	thresholds?: ThresholdSetting[];
}) {
	const setThresholds = useMutation(api.staff.settings.setThresholds);
	const { run, busy } = useBusyAction();
	const [drafts, setDrafts] = useState<Draft[]>(
		(thresholds ?? DEFAULT_THRESHOLDS).map(toDraft)
	);
	const [lastSynced, setLastSynced] = useState<ThresholdSetting[] | undefined>(
		thresholds
	);

	if (thresholds !== lastSynced) {
		setLastSynced(thresholds);
		if (thresholds) setDrafts(thresholds.map(toDraft));
	}

	const savedDrafts = (thresholds ?? []).map(toDraft);
	const dirty = !draftsEqual(drafts, savedDrafts);

	function updateField(
		signal: ThresholdSetting["signal"],
		field: keyof Draft,
		value: string
	) {
		setDrafts((rows) =>
			rows.map((row) =>
				row.signal === signal ? { ...row, [field]: value } : row
			)
		);
	}

	function reset() {
		setDrafts(DEFAULT_THRESHOLDS.map(toDraft));
	}

	function save() {
		run("thresholds", "Thresholds updated", () =>
			setThresholds({ thresholds: drafts.map(toSetting) })
		);
	}

	return (
		<div className="rounded-2xl border border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<h2 className="text-sm font-medium">Abuse thresholds</h2>
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
				{drafts.map((draft) => {
					const disabled = Number(draft.value) <= 0;
					return (
						<div
							className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3"
							key={draft.signal}
						>
							<span
								className={`text-sm ${disabled ? "text-muted-foreground" : "text-foreground"}`}
							>
								{SIGNAL_LABELS[draft.signal]}
							</span>
							<div className="flex items-center gap-1.5">
								<Input
									className="w-32 tabular-nums"
									disabled={busy !== null}
									min={0}
									onChange={(event) =>
										updateField(draft.signal, "value", event.target.value)
									}
									type="number"
									value={draft.value}
								/>
								<span className="w-16 shrink-0 text-xs text-muted-foreground">
									{disabled ? "disabled" : SIGNAL_UNITS[draft.signal]}
								</span>
							</div>
							<div className="flex items-center gap-1.5">
								<Input
									className="w-14 tabular-nums"
									disabled={busy !== null}
									min={1}
									onChange={(event) =>
										updateField(
											draft.signal,
											"sustainedSamples",
											event.target.value
										)
									}
									type="number"
									value={draft.sustainedSamples}
								/>
								<span className="shrink-0 text-xs text-muted-foreground">
									polls
								</span>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
