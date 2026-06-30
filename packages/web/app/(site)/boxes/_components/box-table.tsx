"use client";

import { usePaginatedQuery } from "convex/react";
import { LoaderIcon } from "lucide-react";
import Link from "next/link";
import {
	AnimatedIconAnchor,
	AnimatedIconButton
} from "@/components/animated-icon";
import { StatusText } from "@/components/status-text";
import { buttonVariants } from "@/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow
} from "@/components/table";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/datetime";

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
				<Table className="table-fixed min-w-[30rem]">
					<TableHeader>
						<TableRow>
							<TableHead className="pl-4">Slug</TableHead>
							<TableHead className="w-28">Created</TableHead>
							<TableHead className="w-36">Status</TableHead>
							<TableHead className="w-14 pr-2">
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>

					{loadingFirstPage ? (
						<TableBody>
							<TableRow>
								<TableCell className="h-14 text-center" colSpan={4}>
									<LoaderIcon className="mx-auto size-5 animate-spin text-muted-foreground" />
								</TableCell>
							</TableRow>
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
											href={`/boxes/${box.slug}`}
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
									<TableCell className="pr-2 text-right">
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
							<TableRow>
								<TableCell
									className="h-14 text-center text-muted-foreground"
									colSpan={4}
								>
									No boxes yet.
								</TableCell>
							</TableRow>
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
