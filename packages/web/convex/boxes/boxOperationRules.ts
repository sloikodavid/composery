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
		"repair_failed",
		"updating",
		"update_failed",
		"restoring",
		"restore_failed",
		"suspending",
		"suspended",
		"unsuspending",
		"delete_failed"
	],
	reset: ["running", "reset_failed", "restore_failed", "update_failed"],
	stop: ["running"],
	start: ["stopped"],
	change_password: ["running", "reset_failed"],
	change_slug: ["running"],
	suspend: ["running", "stopped"],
	unsuspend: ["suspended"],
	restore: ["running", "restore_failed"],
	snapshot: ["running"],
	// Repair copies the box's files off, gives it a clean host, and copies them
	// back, so it needs a running box with real files and a reachable host. Not
	// "provisioning_failed": a box that never provisioned has no files worth
	// preserving (and may have no server) - Reset or a provision retry is the
	// right tool there. Not "stopped": a powered-off host cannot answer over SSH,
	// so every step would time out. `repair_failed` is included so a failed
	// repair can be retried, resuming from its parking volume.
	//
	// `update_failed` is included for a different reason, and it is the one that
	// matters most: a box left broken by an update is rolled back by repairing
	// it. Repair renders the compose file from `box.runtime_image`, and an update
	// only advances that field once the new image has answered - so repairing a
	// box that failed to update rewrites the last image known to serve. Removing
	// this entry would leave a failed update with no recovery but Reset, which
	// destroys the files the update was careful to keep.
	repair: [
		"running",
		"reset_failed",
		"restore_failed",
		"repair_failed",
		"update_failed"
	],
	// Update recreates the box's container on a new image. It needs a running
	// box and a reachable host for the same reason Repair does, and the pull is
	// the slow part. `update_failed` is included so a transient failure - an
	// unreachable registry, a pull that timed out - can simply be retried;
	// where the box itself is broken rather than the attempt, Repair above is
	// the way back.
	update: ["running", "update_failed"],
	// Applying configuration recreates the editor's container, so it needs a
	// running box and a reachable host. It has no failure status of its own: a
	// failed apply leaves the box on the configuration it already had (the row is
	// only advanced once the editor answers), so the box is still simply running.
	change_config: ["running"]
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
