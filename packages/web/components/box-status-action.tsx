"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PlayIcon } from "@/components/icons/play";
import { PlugZapIcon } from "@/components/icons/plug-zap";
import { RotateCWIcon } from "@/components/icons/rotate-cw";
import { StatusButton } from "@/components/status-button";

type ConfirmAction = { onConfirm: () => void };
type ClickAction = { disabled?: boolean; onClick: () => void };

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
	status: string;
	stop: ConfirmAction;
	retry: ClickAction;
	unsuspend?: ClickAction;
}) {
	if (status === "running") {
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
							icon: PlugZapIcon,
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

	if (status === "stopped") {
		return (
			<StatusButton
				action={{
					disabled: start.disabled,
					icon: PlugZapIcon,
					iconClassName: "text-success",
					label: "Start",
					onClick: start.onClick
				}}
				status={status}
			/>
		);
	}

	if (status === "provisioning_failed") {
		return (
			<StatusButton
				action={{
					disabled: retry.disabled,
					icon: RotateCWIcon,
					label: "Retry provisioning",
					onClick: retry.onClick
				}}
				status={status}
			/>
		);
	}

	if (status === "suspended" && unsuspend) {
		return (
			<StatusButton
				action={{
					disabled: unsuspend.disabled,
					icon: PlayIcon,
					label: "Unsuspend",
					onClick: unsuspend.onClick
				}}
				status={status}
			/>
		);
	}

	return <StatusButton status={status} />;
}
