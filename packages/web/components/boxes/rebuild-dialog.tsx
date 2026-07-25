"use client";

import {
	CircleCheckIcon,
	CircleHelpIcon,
	CircleXIcon,
	TriangleAlertIcon
} from "lucide-react";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Button } from "@/components/base/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from "@/components/base/dialog";
import { Input } from "@/components/base/input";
import { isOperationAllowed } from "@/convex/boxes/boxOperationRules";
import type { BoxStatus } from "@/convex/schema";
import type { Tone } from "@/lib/repair-status";
import { cn } from "@/lib/utils";

// The latest rebuild this box attempted. Rebuild does move the box into a
// visible `rebuilding`/`rebuild_failed` status, but this record still carries
// the precise progress and the error text behind a failure, exactly as the
// Repair dialog reads its own operation.
export type RebuildOperation = {
	status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
	error: string | null;
	finishedAt: number | null;
};

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
	const base = cn("mt-0.5 size-4 shrink-0", className);
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

function rebuildNotice(rebuild: RebuildOperation | null) {
	if (!rebuild) return null;
	if (rebuild.status === "pending" || rebuild.status === "running") {
		return {
			tone: "muted" as Tone,
			text: "Rebuilding this box now. It copies your files off, gives the box a clean host, and copies them back - this can take several minutes."
		};
	}
	if (rebuild.status === "failed") {
		return {
			tone: "bad" as Tone,
			text: `The last rebuild failed: ${rebuild.error ?? "no reason recorded"}. Your files are safe on the parking volume; rebuild again to resume.`
		};
	}
	if (rebuild.status === "succeeded") {
		return { tone: "ok" as Tone, text: "The last rebuild finished." };
	}
	return { tone: "muted" as Tone, text: "The last rebuild was cancelled." };
}

// Owner and console box pages share this. Rebuild gives the box a clean host
// while keeping its files, so the typed-slug confirmation guards against a
// misclick and the copy is honest about the downtime and the reachable-host
// precondition. The caller's onRebuild performs the rebuild.
export function RebuildDialog({
	boxStatus,
	busy,
	onRebuild,
	rebuild,
	slug
}: {
	boxStatus: BoxStatus;
	busy: string | null;
	onRebuild: () => Promise<void>;
	rebuild: RebuildOperation | null;
	slug: string;
}) {
	const [open, setOpen] = useState(false);
	const [confirmation, setConfirmation] = useState("");

	function changeOpen(nextOpen: boolean) {
		setOpen(nextOpen);
		if (!nextOpen) setConfirmation("");
	}

	// Ask the same table the backend enforces, so the dialog never offers a
	// rebuild `beginBoxOperation` will refuse.
	const rebuildable = isOperationAllowed(boxStatus, "rebuild");
	const notice = rebuildNotice(rebuild);
	const rebuilding =
		rebuild?.status === "pending" || rebuild?.status === "running";

	return (
		<>
			<AnimatedIconButton
				icon="washing-machine"
				iconPosition="start"
				onClick={() => changeOpen(true)}
				variant="outline"
			>
				Rebuild
			</AnimatedIconButton>
			<Dialog onOpenChange={changeOpen} open={open}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rebuild {slug}</DialogTitle>
						<DialogDescription>
							Gives the box a brand-new host and keeps all your files. Use this
							when the host itself is broken in a way Repair can&apos;t fix. The
							box is offline for several minutes while its files are copied off,
							the host is rebuilt from a clean image, and the files are copied
							back and checked before anything is deleted.
						</DialogDescription>
					</DialogHeader>

					<div className="flex items-start gap-3 rounded-2xl border border-border px-3 py-2.5">
						<ToneIcon tone="warn" />
						<p className="min-w-0 flex-1 text-sm text-muted-foreground">
							Needs a reachable host. If the box&apos;s networking or SSH is
							broken, use Restore instead - a rebuild can&apos;t reach it to save
							your files.
						</p>
					</div>

					{notice ? (
						<div className="flex items-start gap-3 rounded-2xl border border-border px-3 py-2.5">
							<ToneIcon tone={notice.tone} />
							<p className="min-w-0 flex-1 text-sm text-muted-foreground">
								{notice.text}
							</p>
						</div>
					) : null}

					{rebuildable ? (
						<Input
							autoCapitalize="none"
							autoComplete="off"
							onChange={(event) => setConfirmation(event.target.value)}
							placeholder={`Type ${slug} to confirm`}
							spellCheck={false}
							value={confirmation}
						/>
					) : (
						<div className="flex items-start gap-3 rounded-2xl border border-border px-3 py-2.5">
							<ToneIcon tone="muted" />
							<p className="min-w-0 flex-1 text-sm text-muted-foreground">
								{boxStatus === "rebuilding"
									? "A rebuild is already running on this box. It can take several minutes."
									: boxStatus === "stopped" || boxStatus === "suspended"
										? "This box is not running. Start it before rebuilding its host."
										: "This box can't be rebuilt in its current state."}
							</p>
						</div>
					)}

					<DialogFooter>
						<DialogClose render={<Button variant="outline">Cancel</Button>} />
						<AnimatedIconButton
							disabled={
								busy !== null ||
								!rebuildable ||
								rebuilding ||
								confirmation !== slug
							}
							icon="washing-machine"
							iconPosition="start"
							onClick={() => void onRebuild().then(() => changeOpen(false))}
						>
							{busy === "rebuild" || rebuilding ? "Rebuilding…" : "Rebuild"}
						</AnimatedIconButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
