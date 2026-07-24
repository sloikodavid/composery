"use client";

import {
	CircleCheckIcon,
	CircleHelpIcon,
	CircleXIcon,
	LoaderIcon,
	TriangleAlertIcon
} from "lucide-react";
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
import { isOperationAllowed } from "@/convex/boxes/boxOperationRules";
import type { RecoveryStatus } from "@/convex/boxes/boxRecoveryTypes";
import type { BoxStatus } from "@/convex/schema";
import { errorMessage } from "@/lib/error-message";
import { CHECKS, type Tone, buildChecks, summarize } from "@/lib/repair-status";
import { cn } from "@/lib/utils";

const TONE_BADGE = {
	ok: "success",
	warn: "warning",
	bad: "destructive",
	muted: "secondary"
} as const;

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
	const base = cn("size-4 shrink-0", className);
	if (tone === "ok") {
		return <CircleCheckIcon className={cn(base, "text-success")} />;
	}
	if (tone === "warn") {
		return <TriangleAlertIcon className={cn(base, "text-warning")} />;
	}
	if (tone === "bad") {
		return <CircleXIcon className={cn(base, "text-destructive")} />;
	}
	return <CircleHelpIcon className={cn(base, "text-muted-foreground")} />;
}

// The last repair this box attempted. A repair leaves the box "running"
// throughout, so unlike every other operation its progress and its failure are
// nowhere in the box status - this record is the only place they exist.
export type RepairOperation = {
	status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
	error: string | null;
	finishedAt: number | null;
};

function repairNotice(repair: RepairOperation | null) {
	if (!repair) return null;
	if (repair.status === "pending" || repair.status === "running") {
		return {
			tone: "muted" as Tone,
			text: "Repairing this box now. It can take a few minutes; the checks above update when it finishes."
		};
	}
	if (repair.status === "failed") {
		return {
			tone: "bad" as Tone,
			text: `The last repair failed: ${repair.error ?? "no reason recorded"}`
		};
	}
	if (repair.status === "succeeded") {
		return { tone: "ok" as Tone, text: "The last repair finished." };
	}
	return { tone: "muted" as Tone, text: "The last repair was cancelled." };
}

// Owner and console box pages share this. It shows a read-only picture of every
// layer of the box, then offers one data-preserving Repair action. The caller's
// check loads the status and onRepair performs the repair.
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
	// repair that `beginBoxOperation` will refuse. A stopped box is the case
	// that matters: its server is powered off, so probing it would report every
	// layer as missing and raise a false alarm about a box that is merely off.
	const repairable = isOperationAllowed(boxStatus, "recover");

	async function refresh() {
		setChecking(true);
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

	const checks = status ? buildChecks(status) : [];
	const summary = status ? summarize(status, checks) : null;
	const notice = repairNotice(repair);
	const repairing =
		repair?.status === "pending" || repair?.status === "running";

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

							{/* Every row is laid out before the check returns - only the
							    icon and badge wait on data - so the dialog opens at its
							    final height instead of growing under the pointer. */}
							<div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
								{CHECKS.map((item) => {
									const state = status ? item.read(status) : null;
									return (
										<div
											className="flex items-start gap-3 px-3 py-2.5"
											key={item.label}
										>
											{state ? (
												<ToneIcon className="mt-0.5" tone={state.tone} />
											) : (
												<div className="mt-0.5 size-4 shrink-0 animate-pulse rounded-full bg-muted" />
											)}
											<div className="min-w-0 flex-1">
												<p className="text-sm font-medium">{item.label}</p>
												<p className="text-xs text-muted-foreground">
													{item.description}
												</p>
											</div>
											{/* Placeholder inside a real Badge: same element, so
											    the row cannot change height when data lands. */}
											<Badge variant={state ? TONE_BADGE[state.tone] : "secondary"}>
												{state ? (
													state.label
												) : (
													<span className="inline-block h-3 w-12 animate-pulse rounded bg-current opacity-30" />
												)}
											</Badge>
										</div>
									);
								})}
							</div>
						</>
					) : (
						<div className="flex items-start gap-3 rounded-2xl border border-border px-3 py-2.5">
							<ToneIcon className="mt-0.5" tone="muted" />
							<p className="min-w-0 flex-1 text-sm text-muted-foreground">
								{boxStatus === "stopped"
									? "This box is stopped, not broken. Start it to check and repair it."
									: boxStatus === "repairing"
										? "A repair is already running on this box. It can take a few minutes."
										: "This box can't be repaired in its current state."}
							</p>
						</div>
					)}

					{notice ? (
						<div className="flex items-start gap-3 rounded-2xl border border-border px-3 py-2.5">
							<ToneIcon className="mt-0.5" tone={notice.tone} />
							<p className="min-w-0 flex-1 text-sm text-muted-foreground">
								{notice.text}
							</p>
						</div>
					) : null}

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
