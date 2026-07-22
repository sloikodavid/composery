"use client";

import { usePaginatedQuery } from "convex/react";
import Link from "next/link";
import {
	AnimatedIconAnchor,
	AnimatedIconButton
} from "@/components/animated-icon";
import { StatusText } from "@/components/boxes/status-text";
import { buttonVariants } from "@/components/base/button";
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableLoadingRow,
	TableRow
} from "@/components/base/table";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/datetime";
import { boxPath } from "@/lib/box-route";

const BOX_PAGE_SIZE = 25;

export function BoxTable() {
	const {
		loadMore,
		results: boxes,
		status
	} = usePaginatedQuery(
		api.user.boxes.list,
		{},
		{ initialNumItems: BOX_PAGE_SIZE }
	);

	const loadingFirstPage = status === "LoadingFirstPage";
	const loadingMore = status === "LoadingMore";

	return (
		<div className="space-y-3">
			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<Table cols={["fluid", "date", "status", "actions-1"]}>
					<TableHeader>
						<TableRow>
							<TableHead className="pl-4">Slug</TableHead>
							<TableHead>Created</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="pr-4">
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>

					{loadingFirstPage ? (
						<TableBody>
							<TableLoadingRow />
						</TableBody>
					) : boxes.length > 0 ? (
						/* The slug link fills its whole cell, and hovering it tints the
						   whole row - but hovering anywhere else does nothing, so a
						   highlighted row always means "click goes to the box". */
						<TableBody className="page-fade-in">
							{boxes.map((box) => (
								<TableRow
									className="h-14 has-[[data-link]:hover]:bg-muted/50"
									key={box.id}
								>
									<TableCell className="relative p-0">
										<Link
											className="absolute inset-0 flex items-center pl-4"
											data-link
											href={boxPath(box.id)}
											prefetch={false}
										>
											<span className="truncate font-medium text-foreground">
												{box.slug}
											</span>
										</Link>
									</TableCell>
									<TableCell>{formatDate(box.createdAt)}</TableCell>
									<TableCell>
										<StatusText status={box.status} />
									</TableCell>
									<TableCell className="pr-4 text-right">
										<AnimatedIconAnchor
											aria-label={`Open ${box.slug}`}
											className={buttonVariants({
												size: "icon-sm",
												variant: "ghost"
											})}
											href={box.runtimeUrl}
											icon="arrow-up-right"
											iconPosition="only"
											rel="noreferrer"
											target="_blank"
										/>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					) : (
						<TableBody>
							<TableEmptyRow>No boxes yet.</TableEmptyRow>
						</TableBody>
					)}
				</Table>
			</div>

			{status === "CanLoadMore" || status === "LoadingMore" ? (
				<div className="flex justify-center">
					<AnimatedIconButton
						disabled={loadingMore}
						icon="arrow-right"
						onClick={() => loadMore(BOX_PAGE_SIZE)}
						variant="outline"
					>
						{loadingMore ? "Loading" : "Load more"}
					</AnimatedIconButton>
				</div>
			) : null}
		</div>
	);
}
