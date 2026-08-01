"use client";

import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Badge } from "@/components/base/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from "@/components/base/dialog";
import {
	isOperationInFlight,
	lastOperationNotice,
	Notice,
	unavailableReason,
	type LastOperation
} from "@/components/boxes/operation-dialog";
import { ToneIcon } from "@/components/boxes/tone-icon";
import { isOperationAllowed } from "@/convex/model/box/operation";
import type { RecoveryStatus } from "@/convex/model/box/recovery";
import { type BoxStatus } from "@/convex/model/box/status";
import { errorMessage } from "@/lib/error-message";
import { CHECKS, summarize } from "@/lib/boxes/repair";

const TONE_BADGE = {
	ok: "success",
	warn: "warning",
	bad: "destructive",
	muted: "secondary"
} as const;

// The last repair this box attempted. The dialog reads this record for the
// precise progress and the error text behind a failure.
export type RepairOperation = LastOperation;

function repairNotice(repair: RepairOperation | null) {
	return lastOperationNotice(repair, {
		inFlight:
			"Repairing this box now. The checks above update when it finishes.",
		failed: (error) =>
			`The last repair failed: ${error}. Your files are safe on the parking volume; repair again to resume.`,
		succeeded: () => "The last repair finished."
	});
}

// Owner and console box pages share this. It shows a read-only picture of every
// layer of the box, then offers one data-preserving Repair action - the box's
// single recovery lever. Nothing is destroyed without a verified copy of it
// existing first, so the action needs no confirmation step. The caller's check
// loads the status and onRepair performs the repair.
export function RepairDialog({
	boxStatus,
	busy,
	check,
	onRepair,
	repair,
	slug
}: {
	boxStatus: BoxStatus;
	busy: string | null;
	check: () => Promise<RecoveryStatus>;
	onRepair: () => Promise<void>;
	repair: RepairOperation | null;
	slug: string;
}) {
	const [open, setOpen] = useState(false);
	const [checking, setChecking] = useState(false);
	const [status, setStatus] = useState<RecoveryStatus | null>(null);

	// Ask the same table the backend enforces, so the dialog can never offer a
	// repair that `startOperation` will refuse. A stopped box is the case
	// that matters: its server is powered off, so probing it would report every
	// layer as missing and raise a false alarm about a box that is merely off.
	const repairable = isOperationAllowed(boxStatus, "repair");

	async function refresh() {
		setChecking(true);
		// Clear first, so "Check again" shows the same loading state as opening
		// the dialog. Leaving the old rows up reads as nothing having happened.
		setStatus(null);
		try {
			setStatus(await check());
		} catch (error) {
			setStatus(null);
			toast.error("Check failed", { description: errorMessage(error) });
		} finally {
			setChecking(false);
		}
	}

	function changeOpen(nextOpen: boolean) {
		setOpen(nextOpen);
		if (nextOpen && repairable) {
			setStatus(null);
			void refresh();
		}
	}

	const summary = status ? summarize(status) : null;
	const notice = repairNotice(repair);
	const repairing = isOperationInFlight(repair);

	return (
		<>
			<AnimatedIconButton
				icon="wrench"
				iconPosition="start"
				onClick={() => changeOpen(true)}
				variant="outline"
			>
				Repair
			</AnimatedIconButton>
			<Dialog onOpenChange={changeOpen} open={open}>
				<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Repair {slug}</DialogTitle>
						<DialogDescription>
							Rebuilds the box from a clean setup while preserving files.
						</DialogDescription>
					</DialogHeader>

					{repairable ? (
						<>
							<div className="flex items-center justify-between gap-3">
								{summary ? (
									<div className="flex min-w-0 items-center gap-2">
										<ToneIcon tone={summary.tone} />
										<span className="truncate text-sm font-medium">
											{summary.label}
										</span>
									</div>
								) : (
									<div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
										{checking ? (
											<>
												<LoaderIcon className="size-4 shrink-0 animate-spin" />
												<span className="truncate">Checking…</span>
											</>
										) : (
											<>
												<ToneIcon tone="muted" />
												<span className="truncate">
													Couldn&apos;t check the box
												</span>
											</>
										)}
									</div>
								)}
								<AnimatedIconButton
									disabled={checking}
									icon="rotate-cw"
									iconPosition="start"
									onClick={() => void refresh()}
									size="sm"
									variant="outline"
								>
									Check again
								</AnimatedIconButton>
							</div>

							{/* One placeholder bar per real check, in a row of the same
							    height (py-2.5 either side of a 36px body), so the list is
							    the same size loading as loaded and the dialog never
							    resizes. */}
							<div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
								{CHECKS.map((item) => {
									const state = status ? item.read(status) : null;
									if (!state) {
										return (
											<div className="px-3 py-2.5" key={item.label}>
												<div className="h-9 animate-pulse rounded-lg bg-muted" />
											</div>
										);
									}
									return (
										<div
											className="flex items-start gap-3 px-3 py-2.5"
											key={item.label}
										>
											<ToneIcon className="mt-0.5" tone={state.tone} />
											<div className="min-w-0 flex-1">
												<p className="text-sm font-medium">{item.label}</p>
												<p className="text-xs text-muted-foreground">
													{item.description}
												</p>
											</div>
											<Badge variant={TONE_BADGE[state.tone]}>
												{state.label}
											</Badge>
										</div>
									);
								})}
							</div>
						</>
					) : (
						<Notice tone="muted">
							{unavailableReason(boxStatus, "repair", repairing)}
						</Notice>
					)}

					{notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

					<AnimatedIconButton
						className="w-full"
						disabled={busy !== null || !repairable || repairing}
						icon="wrench"
						iconPosition="start"
						onClick={() => void onRepair()}
					>
						{busy === "repair" || repairing ? "Repairing…" : "Repair"}
					</AnimatedIconButton>
				</DialogContent>
			</Dialog>
		</>
	);
}
