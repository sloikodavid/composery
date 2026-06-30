"use client";

import Link from "next/link";
import { OpenInConvex } from "@/components/open-in-convex";
import { SortHeader } from "@/components/sort-header";
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableLoadingRow,
	TableRow
} from "@/components/table";
import { useTableSort } from "@/hooks/use-table-sort";
import { formatDateTime } from "@/lib/datetime";

export type FlagRow = {
	autoSuspended: boolean;
	createdAt: number;
	id: string;
	message: string;
	signal: string;
	slug: string;
};

const SIGNAL_LABELS: Record<string, string> = {
	egress_bandwidth: "Network out",
	egress_pps: "Packets out"
};

function signalLabel(flag: FlagRow) {
	return SIGNAL_LABELS[flag.signal] ?? flag.signal;
}

const FLAG_SORT = {
	flag: signalLabel,
	slug: (flag: FlagRow) => flag.slug,
	createdAt: (flag: FlagRow) => flag.createdAt
};

// Abuse threshold crossings as a standalone panel; `showBox` adds the box
// column for the cross-box list on the console home.
export function FlagsTable({
	flags,
	showBox
}: {
	flags?: FlagRow[];
	showBox?: boolean;
}) {
	const { sort, sortedRows } = useTableSort(flags ?? [], FLAG_SORT);
	const span = showBox ? 4 : 3;

	return (
		<div className="overflow-hidden rounded-2xl border border-border bg-card">
			<Table className="table-fixed min-w-[37rem]">
				<TableHeader>
					<TableRow>
						<TableHead className="pl-4">
							<SortHeader label="Flag" sort={sort} sortKey="flag" />
						</TableHead>
						{showBox ? (
							<TableHead className="w-48">
								<SortHeader label="Box" sort={sort} sortKey="slug" />
							</TableHead>
						) : null}
						<TableHead className="w-36">
							<SortHeader label="Created" sort={sort} sortKey="createdAt" />
						</TableHead>
						<TableHead className="w-14 pr-2 text-right">
							<OpenInConvex iconOnly table="box_flags" />
						</TableHead>
					</TableRow>
				</TableHeader>
				{flags === undefined ? (
					<TableBody>
						<TableLoadingRow span={span} />
					</TableBody>
				) : flags.length > 0 ? (
					<TableBody className="page-fade-in">
						{sortedRows.map((flag) => (
							<TableRow
								className="[&>td]:align-top has-[[data-link]:hover]:bg-muted/50"
								key={flag.id}
							>
								<TableCell className="pl-4">
									<div className="min-w-0">
										<p className="font-medium wrap-break-word text-foreground">
											{signalLabel(flag)}
											{flag.autoSuspended ? " - auto-suspended" : ""}
										</p>
										<p className="wrap-break-word whitespace-normal text-muted-foreground">
											{flag.message}
										</p>
									</div>
								</TableCell>
								{showBox ? (
									<TableCell className="relative p-0">
										<Link
											className="absolute inset-0 flex items-center px-2 text-foreground"
											data-link
											href={`/console/boxes/${flag.slug}`}
										>
											<span className="truncate">{flag.slug}</span>
										</Link>
									</TableCell>
								) : null}
								<TableCell>{formatDateTime(flag.createdAt)}</TableCell>
								<TableCell className="pr-2 text-right">
									<OpenInConvex
										iconOnly
										label={`Open ${flag.slug} flag in Convex`}
										table="box_flags"
										value={flag.id}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				) : (
					<TableBody>
						<TableEmptyRow span={span}>No flags.</TableEmptyRow>
					</TableBody>
				)}
			</Table>
		</div>
	);
}
