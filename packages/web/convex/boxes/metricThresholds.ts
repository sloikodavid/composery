import type { BoxFlagSignal, StoredThreshold } from "../schema";

export type ThresholdSpec = {
	value: number;
	sustainedSamples: number;
};

export type ThresholdSetting = {
	signal: BoxFlagSignal;
	value: number;
	sustainedSamples: number;
};

export const DEFAULT_THRESHOLDS: readonly ThresholdSetting[] = [
	{
		signal: "egress_bandwidth",
		value: 25_000_000,
		sustainedSamples: 3
	},
	{
		signal: "egress_pps",
		value: 30_000,
		sustainedSamples: 3
	}
];

export const THRESHOLD_SIGNALS = DEFAULT_THRESHOLDS.map(
	(threshold) => threshold.signal
);

function validThresholdValue(threshold: ThresholdSpec) {
	return (
		Number.isFinite(threshold.value) &&
		threshold.value >= 0 &&
		Number.isInteger(threshold.sustainedSamples) &&
		threshold.sustainedSamples >= 1
	);
}

export function isEnabled(threshold: ThresholdSetting) {
	return threshold.value > 0;
}

export function resolveThresholds(
	stored: StoredThreshold[] | undefined
): ThresholdSetting[] {
	return DEFAULT_THRESHOLDS.map((def) => {
		const override = stored?.find(
			(row) =>
				row.signal === def.signal &&
				validThresholdValue({
					value: row.value,
					sustainedSamples: row.sustained_samples
				})
		);
		if (!override) return def;
		return {
			signal: override.signal,
			value: override.value,
			sustainedSamples: override.sustained_samples
		};
	});
}

export function thresholdsToStored(
	thresholds: readonly ThresholdSetting[]
): StoredThreshold[] {
	validateThresholds(thresholds);
	return thresholds.map((threshold) => ({
		signal: threshold.signal,
		value: threshold.value,
		sustained_samples: threshold.sustainedSamples
	}));
}

export function validateThresholds(thresholds: readonly ThresholdSetting[]) {
	const seen = new Set<BoxFlagSignal>();
	for (const threshold of thresholds) {
		if (!THRESHOLD_SIGNALS.includes(threshold.signal)) {
			throw new Error(`Unknown threshold signal: ${threshold.signal}.`);
		}
		if (seen.has(threshold.signal)) {
			throw new Error(`Duplicate threshold for signal: ${threshold.signal}.`);
		}
		seen.add(threshold.signal);

		if (!Number.isFinite(threshold.value) || threshold.value < 0) {
			throw new Error(
				`Threshold value for ${threshold.signal} must be >= 0 (0 disables).`
			);
		}
		if (
			!Number.isInteger(threshold.sustainedSamples) ||
			threshold.sustainedSamples < 1
		) {
			throw new Error(
				`Sustained samples for ${threshold.signal} must be a positive integer.`
			);
		}
	}

	const missing = THRESHOLD_SIGNALS.filter((signal) => !seen.has(signal));
	if (missing.length > 0) {
		throw new Error(
			`Provide a threshold for every signal (${missing.join(", ")} missing).`
		);
	}
}

// Decides whether a threshold is "sustained": the most recent N values must all
// be at or above the threshold. Returns the mean of that window when sustained,
// null otherwise. Values are assumed newest-first (the caller orders desc).
export function crossedValue(values: number[], threshold: ThresholdSpec) {
	if (values.length < threshold.sustainedSamples) return null;
	const window = values.slice(0, threshold.sustainedSamples);
	if (!window.every((value) => value >= threshold.value)) return null;
	return window.reduce((sum, value) => sum + value, 0) / window.length;
}
