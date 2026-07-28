import { describe, expect, test } from "vitest";
import {
	DEFAULT_THRESHOLDS,
	crossedValue,
	resolveThresholds,
	thresholdsToStored,
	validateThresholds
} from "@/convex/boxes/metricThresholds";
import type { StoredThreshold } from "@/convex/schema";

const threshold = { value: 100, sustainedSamples: 3 } as const;

describe("crossedValue", () => {
	test("returns null when fewer values than the sustained window", () => {
		expect(crossedValue([500], threshold)).toBeNull();
		expect(crossedValue([500, 500], threshold)).toBeNull();
	});

	test("returns the window mean when the latest N values all cross", () => {
		expect(crossedValue([300, 200, 100], threshold)).toBe(200);
	});

	test("ignores older values beyond the window", () => {
		expect(crossedValue([300, 200, 100, 0, 0], threshold)).toBe(200);
	});

	test("returns null when any of the latest N values is below the threshold", () => {
		expect(crossedValue([300, 99, 100], threshold)).toBeNull();
		expect(crossedValue([99, 300, 200], threshold)).toBeNull();
	});

	test("treats an exactly-at-threshold value as crossing (>=)", () => {
		expect(crossedValue([100, 100, 100], threshold)).toBe(100);
	});

	test("returns null for an empty value set", () => {
		expect(crossedValue([], threshold)).toBeNull();
	});

	test("computes the mean of the crossing window, not the whole series", () => {
		expect(crossedValue([150, 250, 350, 0], threshold)).toBe(250);
	});

	test("does not mutate the input array", () => {
		const input = [300, 200, 100];
		const snapshot = [...input];
		crossedValue(input, threshold);
		expect(input).toEqual(snapshot);
	});

	test("handles a single-sample sustained window", () => {
		const one = { value: 100, sustainedSamples: 1 };
		expect(crossedValue([150], one)).toBe(150);
		expect(crossedValue([99], one)).toBeNull();
	});
});

describe("resolveThresholds", () => {
	test("returns a complete default threshold set without stored overrides", () => {
		expect(resolveThresholds(undefined)).toEqual(DEFAULT_THRESHOLDS);
	});

	test("keeps valid stored overrides, including disabled thresholds", () => {
		expect(
			resolveThresholds([
				{
					signal: "egress_bandwidth",
					value: 0,
					sustained_samples: 1
				}
			])
		).toEqual([
			{
				signal: "egress_bandwidth",
				value: 0,
				sustainedSamples: 1
			},
			DEFAULT_THRESHOLDS[1]
		]);
	});

	test("falls back per signal when persisted overrides are unsafe", () => {
		const stored: StoredThreshold[] = [
			{
				signal: "egress_bandwidth",
				value: -1,
				sustained_samples: 1
			},
			{
				signal: "egress_pps",
				value: 10,
				sustained_samples: 0
			}
		];

		expect(resolveThresholds(stored)).toEqual(DEFAULT_THRESHOLDS);
	});
});

describe("validateThresholds", () => {
	test("requires one threshold for every supported signal", () => {
		expect(() => validateThresholds([DEFAULT_THRESHOLDS[0]])).toThrow(
			"Provide a threshold for every signal"
		);
	});

	test("rejects invalid threshold values before storage conversion", () => {
		expect(() =>
			thresholdsToStored([
				{ ...DEFAULT_THRESHOLDS[0], sustainedSamples: 0 },
				DEFAULT_THRESHOLDS[1]
			])
		).toThrow("Sustained samples for egress_bandwidth");
	});
});
