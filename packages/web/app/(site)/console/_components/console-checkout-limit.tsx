"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/input";
import { api } from "@/convex/_generated/api";
import { useBusyAction } from "@/hooks/use-busy-action";

export function ConsoleCheckoutLimit({ max }: { max?: number }) {
	const setMax = useMutation(
		api.staff.settings.setMaxActiveCheckoutIntentsPerUser
	);
	const { run, busy } = useBusyAction();
	const [draft, setDraft] = useState<string>(
		max === undefined ? "" : String(max)
	);
	const [lastSynced, setLastSynced] = useState(max);

	if (max !== lastSynced) {
		setLastSynced(max);
		if (max !== undefined) setDraft(String(max));
	}

	const parsed = Number(draft);
	const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 50;
	const dirty = draft !== (max === undefined ? "" : String(max));

	return (
		<div className="rounded-2xl border border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<h2 className="text-sm font-medium">Checkout reservation limit</h2>
				<AnimatedIconButton
					disabled={!dirty || !valid || busy !== null}
					icon="check"
					iconPosition="start"
					onClick={() =>
						run("checkout-limit", "Reservation limit updated", () =>
							setMax({ max: parsed })
						)
					}
					size="sm"
				>
					Save
				</AnimatedIconButton>
			</div>
			<div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3">
				<span className="text-sm text-muted-foreground">
					Max concurrent pending checkouts per user
				</span>
				<div className="flex items-center gap-1.5">
					<Input
						className="w-20 tabular-nums"
						disabled={busy !== null}
						max={50}
						min={1}
						onChange={(event) => setDraft(event.target.value)}
						type="number"
						value={draft}
					/>
					<span className="w-16 shrink-0 text-xs text-muted-foreground">
						reservations
					</span>
				</div>
			</div>
		</div>
	);
}
