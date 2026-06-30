"use client";

import { useMemo, useState } from "react";

export type SortDirection = "ascending" | "descending";

export type TableSortControls<Key extends string> = {
	sortDirection: SortDirection;
	sortKey: Key | null;
	toggleSort: (key: Key) => void;
};

export function useTableSort<Row, Key extends string>(
	rows: Row[],
	accessors: Record<Key, (row: Row) => string | number>
) {
	const [sortKey, setSortKey] = useState<Key | null>(null);
	const [sortDirection, setSortDirection] =
		useState<SortDirection>("ascending");

	const sortedRows = useMemo(() => {
		if (sortKey === null) return rows;
		const read = accessors[sortKey];
		return [...rows].sort((first, second) => {
			const firstValue = read(first);
			const secondValue = read(second);
			const result =
				typeof firstValue === "number" && typeof secondValue === "number"
					? firstValue - secondValue
					: String(firstValue).localeCompare(String(secondValue));
			return sortDirection === "ascending" ? result : -result;
		});
	}, [accessors, rows, sortDirection, sortKey]);

	function toggleSort(nextKey: Key) {
		if (sortKey === nextKey) {
			setSortDirection((current) =>
				current === "ascending" ? "descending" : "ascending"
			);
			return;
		}
		setSortKey(nextKey);
		setSortDirection("ascending");
	}

	const sort: TableSortControls<Key> = { sortDirection, sortKey, toggleSort };
	return { sort, sortedRows };
}
