"use client";

import {
	CircleCheckIcon,
	CircleHelpIcon,
	HardDriveIcon,
	LoaderIcon,
	TriangleAlertIcon
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	AnimatedIconButton,
	type AnimatedIconName
} from "@/components/animated-icon";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from "@/components/dialog";
import { Input } from "@/components/input";
import { Separator } from "@/components/separator";
import type {
	RecoveryStatus,
	RecoveryType
} from "@/convex/boxes/boxRecoveryTypes";
import { errorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";

type ComponentState = RecoveryStatus["docker"];

const REPAIRS: Array<{
	icon: AnimatedIconName;
	label: string;
	type: RecoveryType;
}> = [
	{ type: "restart_services", label: "Restart services", icon: "rotate-cw" },
	{
		type: "recreate_containers",
		label: "Recreate containers",
		icon: "washing-machine"
	},
	{ type: "restore_runtime", label: "Restore runtime", icon: "download" },
	{ type: "reboot_server", label: "Reboot server", icon: "play" }
];

function StateIcon({ state }: { state: ComponentState }) {
	if (state === "active") {
		return <CircleCheckIcon className="size-4 text-success" />;
	}
	if (state === "unknown") {
		return <CircleHelpIcon className="size-4 text-muted-foreground" />;
	}
	return <TriangleAlertIcon className="size-4 text-warning" />;
}

function CheckRow({
	detail,
	label,
	state
}: {
	detail?: string;
	label: string;
	state: ComponentState;
}) {
	return (
		<div className="flex min-w-0 items-center gap-3 px-3 py-2.5 text-sm">
			<StateIcon state={state} />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<span className="text-xs text-muted-foreground">{detail ?? state}</span>
		</div>
	);
}

function serviceSummary(status: RecoveryStatus) {
	const services = [
		["Persistence", status.persistence],
		["Caddy", status.caddy],
		["IDE", status.ide]
	] as const;
	const unavailable = services
		.filter(([, state]) => state !== "active")
		.map(([name]) => name);
	return unavailable.length === 0 ? "3 active" : unavailable.join(", ");
}

export function RecoveryDialog({
	busy,
	check,
	onRecover,
	onReset,
	slug
}: {
	busy: string | null;
	check: () => Promise<RecoveryStatus>;
	onRecover: (type: RecoveryType) => Promise<void>;
	onReset: () => Promise<void>;
	slug: string;
}) {
	const [open, setOpen] = useState(false);
	const [checking, setChecking] = useState(false);
	const [resetConfirmation, setResetConfirmation] = useState("");
	const [status, setStatus] = useState<RecoveryStatus | null>(null);

	async function refresh() {
		setChecking(true);
		try {
			setStatus(await check());
		} catch (error) {
			toast.error("Checks failed", { description: errorMessage(error) });
		} finally {
			setChecking(false);
		}
	}

	function changeOpen(nextOpen: boolean) {
		setOpen(nextOpen);
		if (nextOpen) void refresh();
		else setResetConfirmation("");
	}

	const servicesState = status
		? status.persistence === "active" &&
			status.caddy === "active" &&
			status.ide === "active"
			? "active"
			: status.persistence === "unknown" &&
				  status.caddy === "unknown" &&
				  status.ide === "unknown"
				? "unknown"
				: "inactive"
		: "unknown";

	return (
		<Dialog onOpenChange={changeOpen} open={open}>
			<AnimatedIconButton
				icon="wrench"
				iconPosition="start"
				onClick={() => changeOpen(true)}
				variant="outline"
			>
				Recovery
			</AnimatedIconButton>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto"
				size="panel"
			>
				<DialogHeader>
					<DialogTitle>Recovery</DialogTitle>
					<DialogDescription>
						Check or repair {slug}. Repairs keep its files.
					</DialogDescription>
				</DialogHeader>

				<section className="space-y-3">
					<div className="flex items-center justify-between gap-3">
						<h3 className="text-sm font-medium">Status</h3>
						<AnimatedIconButton
							disabled={checking}
							icon="rotate-cw"
							iconPosition="start"
							onClick={() => void refresh()}
							size="sm"
							variant="ghost"
						>
							Check again
						</AnimatedIconButton>
					</div>
					<div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
						{checking && !status ? (
							<div className="flex items-center gap-2 px-3 py-5 text-sm text-muted-foreground">
								<LoaderIcon className="size-4 animate-spin" /> Checking…
							</div>
						) : status ? (
							<>
								<CheckRow
									label="Public URL"
									state={status.httpReachable ? "active" : "inactive"}
								/>
								<CheckRow
									label="Server"
									state={status.hostReachable ? "active" : "inactive"}
								/>
								<CheckRow label="Docker" state={status.docker} />
								<CheckRow label="Outer proxy" state={status.outerCaddy} />
								<CheckRow
									label="Composery container"
									state={status.composery}
								/>
								<CheckRow
									detail={serviceSummary(status)}
									label="Box services"
									state={servicesState}
								/>
								<div className="flex items-center gap-3 px-3 py-2.5 text-sm">
									<HardDriveIcon
										className={cn(
											"size-4",
											status.diskUsedPercent !== null &&
												status.diskUsedPercent >= 90
												? "text-warning"
												: "text-muted-foreground"
										)}
									/>
									<span className="flex-1">Disk</span>
									<span className="text-xs text-muted-foreground">
										{status.diskUsedPercent === null
											? "unknown"
											: `${status.diskUsedPercent}% used`}
									</span>
								</div>
							</>
						) : null}
					</div>
				</section>

				<section className="space-y-3">
					<div>
						<h3 className="text-sm font-medium">Repair</h3>
						<p className="text-xs text-muted-foreground">
							Start with services, then work outward.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-2">
						{REPAIRS.map((repair) => (
							<AnimatedIconButton
								className="justify-start"
								disabled={busy !== null}
								icon={repair.icon}
								iconPosition="start"
								key={repair.type}
								onClick={() => void onRecover(repair.type)}
								variant="outline"
							>
								{busy === `recovery-${repair.type}` ? "Working…" : repair.label}
							</AnimatedIconButton>
						))}
					</div>
				</section>

				<Separator />

				<section className="space-y-3 pb-1">
					<div>
						<h3 className="text-sm font-medium">Reset box</h3>
						<p className="text-xs text-muted-foreground">
							Rebuilds the disk and removes all current files.
						</p>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							onChange={(event) => setResetConfirmation(event.target.value)}
							placeholder={`Type ${slug} to confirm`}
							value={resetConfirmation}
						/>
						<AnimatedIconButton
							disabled={busy !== null || resetConfirmation !== slug}
							icon="delete"
							iconPosition="start"
							onClick={() => void onReset()}
							variant="destructive"
						>
							{busy === "reset" ? "Resetting…" : "Reset box"}
						</AnimatedIconButton>
					</div>
				</section>
			</DialogContent>
		</Dialog>
	);
}
