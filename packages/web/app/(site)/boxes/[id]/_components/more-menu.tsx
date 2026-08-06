"use client";

import Link from "next/link";
import {
	DownloadIcon,
	EllipsisIcon,
	LockIcon,
	PenToolIcon,
	SquarePenIcon,
	Trash2Icon,
	WrenchIcon
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/base/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from "@/components/base/dropdown-menu";
import { ChangeSlugDialog } from "@/components/box/change-slug-dialog";
import {
	RepairDialog,
	type RepairOperation
} from "@/components/box/repair-dialog";
import { ResetDialog } from "@/components/box/reset-dialog";
import type { RecoveryStatus } from "@/convex/model/box/recovery";
import { type BoxStatus } from "@/convex/model/box/status";
import { boxPath } from "@/convex/model/box/path";
import { BoxSnapshots } from "./box-snapshots";
import type { BoxPlan, SnapshotSplit } from "@/convex/model/box/plan";

// Which dialog the menu opened, if any.
type MenuTarget = "slug" | "snapshots" | "repair" | "reset";

// The box's secondary actions, one dropdown instead of a row of buttons. What
// stays visible is what an owner reaches for: the status action, connecting,
// and updating. Everything here opens a dialog or leaves the page, so a menu
// item is one action and nothing more.
//
// The dialogs render beside the menu, never inside it: the menu's popup
// unmounts when it closes, which would take an open dialog with it.
export function MoreMenu({
	boxId,
	boxStatus,
	busy,
	changeSlug,
	checkRepair,
	onRepair,
	onReset,
	plan,
	repair,
	runtimeUrl,
	slug,
	split
}: {
	boxId: string;
	boxStatus: BoxStatus;
	busy: string | null;
	changeSlug: (newSlug: string) => Promise<unknown>;
	checkRepair: () => Promise<RecoveryStatus>;
	onRepair: () => Promise<void>;
	onReset: () => Promise<void>;
	plan: BoxPlan;
	repair: RepairOperation | null;
	runtimeUrl: string;
	slug: string;
	split: SnapshotSplit;
}) {
	const [target, setTarget] = useState<MenuTarget | null>(null);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="outline">
							<EllipsisIcon />
							More
						</Button>
					}
				/>
				<DropdownMenuContent align="end" className="w-56">
					<DropdownMenuItem
						render={<Link href={`${boxPath(boxId)}/configuration`} />}
					>
						<PenToolIcon />
						Configure
					</DropdownMenuItem>
					<DropdownMenuItem
						render={
							<a
								href={new URL("change-password", runtimeUrl).toString()}
								rel="noreferrer"
								target="_blank"
							/>
						}
					>
						<LockIcon />
						Change password
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setTarget("slug")}>
						<SquarePenIcon />
						Change slug
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setTarget("snapshots")}>
						<DownloadIcon />
						Snapshots
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => setTarget("repair")}>
						<WrenchIcon />
						Repair
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => setTarget("reset")}
						variant="destructive"
					>
						<Trash2Icon />
						Reset
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<ChangeSlugDialog
				onOpenChange={(open) => setTarget(open ? "slug" : null)}
				onSubmit={changeSlug}
				open={target === "slug"}
				slug={slug}
			/>
			<BoxSnapshots
				onOpenChange={(open) => setTarget(open ? "snapshots" : null)}
				open={target === "snapshots"}
				plan={plan}
				slug={slug}
				split={split}
				status={boxStatus}
			/>
			<RepairDialog
				boxStatus={boxStatus}
				busy={busy}
				check={checkRepair}
				onOpenChange={(open) => setTarget(open ? "repair" : null)}
				onRepair={onRepair}
				open={target === "repair"}
				repair={repair}
				slug={slug}
			/>
			<ResetDialog
				busy={busy}
				onOpenChange={(open) => setTarget(open ? "reset" : null)}
				onReset={onReset}
				open={target === "reset"}
				slug={slug}
			/>
		</>
	);
}
