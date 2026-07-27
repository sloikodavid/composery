import type {
	BoxFailureStatus,
	BoxOperationStatus,
	BoxOperationType,
	BoxStatus
} from "../schema";

// The single source of truth for which box states each operation may begin
// from. `startOperation` refuses anything not listed here, so a wrong entry
// either blocks a legal action or lets a dangerous one through - this table is
// the gate.
export const OPERATION_ALLOWED_STATUSES: Record<
	BoxOperationType,
	readonly BoxStatus[]
> = {
	create: ["creating", "create_failed"],
	delete: [
		"creating",
		"running",
		"create_failed",
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
	// "create_failed": a box that never finished being created has no files
	// worth preserving (and may have no server) - Reset or another create attempt
	// is the right tool there. Not "stopped": a powered-off host cannot answer over SSH,
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

// Every event a box records about an operation, derived rather than listed.
//
// This used to be nineteen hand-written strings across thirteen files, in four
// competing grammars: `box.repair_succeeded`, `box.password_changed`,
// `box.stopped`, and `box.running` all meant "an operation finished". Three
// failure names disagreed with their own operation type (`box.slug_change_failed`
// for `change_slug`). A function cannot drift from itself, so the whole grammar is
// one line and adding an operation type gets its events for free.
export type OperationOutcome = "started" | "succeeded" | "failed" | "skipped";

export function boxEventType(
	type: BoxOperationType,
	outcome: OperationOutcome
) {
	return `box.${type}_${outcome}`;
}

// Where each operation leaves the box when it fails.
//
// A function of the operation type and nothing else, so it belongs in one table
// rather than restated in each workflow's `onFailure` - that is how `repair_failed`
// came to be spelled in one place and forgotten in another. `defineBoxWorkflow`
// reads this for the normal failure path and `boxOperationSweep` reads the same
// rows to rescue a box whose workflow died without recording anything, so the two
// can never disagree about where a failed operation leaves the box.
//
// `undefined` means the operation never moved the box off the status it started
// from, so a failure has nothing to put back: a snapshot runs beside a `running`
// box without changing it.
export const OPERATION_FAILURE_STATUS = {
	create: "create_failed",
	delete: "delete_failed",
	reset: "reset_failed",
	stop: "running",
	start: "stopped",
	change_password: "running",
	change_slug: "running",
	suspend: "running",
	unsuspend: "suspended",
	restore: "restore_failed",
	// A failed snapshot leaves nothing to put back. The snapshot row carries the
	// failure; the box is still running.
	snapshot: undefined,
	repair: "repair_failed",
	update: "update_failed",
	// A failed apply leaves the box running the configuration it already had,
	// which is exactly `running` - claiming a failure status would report a broken
	// box where there is a rejected change.
	change_config: "running"
} satisfies Record<BoxOperationType, BoxFailureStatus | undefined>;

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
