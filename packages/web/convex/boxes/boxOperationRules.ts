import type {
	BoxOperationStatus,
	BoxOperationType,
	BoxStatus
} from "../schema";

// The single source of truth for which box states each operation may begin
// from. `beginBoxOperation` refuses anything not listed here, so a wrong entry
// either blocks a legal action or lets a dangerous one through - this table is
// the gate.
export const OPERATION_ALLOWED_STATUSES: Record<
	BoxOperationType,
	readonly BoxStatus[]
> = {
	provision: ["provisioning", "provisioning_failed"],
	delete: [
		"provisioning",
		"running",
		"provisioning_failed",
		"stopping",
		"stopped",
		"starting",
		"resetting",
		"reset_failed",
		"repairing",
		"restoring",
		"restore_failed",
		"rebuilding",
		"rebuild_failed",
		"suspending",
		"suspended",
		"unsuspending",
		"delete_failed"
	],
	reset: ["running", "reset_failed", "restore_failed"],
	stop: ["running"],
	start: ["stopped"],
	change_password: ["running", "reset_failed"],
	change_slug: ["running"],
	suspend: ["running", "stopped"],
	unsuspend: ["suspended"],
	restore: ["running", "restore_failed"],
	snapshot: ["running"],
	// Not "stopped": stopping a box powers the server off, so every repair step
	// runs over SSH against a host that cannot answer. Offering it there buys a
	// guaranteed five-attempt failure and a critical staff alert for a box whose
	// owner only had to start it.
	recover: ["running", "provisioning_failed", "reset_failed", "restore_failed"],
	// Rebuild copies the box's files off, gives it a clean host, and copies them
	// back, so it needs a running box with real files and a reachable host. Not
	// "provisioning_failed": a box that never provisioned has no files worth
	// preserving (and may have no server) - Reset or a provision retry is the
	// right tool there. `rebuild_failed` is included so a failed rebuild can be
	// retried, resuming from its parking volume.
	rebuild: ["running", "reset_failed", "restore_failed", "rebuild_failed"]
};

export const ACTIVE_OPERATION_STATUSES = [
	"pending",
	"running"
] as const satisfies readonly BoxOperationStatus[];

const ACTIVE_OPERATION_STATUS_SET: ReadonlySet<BoxOperationStatus> = new Set(
	ACTIVE_OPERATION_STATUSES
);

export function isOperationAllowed(status: BoxStatus, type: BoxOperationType) {
	return OPERATION_ALLOWED_STATUSES[type].includes(status);
}

export function isActiveOperationStatus(status: BoxOperationStatus) {
	return ACTIVE_OPERATION_STATUS_SET.has(status);
}
