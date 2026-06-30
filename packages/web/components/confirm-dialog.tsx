"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from "@/components/dialog";

// Wraps a destructive action in a confirmation step. `children` is a render prop
// that receives an `open` callback to wire onto the trigger button, so callers
// keep full control of the trigger's styling/icon/disabled state.
export function ConfirmDialog({
	children,
	confirmLabel = "Confirm",
	description,
	destructive = false,
	onConfirm,
	title
}: {
	children: (open: () => void) => ReactNode;
	confirmLabel?: string;
	description: string;
	destructive?: boolean;
	onConfirm: () => void | Promise<void>;
	title: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<>
			{children(() => setOpen(true))}
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{description}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline">Cancel</Button>} />
						<Button
							onClick={async () => {
								await onConfirm();
								setOpen(false);
							}}
							variant={destructive ? "destructive" : "default"}
						>
							{confirmLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
