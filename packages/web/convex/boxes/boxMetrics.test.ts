import { describe, expect, it } from "vitest";
import { rollupMetricMeans, type RollupMetricSample } from "./boxMetrics";

function sample(value: number): RollupMetricSample {
	return {
		cpu_percent: value,
		ingress_bps: value + 1,
		egress_bps: value + 2,
		ingress_pps: value + 3,
		egress_pps: value + 4,
		disk_read_bps: value + 5,
		disk_write_bps: value + 6
	};
}

describe("rollupMetricMeans", () => {
	it("averages every rolled metric independently", () => {
		expect(rollupMetricMeans([sample(10), sample(20)])).toEqual({
			cpu_percent: 15,
			ingress_bps: 16,
			egress_bps: 17,
			ingress_pps: 18,
			egress_pps: 19,
			disk_read_bps: 20,
			disk_write_bps: 21
		});
	});

	it("does not mutate input samples", () => {
		const samples = [sample(1), sample(2)];
		const before = structuredClone(samples);

		rollupMetricMeans(samples);

		expect(samples).toEqual(before);
	});
});
