"use client";

import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from "@/components/base/dialog";
import { ToneIcon } from "@/components/boxes/tone-icon";
import { isOperationAllowed } from "@/convex/boxes/operationRules";
import type { RuntimeStanding } from "@/convex/boxes/runtimeRelease";
import type { BoxOperationStatus, BoxStatus } from "@/convex/schema";
import { formatDateTime } from "@/lib/datetime";
import { standingNotices, type UpdateNotice } from "@/lib/runtime-update";

// The last update this box attempted. The status field on the box says one ran;
// this record is where the error text behind a failure lives. Typed off the
// schema's own union rather than restated, so a new operation status reaches the
// switch below as a type error instead of as a missing line.
export type UpdateOperation = {
	status: BoxOperationStatus;
	error: string | null;
	finishedAt: number | null;
};

// Every version a box changes is a container recreate, so this is the sentence
// the dialog exists to put in front of an owner before they press the button.
const COST_NOTICE =
	"Updating recreates the box's container. Terminals, running processes and anything unsaved stop, and the box is unreachable until the new one answers. Files on disk and snapshots are kept.";

function updateNotice(update: UpdateOperation | null): UpdateNotice | null {
	if (!update) return null;
	switch (update.status) {
		case "pending":
		case "running":
			return {
				tone: "muted",
				text: "Updating this box now. The versions above update when it finishes."
			};
		case "failed":
			return {
				tone: "bad",
				// True by construction: the update advances the box's recorded image
				// only after the new container has answered, so a failure leaves the
				// row naming the image that last served and Repair rebuilds from it.
				text: `The last update failed: ${update.error ?? "no reason recorded"}. This box is still recorded on the version it was running; try again, or repair it to put that version back.`
			};
		case "succeeded":
			return {
				tone: "ok",
				text: update.finishedAt
					? `The last update finished ${formatDateTime(update.finishedAt)}.`
					: "The last update finished."
			};
	}
}

function unavailableReason(boxStatus: BoxStatus) {
	if (boxStatus === "updating") {
		return "An update is already running on this box.";
	}
	if (boxStatus === "stopped" || boxStatus === "suspended") {
		return "This box is not running. Start it before updating.";
	}
	return "This box can't be updated in its current state.";
}

// The trigger carries the standing itself rather than the page growing a banner
// for it: the action bar already names state in a button ("Renews 3 Mar"), and an
// owner who never opens this dialog still sees that an update is waiting.
function triggerLabel(runtime: RuntimeStanding) {
	if (runtime.required) return "Update required";
	if (runtime.updateAvailable) return "Update available";
	return "Update";
}

// Owner and console box pages share this. It names the version the box runs and
// the one available - "Unknown" where we have neither, never a guessed number -
// says plainly what an update costs, and offers the one Update action. The
// caller's onUpdate performs it.
export function UpdateDialog({
	boxStatus,
	busy,
	onUpdate,
	runtime,
	slug,
	update
}: {
	boxStatus: BoxStatus;
	busy: string | null;
	onUpdate: () => Promise<void>;
	runtime: RuntimeStanding;
	slug: string;
	update: UpdateOperation | null;
}) {
	const [open, setOpen] = useState(false);

	// Ask the same table the backend enforces, so the dialog can never offer an
	// update `startOperation` will refuse. Only a running box (or one whose
	// last update failed) can be updated: the host has to answer over SSH for the
	// new image to be pulled at all.
	const updatable = isOperationAllowed(boxStatus, "update");
	const updating = update?.status === "pending" || update?.status === "running";

	const outcome = updateNotice(update);
	const notices: UpdateNotice[] = [
		...standingNotices(runtime),
		...(updatable
			? []
			: [{ tone: "muted" as const, text: unavailableReason(boxStatus) }]),
		...(outcome ? [outcome] : [])
	];

	const versions: [string, string | null][] = [
		["Running now", runtime.currentVersion],
		["Available", runtime.availableVersion]
	];

	return (
		<>
			<AnimatedIconButton
				icon="rotate-cw"
				iconPosition="start"
				onClick={() => setOpen(true)}
				variant="outline"
			>
				{triggerLabel(runtime)}
			</AnimatedIconButton>
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Update {slug}</DialogTitle>
						<DialogDescription>
							Moves this box onto the current Composery release and keeps its
							files.
						</DialogDescription>
					</DialogHeader>

					<div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
						{versions.map(([label, version]) => (
							<div
								className="flex items-baseline justify-between gap-3 px-3 py-2.5"
								key={label}
							>
								<p className="text-sm font-medium">{label}</p>
								<p className="min-w-0 truncate text-sm text-muted-foreground">
									{version ?? "Unknown"}
								</p>
							</div>
						))}
					</div>

					{/* Not muted like the rows below it: this is the one thing an owner
					    must not be surprised by after pressing Update. */}
					<div className="flex items-start gap-3 rounded-2xl border border-border px-3 py-2.5">
						<ToneIcon className="mt-0.5" tone="warn" />
						<p className="min-w-0 flex-1 text-sm">{COST_NOTICE}</p>
					</div>

					{notices.map((notice) => (
						<div
							className="flex items-start gap-3 rounded-2xl border border-border px-3 py-2.5"
							key={notice.text}
						>
							<ToneIcon className="mt-0.5" tone={notice.tone} />
							<p className="min-w-0 flex-1 text-sm text-muted-foreground">
								{notice.text}
							</p>
						</div>
					))}

					<AnimatedIconButton
						className="w-full"
						disabled={busy !== null || !updatable || updating}
						icon="rotate-cw"
						iconPosition="start"
						onClick={() => void onUpdate()}
					>
						{busy === "update" || updating ? "Updating…" : "Update"}
					</AnimatedIconButton>
				</DialogContent>
			</Dialog>
		</>
	);
}
