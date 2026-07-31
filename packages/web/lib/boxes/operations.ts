// What a box operation is called, in every vocabulary that has to name one: the
// interface, the events a box records, and the notice an owner reads when one
// fails. Names only - which states an operation may begin from, and where a
// failure leaves the box, are rules and live in `convex/boxes/operationRules.ts`.
//
// Relative, not the `@/` alias: this file is imported by Convex functions as well
// as by the app, and the Convex tsconfig has no path aliases. Every other lib
// module Convex reaches for (boxes/route, boxes/slug, boxes/billing, cloud-legal)
// obeys the same boundary.
import type { BoxOperationType } from "../../convex/schema";

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

// Every event a box records about an operation, derived rather than listed.
//
// This used to be nineteen hand-written strings across thirteen files, in four
// competing grammars: `box.repair_succeeded`, `box.password_changed`,
// `box.stopped`, and `box.running` all meant "an operation finished". Three
// failure names disagreed with their own operation type (`box.slug_change_failed`
// for `change_slug`). A function cannot drift from itself, so the whole grammar is
// one line and adding an operation type gets its events for free.
export type OperationOutcome = "started" | "succeeded" | "failed" | "skipped";

// The return type is the grammar, not `string`, which is what lets `BoxEventType`
// below be a closed union and `boxEventLabel` be total over it.
export function boxEventType<
	Type extends BoxOperationType,
	Outcome extends OperationOutcome
>(type: Type, outcome: Outcome): `box.${Type}_${Outcome}` {
	return `box.${type}_${outcome}`;
}

// The facts a box records that are not an operation's outcome: infrastructure
// the workflows create and destroy around it. They are listed because there is
// no grammar to derive them from - and listed here, beside their labels, so a
// new one is named in the same edit that introduces it.
const BOX_FACT_LABEL = {
	"box.owner_emailed": "Owner emailed",
	"box.parking_volume_created": "Parking volume created",
	"box.parking_volume_deleted": "Parking volume deleted",
	"box.parking_volume_restoring": "Parking volume restoring",
	"dns.record_created": "DNS record created",
	"server.created": "Server created",
	"server.rebuilt": "Server rebuilt"
} as const;

export type BoxEventType =
	`box.${BoxOperationType}_${OperationOutcome}` | keyof typeof BOX_FACT_LABEL;

// What one row of the audit history is called.
//
// `appendBoxEvent` takes a `BoxEventType`, so every event this code writes is
// either a fact named above or an operation outcome named by the table at the
// top of this file - which is what makes the identifier unable to reach the page
// through a fallback. The one thing that can is a row written before the rename
// migration in `convex/boxes/rename.ts` ran, and showing that stored identifier
// verbatim is the honest answer for it: it is a legacy name, and dressing it up
// would hide the very rows that migration exists to find.
export function boxEventLabel(type: string) {
	if (type in BOX_FACT_LABEL) {
		return BOX_FACT_LABEL[type as keyof typeof BOX_FACT_LABEL];
	}

	const match = /^box\.(.+)_(started|succeeded|failed|skipped)$/.exec(type);
	const operation = match?.[1] as BoxOperationType | undefined;
	if (operation && operation in OPERATION_LABEL) {
		return `${OPERATION_LABEL[operation]} ${match?.[2]}`;
	}

	return type;
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
