"use client";

import { ConfirmDialog } from "@/ui/confirm-dialog";
import { StatusButton } from "@/ui/box/status-button";
import { type BoxOperationType } from "@/convex/model/box/operation";
import { type BoxStatus } from "@/convex/model/box/status";

type ConfirmAction = { onConfirm: () => void };
type ClickAction = { disabled?: boolean; onClick: () => void };

// Which operation a status leads with, and the only place this page decides it.
//
// *Which* one is a product decision and stays written down: several operations
// are legal from `running` - stop, reset, repair, update, snapshot, a slug
// change - and this is the one the page puts a button on. What is not a decision
// is whether that operation is legal at all, and that is what this table exists
// to pin. The branches below used to test the status literal directly, so this
// page held a second, hand-written copy of `BOX_OPERATIONS[type].from`: adding
// `suspended` to `start.from` grew no button here, and removing `running` from
// `stop.from` would leave a button that throws when pressed. Neither failed
// anything.
//
// The behaviour test drives every row through `isOperationAllowed`, so the
// catalogue and this page cannot disagree without CI saying so.
export const PRIMARY_ACTION = {
	running: "stop",
	stopped: "start",
	create_failed: "create",
	suspended: "unsuspend"
} as const satisfies Partial<Record<BoxStatus, BoxOperationType>>;

// The primary status button shared by the owner and console box pages: which
// action a status offers lives here once, so the two pages can't drift. Each
// page passes its own bound handlers (owner targets by slug, console by id);
// omitting `unsuspend` hides the suspended-state action, which owners lack.
export function BoxStatusAction({
	start,
	status,
	stop,
	retry,
	unsuspend
}: {
	start: ClickAction;
	status: BoxStatus;
	stop: ConfirmAction;
	retry: ClickAction;
	unsuspend?: ClickAction;
}) {
	const primary: BoxOperationType | undefined =
		PRIMARY_ACTION[status as keyof typeof PRIMARY_ACTION];

	if (primary === "stop") {
		return (
			<ConfirmDialog
				confirmLabel="Stop"
				description="Stops the box and anything running in it. Billing continues while the box is stopped."
				destructive
				onConfirm={stop.onConfirm}
				title="Stop"
			>
				{(open) => (
					<StatusButton
						action={{
							icon: "plug-zap",
							iconClassName: "text-destructive",
							label: "Stop",
							onClick: open
						}}
						status={status}
					/>
				)}
			</ConfirmDialog>
		);
	}

	if (primary === "start") {
		return (
			<StatusButton
				action={{
					disabled: start.disabled,
					icon: "plug-zap",
					iconClassName: "text-success",
					label: "Start",
					onClick: start.onClick
				}}
				status={status}
			/>
		);
	}

	if (primary === "create") {
		return (
			<StatusButton
				action={{
					disabled: retry.disabled,
					icon: "rotate-cw",
					label: "Create again",
					onClick: retry.onClick
				}}
				status={status}
			/>
		);
	}

	if (primary === "unsuspend" && unsuspend) {
		return (
			<StatusButton
				action={{
					disabled: unsuspend.disabled,
					icon: "play",
					label: "Unsuspend",
					onClick: unsuspend.onClick
				}}
				status={status}
			/>
		);
	}

	return <StatusButton status={status} />;
}
