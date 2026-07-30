"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import {
	DEFAULT_METRIC,
	DEFAULT_RANGE,
	MetricSelect,
	MetricsLineChart,
	MetricsRangeSelect,
	type MetricsRange
} from "@/components/boxes/metrics-chart";
import { api } from "@/convex/_generated/api";

// The all-boxes overlay: the top boxes ranked by the selected metric's latest
// rolled-up hour, so a fleet of any size stays readable.
export function ConsoleMetrics() {
	const [metricKey, setMetricKey] = useState(DEFAULT_METRIC);
	const [range, setRange] = useState<MetricsRange>(DEFAULT_RANGE);
	const series = useQuery(api.staff.metrics.series, {
		metric: metricKey,
		range
	});

	return (
		<div className="relative rounded-2xl border border-border bg-card">
			<div className="absolute top-3 left-3 z-10 flex gap-2">
				<MetricSelect onChange={setMetricKey} value={metricKey} />
				<MetricsRangeSelect onChange={setRange} value={range} />
			</div>
			<div className="p-4 pt-12">
				<MetricsLineChart
					className="h-78"
					metricKey={metricKey}
					range={range}
					series={series}
				/>
			</div>
		</div>
	);
}
