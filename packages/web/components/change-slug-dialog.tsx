"use client";

import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
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
import { Input } from "@/components/input";
import { useBusyAction } from "@/hooks/use-busy-action";
import { isValidSlug, sanitizeSlug } from "@/lib/box-slug";

// Owner and console box pages share this dialog; the caller's onSubmit performs
// the slug change (and any post-change navigation).
export function ChangeSlugDialog({
	onSubmit
}: {
	onSubmit: (newSlug: string) => Promise<unknown>;
}) {
	const [open, setOpen] = useState(false);
	const [newSlug, setNewSlug] = useState("");
	const { busy, run } = useBusyAction();

	return (
		<>
			<AnimatedIconButton
				icon="square-pen"
				iconPosition="start"
				onClick={() => setOpen(true)}
				variant="outline"
			>
				Change slug
			</AnimatedIconButton>
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Change slug</DialogTitle>
						<DialogDescription>
							This changes the box URL. Pipelines and bookmarks using the
							current address will stop working.
						</DialogDescription>
					</DialogHeader>
					<Input
						autoCapitalize="none"
						autoComplete="off"
						maxLength={63}
						onChange={(event) => setNewSlug(sanitizeSlug(event.target.value))}
						placeholder="new-slug"
						spellCheck={false}
						value={newSlug}
					/>
					<DialogFooter>
						<DialogClose render={<Button variant="outline">Cancel</Button>} />
						<Button
							disabled={busy === "slug" || !isValidSlug(newSlug)}
							onClick={() =>
								run("slug", "Slug changed", async () => {
									await onSubmit(newSlug);
									setNewSlug("");
									setOpen(false);
								})
							}
						>
							Change slug
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
