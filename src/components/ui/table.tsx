import type { Route } from "next";
import { Card } from "@/components/ui/card";
import { Link } from "@/components/ui/link";

type TableColumn = {
	href: Route;
	id: string;
	text: string;
};

type TableColumns = readonly [TableColumn, ...TableColumn[]];

type TableRow<Columns extends TableColumns> = {
	cells: { readonly [Index in keyof Columns]: string };
	href: Route;
	id: string;
};

export function Table<const Columns extends TableColumns>({
	columns,
	label,
	rows,
}: {
	columns: Columns;
	label: string;
	rows: readonly TableRow<Columns>[];
}) {
	return (
		<Card padding="none" className="overflow-x-auto">
			<table
				className="w-full min-w-lg table-fixed text-left text-sm"
				aria-label={label}
			>
				<thead>
					<tr className="border-border border-b">
						{columns.map((column) => (
							<th
								key={column.id}
								scope="col"
								className="border-border border-l px-3 py-2 font-normal text-muted first:border-l-0"
							>
								<Link href={column.href} font="brand">
									{column.text}
								</Link>
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.id}
							className="border-border border-t first:border-t-0"
						>
							<td className="px-3 py-2">
								<Link href={row.href}>{row.cells[0]}</Link>
							</td>
							{columns.slice(1).map((column, index) => (
								<td
									key={column.id}
									className="border-border border-l px-3 py-2"
								>
									{row.cells[index + 1]}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</Card>
	);
}
