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
		"restoring",
		"restore_failed",
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
	snapshot: ["running"]
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
