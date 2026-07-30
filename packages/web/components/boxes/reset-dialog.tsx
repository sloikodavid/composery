"use client";

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

// Owner and console box pages share this. Reset rebuilds the disk from a clean
// image and removes every file on the box, so the typed-slug confirmation guards
// against a misclick. The caller's onReset performs the reset.
export function ResetDialog({
	busy,
	onReset,
	slug
}: {
	busy: string | null;
	onReset: () => Promise<void>;
	slug: string;
}) {
	const [open, setOpen] = useState(false);
	const [confirmation, setConfirmation] = useState("");

	function changeOpen(nextOpen: boolean) {
		setOpen(nextOpen);
		setConfirmation("");
	}

	return (
		<>
			<AnimatedIconButton
				icon="delete"
				iconPosition="start"
				onClick={() => changeOpen(true)}
				variant="destructive"
			>
				Reset
			</AnimatedIconButton>
			<Dialog onOpenChange={changeOpen} open={open}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reset {slug}</DialogTitle>
						<DialogDescription>
							Rebuilds the disk from a clean image and removes all current
							files. Snapshots are kept. This can&apos;t be undone.
						</DialogDescription>
					</DialogHeader>
					<Input
						autoCapitalize="none"
						autoComplete="off"
						onChange={(event) => setConfirmation(event.target.value)}
						placeholder={`Type ${slug} to confirm`}
						spellCheck={false}
						value={confirmation}
					/>
					<DialogFooter>
						<DialogClose render={<Button variant="outline">Cancel</Button>} />
						<Button
							disabled={busy !== null || confirmation !== slug}
							onClick={() => void onReset().then(() => changeOpen(false))}
							variant="destructive"
						>
							{busy === "reset" ? "Resetting…" : "Reset"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
