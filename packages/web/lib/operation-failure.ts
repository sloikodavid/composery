// Relative, not the `@/` alias: this file is imported by Convex functions as well
// as by the app, and the Convex tsconfig has no path aliases. Every other lib
// module Convex reaches for (box-route, box-slug, box-billing, cloud-legal)
// obeys the same boundary.
import type { BoxOperationType } from "../convex/schema";

// What each operation is called in the interface.
//
// The console used to render `operation.type` straight from the row, so a staff
// page said "change_config" and a staff email said "A change_config operation".
// Identifiers and prose are separate vocabularies; this is the bridge.
export const OPERATION_LABEL: Record<BoxOperationType, string> = {
	create: "Create",
	delete: "Remove",
	reset: "Reset",
	stop: "Stop",
	start: "Start",
	change_password: "Password change",
	change_slug: "Slug change",
	change_config: "Configuration change",
	suspend: "Suspend",
	unsuspend: "Unsuspend",
	restore: "Restore",
	snapshot: "Snapshot",
	repair: "Repair",
	update: "Update"
};

// The same names inside a sentence ("the slug change failed"), where a leading
// capital would read as a proper noun.
export function operationLabel(type: BoxOperationType, sentence = false) {
	const label = OPERATION_LABEL[type];
	return sentence ? label.toLowerCase() : label;
}

export type OperationFailure = {
	error: string | null;
	finishedAt: number | null;
	type: BoxOperationType;
};

export type FailureNotice = {
	title: string;
	detail: string;
	// What the owner can do about it, or null where the honest answer is "nothing,
	// this one is ours". Never invent an action an owner does not have.
	hint: string | null;
};

// What each operation's failure means to the box's owner.
//
// One table, keyed by operation type and exhaustive by `satisfies`, because the
// alternative was what this replaced: Repair and Update each explained their own
// failure inside their own dialog, and every other operation explained nothing.
// An owner whose reset, restore, creation, slug change or configuration apply
// failed saw a status word and no reason anywhere in the interface.
//
// `owned: false` means the failure is not the owner's to act on and is not shown
// to them - only in the console. A scheduled snapshot failing is staff's problem
// (a full Hetzner snapshot limit, typically), and the snapshot list already shows
// the failed row; a delete failing is entirely ours.
const FAILURE_NOTICES = {
	create: {
		owned: true,
		title: "This box could not be created.",
		hint: "Try creating it again, or contact support if it keeps failing - you are not charged for a box that never started."
	},
	reset: {
		owned: true,
		title: "The last reset did not finish.",
		hint: "The box may be part-way through a rebuild. Try again, or repair it to get back to a working box."
	},
	restore: {
		owned: true,
		title: "The last snapshot restore did not finish.",
		hint: "Your snapshot is unchanged and can be restored again. Repair the box if it is not serving."
	},
	repair: {
		owned: true,
		title: "The last repair did not finish.",
		hint: "Your files are safe on the parking volume. Repair again to resume from where it stopped."
	},
	update: {
		owned: true,
		title: "The last update did not finish.",
		hint: "This box is still recorded on the version it was running. Try the update again, or repair it to put that version back."
	},
	change_slug: {
		owned: true,
		title: "The slug change did not finish.",
		hint: "The box is still reachable at its old slug. You can try the change again."
	},
	change_config: {
		owned: true,
		title: "The configuration change was not applied.",
		hint: "The box is still running the configuration it had before. Check the values and try again."
	},
	change_password: {
		owned: true,
		title: "The password change did not reach this box.",
		hint: "The box still expects your previous password. Try changing it again from the box itself."
	},
	stop: {
		owned: true,
		title: "The box could not be stopped.",
		hint: "It is still running. Try again in a moment."
	},
	start: {
		owned: true,
		title: "The box could not be started.",
		hint: "It is still stopped. Try again in a moment."
	},
	// The owner can see a `delete_failed` box sitting in their list, so staying
	// quiet here would leave them the generic "metrics will appear when the box is
	// running" message about a box that is being torn down. They cannot act on it -
	// deletion is driven by the subscription ending, never by them - so it says so
	// rather than implying a button they do not have.
	delete: {
		owned: true,
		title: "Removing this box did not finish.",
		hint: "Staff have been alerted and will finish removing it. There is nothing for you to do."
	},
	// Ours, not the owner's.
	snapshot: {
		owned: false,
		title: "The last snapshot did not finish.",
		hint: null
	},
	suspend: {
		owned: false,
		title: "Suspending this box did not finish.",
		hint: null
	},
	unsuspend: {
		owned: false,
		title: "Unsuspending this box did not finish.",
		hint: null
	}
} satisfies Record<
	BoxOperationType,
	{ owned: boolean; title: string; hint: string | null }
>;

// `audience: "owner"` hides the failures an owner cannot act on; the console
// passes "staff" and sees every one, because "the box looks fine but its last
// operation failed" is exactly what staff are looking for.
export function failureNotice(
	failure: OperationFailure | null,
	audience: "owner" | "staff"
): FailureNotice | null {
	if (!failure) return null;
	const notice = FAILURE_NOTICES[failure.type];
	if (audience === "owner" && !notice.owned) return null;

	return {
		title: notice.title,
		// The error text is the whole point of surfacing this, so never drop it
		// silently: a failure with no recorded reason says so rather than showing an
		// empty line that reads as "no problem here".
		detail: failure.error ?? "No reason was recorded.",
		hint: notice.hint
	};
}
