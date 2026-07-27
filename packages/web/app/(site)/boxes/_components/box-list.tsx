"use client";

import { usePaginatedQuery } from "convex/react";
import { LoaderIcon } from "lucide-react";
import Link from "next/link";
import {
	AnimatedIconAnchor,
	AnimatedIconButton
} from "@/components/animated-icon";
import { StatusText } from "@/components/boxes/status-text";
import { buttonVariants } from "@/components/base/button";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/datetime";
import { boxPath } from "@/lib/box-route";

const BOX_PAGE_SIZE = 25;

// The two sized columns, shared by the header and every row so they line up as
// columns from sm up. Same widths as the Table component's `date` and `status`
// tokens, since they hold the same things - a formatDate and a StatusText.
const DATE_COL = "hidden w-32 shrink-0 sm:block";
const STATUS_COL = "shrink-0 sm:w-48";
// Header spacer over the row's open-box button (buttonVariants' `icon-sm` is
// size-7, and already shrink-0).
const ACTION_COL = "w-7";

export function BoxList() {
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
			{/* Flex rows rather than the Table component: a table reserves the sum
			    of its column widths and scrolls the container below that, and three
			    columns don't fit a phone. These rows read as a table from sm up -
			    header, fixed columns, aligned - and collapse to a list below it,
			    where the created date moves under the slug. */}
			<div className="overflow-hidden rounded-2xl border border-border bg-card text-sm">
				<div className="hidden h-10 items-center gap-3 border-b border-border px-4 font-medium text-foreground sm:flex">
					<span className="flex-1">Slug</span>
					<span className={DATE_COL}>Created</span>
					<span className={STATUS_COL}>Status</span>
					<span className={ACTION_COL} />
				</div>

				{loadingFirstPage ? (
					<div className="flex h-14 items-center justify-center">
						<LoaderIcon className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : boxes.length > 0 ? (
					<div className="page-fade-in divide-y divide-border">
						{boxes.map((box) => (
							/* The slug link fills the free space, and hovering it tints the
							   whole row - but hovering anywhere else does nothing, so a
							   highlighted row always means "click goes to the box". */
							<div
								className="flex h-14 items-center gap-3 px-4 has-[[data-link]:hover]:bg-muted/50"
								key={box.id}
							>
								{/* self-stretch, so the link is the full height of its column
								    rather than just the height of the text in it - that is
								    what makes the whole slug area both the hover target and
								    the click target. */}
								<Link
									className="flex min-w-0 flex-1 flex-col justify-center self-stretch"
									data-link
									href={boxPath(box.id)}
									prefetch={false}
								>
									<span className="block truncate font-medium text-foreground">
										{box.slug}
									</span>
									<span className="block truncate text-xs text-muted-foreground sm:hidden">
										{formatDate(box.createdAt)}
									</span>
								</Link>
								<span className={`${DATE_COL} text-muted-foreground`}>
									{formatDate(box.createdAt)}
								</span>
								<StatusText
									className={STATUS_COL}
									kind="box"
									status={box.status}
								/>
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
							</div>
						))}
					</div>
				) : (
					<div className="flex h-14 items-center justify-center text-muted-foreground">
						No boxes yet.
					</div>
				)}
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
