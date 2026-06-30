"use client";

import { ChartLineIcon, LoaderIcon } from "lucide-react";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig
} from "@/components/chart";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	type SelectTriggerVariant,
	SelectValue
} from "@/components/select";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/datetime";

export type MetricsSeries = {
	samples: {
		cpuPercent: number;
		diskReadBps: number;
		diskWriteBps: number;
		egressBps: number;
		egressPps: number;
		ingressBps: number;
		ingressPps: number;
		sampledAt: number;
	}[];
	slug: string;
};

type Sample = MetricsSeries["samples"][number];

type MetricField =
	| "cpu_percent"
	| "disk_read_bps"
	| "disk_write_bps"
	| "egress_bps"
	| "egress_pps"
	| "ingress_bps"
	| "ingress_pps";

type Metric = {
	field: MetricField;
	format: (value: number) => string;
	label: string;
	value: (sample: Sample) => number;
};

function formatMbit(value: number) {
	return `${value.toFixed(value < 10 ? 1 : 0)} Mbit/s`;
}

function formatMbyte(value: number) {
	return `${value.toFixed(value < 10 ? 1 : 0)} MB/s`;
}

const METRICS: Record<string, Metric> = {
	cpu: {
		label: "CPU",
		field: "cpu_percent",
		value: (sample) => sample.cpuPercent,
		format: (value) => `${Math.round(value)}%`
	},
	network_out: {
		label: "Network out",
		field: "egress_bps",
		value: (sample) => (sample.egressBps * 8) / 1_000_000,
		format: formatMbit
	},
	network_in: {
		label: "Network in",
		field: "ingress_bps",
		value: (sample) => (sample.ingressBps * 8) / 1_000_000,
		format: formatMbit
	},
	packets_out: {
		label: "Packets out",
		field: "egress_pps",
		value: (sample) => sample.egressPps,
		format: (value) => `${Math.round(value).toLocaleString()} pps`
	},
	disk_read: {
		label: "Disk read",
		field: "disk_read_bps",
		value: (sample) => sample.diskReadBps / 1_000_000,
		format: formatMbyte
	},
	disk_write: {
		label: "Disk write",
		field: "disk_write_bps",
		value: (sample) => sample.diskWriteBps / 1_000_000,
		format: formatMbyte
	}
};

export const DEFAULT_METRIC = "cpu";

export function metricField(metricKey: string): MetricField {
	return METRICS[metricKey]?.field ?? "cpu_percent";
}

const METRIC_ITEMS = Object.fromEntries(
	Object.entries(METRICS).map(([key, { label }]) => [key, label])
);

export type MetricsRange = "1h" | "6h" | "24h" | "7d" | "30d";

export const DEFAULT_RANGE: MetricsRange = "24h";

const RANGE_ITEMS: Record<MetricsRange, string> = {
	"1h": "1 hour",
	"6h": "6 hours",
	"24h": "24 hours",
	"7d": "7 days",
	"30d": "30 days"
};

// Bucket width scales with the range so longer windows stay readable: raw
// 10-minute samples keep their 10-minute buckets, hourly rollups bucket by
// the hour (7d) or six hours (30d).
const RANGE_BUCKET_MS: Record<MetricsRange, number> = {
	"1h": 10 * 60 * 1000,
	"6h": 10 * 60 * 1000,
	"24h": 10 * 60 * 1000,
	"7d": 60 * 60 * 1000,
	"30d": 6 * 60 * 60 * 1000
};

const LINE_COLORS = 5;

export function MetricSelect({
	onChange,
	triggerVariant,
	value
}: {
	onChange: (value: string) => void;
	triggerVariant?: SelectTriggerVariant;
	value: string;
}) {
	return (
		<Select
			items={METRIC_ITEMS}
			onValueChange={(next) => onChange(next ?? DEFAULT_METRIC)}
			value={value}
		>
			<SelectTrigger className="w-36" variant={triggerVariant}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{Object.entries(METRICS).map(([key, { label }]) => (
					<SelectItem key={key} value={key}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function MetricsRangeSelect({
	onChange,
	triggerVariant,
	value
}: {
	onChange: (value: MetricsRange) => void;
	triggerVariant?: SelectTriggerVariant;
	value: MetricsRange;
}) {
	return (
		<Select
			items={RANGE_ITEMS}
			onValueChange={(next) =>
				onChange((next as MetricsRange | undefined) ?? DEFAULT_RANGE)
			}
			value={value}
		>
			<SelectTrigger className="w-32" variant={triggerVariant}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{Object.entries(RANGE_ITEMS).map(([key, label]) => (
					<SelectItem key={key} value={key}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function MetricsLineChart({
	className,
	metricKey,
	range,
	series
}: {
	className: string;
	metricKey: string;
	range: MetricsRange;
	series?: MetricsSeries[];
}) {
	const metric = METRICS[metricKey];
	const bucketMs = RANGE_BUCKET_MS[range];
	const longRange = bucketMs >= 60 * 60 * 1000;

	const { config, rows } = useMemo(() => {
		const config: ChartConfig = {};
		const buckets = new Map<number, Record<string, number>>();

		for (const [index, { samples, slug }] of (series ?? []).entries()) {
			config[slug] = {
				label: slug,
				color: `var(--chart-${(index % LINE_COLORS) + 1})`
			};
			for (const sample of samples) {
				const at = Math.round(sample.sampledAt / bucketMs) * bucketMs;
				const row = buckets.get(at) ?? {};
				row[slug] = metric.value(sample);
				buckets.set(at, row);
			}
		}

		const rows = [...buckets.entries()]
			.sort(([first], [second]) => first - second)
			.map(([at, values]) => ({ at, ...values }));
		return { config, rows };
	}, [series, metric, bucketMs]);

	if (series === undefined) {
		return (
			<div className={cn("flex items-center justify-center", className)}>
				<LoaderIcon className="size-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div className={cn("flex items-center justify-center", className)}>
				<div className="flex flex-col items-center gap-1.5 text-center">
					<ChartLineIcon className="size-5 text-muted-foreground" />
					<p className="text-sm text-muted-foreground">No samples yet.</p>
				</div>
			</div>
		);
	}

	return (
		<ChartContainer className={cn("w-full", className)} config={config}>
			<LineChart data={rows} margin={{ left: 0, right: 12, top: 4 }}>
				<CartesianGrid vertical={false} />
				<XAxis
					axisLine={false}
					dataKey="at"
					domain={["dataMin", "dataMax"]}
					minTickGap={longRange ? 48 : 24}
					scale="time"
					tickFormatter={(value: number) =>
						longRange
							? formatDate(value)
							: new Date(value).toLocaleTimeString(undefined, {
									hour: "2-digit",
									minute: "2-digit"
								})
					}
					tickLine={false}
					tickMargin={8}
					type="number"
				/>
				<YAxis
					axisLine={false}
					tickFormatter={(value: number) => metric.format(value)}
					tickLine={false}
					width={70}
				/>
				<ChartTooltip
					content={
						<ChartTooltipContent
							labelFormatter={(_, payload) =>
								formatDateTime(payload?.[0]?.payload?.at)
							}
						/>
					}
				/>
				{Object.keys(config).map((slug) => (
					<Line
						connectNulls
						dataKey={slug}
						dot={false}
						isAnimationActive={false}
						key={slug}
						stroke={`var(--color-${slug})`}
						strokeWidth={1.5}
						type="monotone"
					/>
				))}
			</LineChart>
		</ChartContainer>
	);
}
