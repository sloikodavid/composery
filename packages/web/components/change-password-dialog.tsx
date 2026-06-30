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
import { Label } from "@/components/label";
import { useBusyAction } from "@/hooks/use-busy-action";

// Owner and console box pages share this dialog; each passes an onSubmit that
// targets the box by slug or by id.
export function ChangePasswordDialog({
	label,
	onSubmit
}: {
	label: string;
	onSubmit: (password: string) => Promise<unknown>;
}) {
	const [open, setOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const { busy, run } = useBusyAction();

	return (
		<>
			<AnimatedIconButton
				icon="lock"
				iconPosition="start"
				onClick={() => setOpen(true)}
				variant="outline"
			>
				Change password
			</AnimatedIconButton>
			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Change password</DialogTitle>
						<DialogDescription>
							Set a new password for {label}.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="new-password">New password</Label>
							<Input
								autoComplete="new-password"
								id="new-password"
								onChange={(event) => setPassword(event.target.value)}
								type="password"
								value={password}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="confirm-password">Confirm password</Label>
							<Input
								autoComplete="new-password"
								id="confirm-password"
								onChange={(event) => setConfirmation(event.target.value)}
								type="password"
								value={confirmation}
							/>
						</div>
					</div>
					<DialogFooter>
						<DialogClose render={<Button variant="outline">Cancel</Button>} />
						<Button
							disabled={
								busy === "password" || !password || password !== confirmation
							}
							onClick={() =>
								run("password", "Password changed", async () => {
									await onSubmit(password);
									setPassword("");
									setConfirmation("");
									setOpen(false);
								})
							}
						>
							Change password
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
