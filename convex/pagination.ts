import type { PaginationOptions } from "convex/server";

export const maxPageSize = 100;

export function toBoundedPagination(
	paginationOpts: PaginationOptions,
): PaginationOptions {
	return {
		...paginationOpts,
		numItems: Math.max(1, Math.min(paginationOpts.numItems, maxPageSize)),
	};
}
