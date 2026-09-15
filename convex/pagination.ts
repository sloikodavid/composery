import type { PaginationOptions } from "convex/server";

/** The largest page that a public list returns. A client can ask for fewer items. */
export const maxPageSize = 100;

export function toBoundedPagination(
	paginationOpts: PaginationOptions,
): PaginationOptions {
	return {
		...paginationOpts,
		numItems: Math.max(1, Math.min(paginationOpts.numItems, maxPageSize)),
	};
}
