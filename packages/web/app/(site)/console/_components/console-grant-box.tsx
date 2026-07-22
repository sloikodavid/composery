"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/base/input";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";

// Provision a box for an existing user without a paid checkout. The backend
// owns every guard (user exists, slug free, capacity, capability); this form
// only collects the three inputs and reports the outcome.
export function ConsoleGrantBox() {
	const grantComp = useMutation(api.staff.boxes.grantComp);
	const { run, busy } = useBusyAction();
	const [email, setEmail] = useState("");
	const [slug, setSlug] = useState("");
	const [reason, setReason] = useState("");

	const ready =
		email.trim() !== "" && slug.trim() !== "" && reason.trim() !== "";

	return (
		<div className="rounded-2xl border border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<h2 className="text-sm font-medium">Grant a box</h2>
				<AnimatedIconButton
					disabled={!ready || busy !== null}
					icon="plus"
					iconPosition="start"
					onClick={() =>
						run("grant-comp", "Box granted", async () => {
							await grantComp({
								email: email.trim(),
								slug: slug.trim(),
								reason: reason.trim()
							});
							setEmail("");
							setSlug("");
							setReason("");
						})
					}
					size="sm"
				>
					Grant box
				</AnimatedIconButton>
			</div>
			<div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
				<Input
					aria-label="User email"
					disabled={busy !== null}
					onChange={(event) => setEmail(event.target.value)}
					placeholder="User email"
					type="email"
					value={email}
				/>
				<Input
					aria-label="Box slug"
					disabled={busy !== null}
					onChange={(event) => setSlug(event.target.value)}
					placeholder="Box slug"
					value={slug}
				/>
				<Input
					aria-label="Reason"
					disabled={busy !== null}
					onChange={(event) => setReason(event.target.value)}
					placeholder="Reason (audited)"
					value={reason}
				/>
			</div>
			<p className="px-4 pb-3 text-xs text-pretty text-muted-foreground">
				Provisions a real server against capacity, billed to no one. Recorded
				against your account.
			</p>
		</div>
	);
}
