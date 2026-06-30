import {
	CircleCheckIcon,
	ClockIcon,
	ConstructionIcon,
	LoaderIcon,
	Trash2Icon,
	TriangleAlertIcon,
	Undo2Icon,
	UnplugIcon,
	ZapOffIcon
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { RunningIndicator } from "@/components/running-indicator";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger";

// One flat map for every status the UI can show, regardless of source. Unknown
// statuses fall back to neutral. Spinning and icon overrides live in their own
// maps below.
const STATUS_TONES: Record<string, Tone> = {
	// Box lifecycle
	provisioning: "warning",
	running: "success",
	provisioning_failed: "danger",
	stopping: "warning",
	stopped: "danger",
	starting: "warning",
	resetting: "warning",
	reset_failed: "danger",
	restoring: "warning",
	restore_failed: "danger",
	suspending: "warning",
	suspended: "warning",
	unsuspending: "warning",
	deleting: "warning",
	delete_failed: "danger",
	deleted: "neutral",
	// Box operations
	pending: "warning",
	succeeded: "success",
	failed: "danger",
	// Snapshots
	creating: "warning",
	complete: "success",
	// External (Polar checkout / subscription)
	active: "warning",
	open: "warning",
	confirmed: "success",
	converted: "success",
	expired: "neutral",
	released: "neutral"
};

const SPINNING_STATUSES = new Set([
	"provisioning",
	"stopping",
	"starting",
	"resetting",
	"restoring",
	"suspending",
	"unsuspending",
	"deleting",
	"pending",
	"creating"
]);

// Per-status icon overrides. Terminal / inert states get distinct glyphs;
// everything else falls back to its tone's default icon.
const STATUS_ICONS: Record<string, LucideIcon> = {
	stopped: UnplugIcon,
	suspended: ConstructionIcon,
	deleted: Trash2Icon,
	expired: Undo2Icon,
	released: Undo2Icon
};

const TONE_ICON: Record<Tone, LucideIcon> = {
	neutral: ZapOffIcon,
	success: CircleCheckIcon,
	warning: ClockIcon,
	danger: TriangleAlertIcon
};

const TONE_COLOR: Record<Tone, string> = {
	neutral: "text-foreground",
	success: "text-success",
	warning: "text-warning",
	danger: "text-destructive"
};

function humanize(status: string) {
	const text = status.replace(/_/g, " ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusText({
	className,
	status
}: {
	className?: string;
	status: string;
}) {
	const tone = STATUS_TONES[status] ?? "neutral";
	const spinning = SPINNING_STATUSES.has(status);
	const Icon =
		STATUS_ICONS[status] ?? (spinning ? LoaderIcon : TONE_ICON[tone]);

	return (
		<span className={cn("inline-flex items-center gap-1.5", className)}>
			{status === "running" ? (
				<RunningIndicator />
			) : (
				<Icon
					className={cn(
						"size-3.5",
						TONE_COLOR[tone],
						spinning && "animate-spin"
					)}
				/>
			)}
			{humanize(status)}
		</span>
	);
}
