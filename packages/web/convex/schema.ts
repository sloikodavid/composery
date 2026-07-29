import { defineSchema, defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

export const vUserRole = v.union(v.literal("user"), v.literal("admin"));
export type UserRole = Infer<typeof vUserRole>;

export const vCheckoutIntentStatus = v.union(
	v.literal("active"),
	v.literal("converted"),
	v.literal("released"),
	v.literal("expired")
);

export const vBoxAuthorizationType = v.union(
	v.literal("password"),
	v.literal("session")
);

export const vBoxStatus = v.union(
	v.literal("creating"),
	v.literal("running"),
	v.literal("create_failed"),
	v.literal("stopping"),
	v.literal("stopped"),
	v.literal("starting"),
	v.literal("resetting"),
	v.literal("reset_failed"),
	v.literal("repairing"),
	v.literal("repair_failed"),
	v.literal("updating"),
	v.literal("update_failed"),
	v.literal("restoring"),
	v.literal("restore_failed"),
	v.literal("suspending"),
	v.literal("suspended"),
	v.literal("unsuspending"),
	v.literal("deleting"),
	v.literal("delete_failed"),
	v.literal("deleted")
);

export type BoxStatus = Infer<typeof vBoxStatus>;

export const BOX_STATUSES: BoxStatus[] = vBoxStatus.members.map(
	(member) => member.value
);

// "Every box status except these."
//
// Several rules mean "all live boxes": which ones hold a server against
// capacity, which ones keep their slug reserved, which ones a subscription is
// reconciled against, which ones roll metrics up. Each of those was a
// hand-written subset of the union, and a subset is exactly what the type
// checker cannot check - so every status added since has had to be pasted into
// all of them by hand, and `repair_failed` had already fallen out of the metrics
// rollup that way.
//
// The direction of the failure is what makes this worth deriving rather than
// remembering: a status missing from one of these lists means a box that quietly
// stops counting against capacity, or stops holding its own slug so someone else
// can claim it. Naming the exclusions inverts that - a new status is in every
// list by default and only leaves one deliberately.
export function boxStatusesExcept(
	...excluded: readonly BoxStatus[]
): BoxStatus[] {
	return BOX_STATUSES.filter((status) => !excluded.includes(status));
}

export const vBoxBeginStatus = v.union(
	v.literal("creating"),
	v.literal("stopping"),
	v.literal("starting"),
	v.literal("resetting"),
	v.literal("repairing"),
	v.literal("updating"),
	v.literal("restoring"),
	v.literal("suspending"),
	v.literal("suspended"),
	v.literal("unsuspending"),
	v.literal("deleting"),
	v.literal("running")
);

export const vBoxFailureStatus = v.union(
	v.literal("create_failed"),
	v.literal("reset_failed"),
	v.literal("repair_failed"),
	v.literal("update_failed"),
	v.literal("restore_failed"),
	v.literal("delete_failed"),
	v.literal("running"),
	v.literal("stopped"),
	v.literal("suspended")
);

export type BoxFailureStatus = Infer<typeof vBoxFailureStatus>;

export const vBoxOperationType = v.union(
	v.literal("create"),
	v.literal("delete"),
	v.literal("reset"),
	v.literal("stop"),
	v.literal("start"),
	v.literal("change_password"),
	v.literal("change_slug"),
	v.literal("suspend"),
	v.literal("unsuspend"),
	v.literal("restore"),
	v.literal("snapshot"),
	v.literal("repair"),
	v.literal("update"),
	v.literal("change_config")
);

export const vBoxOperationStatus = v.union(
	v.literal("pending"),
	v.literal("running"),
	v.literal("succeeded"),
	v.literal("failed")
);

export type BoxOperationType = Infer<typeof vBoxOperationType>;
export type BoxOperationStatus = Infer<typeof vBoxOperationStatus>;

export const BOX_OPERATION_STATUSES: BoxOperationStatus[] =
	vBoxOperationStatus.members.map((member) => member.value);

// Who started an operation. Recorded on every one, because "who did this" is a
// question a box's history has to be able to answer - in support, in the console,
// and in automatic repair's own gates.
//
// A closed union rather than a free string: automatic repair holds off while a
// person is working on a box, and it tells the two apart by this field alone. A
// misspelled trigger would silently reclassify a fleet action as a human one, so
// there is nothing to misspell.
export const vOperationTrigger = v.union(
	// A person acting on the box: its owner, or staff acting on their behalf. Both
	// hold automatic repair off - the hand on the box is a human's either way.
	v.literal("owner"),
	v.literal("staff"),
	// The fleet acting on its own. Every one of these is named separately so a
	// box's history says which sweep touched it, and so `isSystemTrigger` can
	// classify them all without listing them.
	v.literal("system:auto_repair"),
	v.literal("system:runtime_floor"),
	v.literal("system:auto_snapshot"),
	v.literal("system:abuse_suspension"),
	v.literal("system:subscription_revoked"),
	v.literal("system:account_deletion"),
	// Re-drives a deletion that was already ordered and stopped part-way. Named
	// apart from the triggers above because it starts no teardown of its own: it
	// only finishes one of theirs (see `finishFailedDeletions`).
	v.literal("system:delete_retry")
);
export type OperationTrigger = Infer<typeof vOperationTrigger>;

// True for anything the fleet started by itself. Keyed off the `system:` prefix
// rather than a second list of literals, so a trigger added to the union above is
// classified the moment it exists instead of defaulting to "a person did this".
//
// `undefined` means an operation recorded before the column existed. Those read
// as human, which is the safe direction: it holds automatic repair off rather
// than letting it act on a box a person may have been working on.
export function isSystemTrigger(trigger: OperationTrigger | undefined) {
	return trigger !== undefined && trigger.startsWith("system:");
}

// Which half of a Repair ("clean host, current files") a box's parking volume
// is in. It is the crash-safety marker a resumed repair reads to decide the
// authoritative copy of the files:
//   - "parking":   the box's server still holds the files; the volume is being
//                  filled. Safe to re-copy server -> volume and to rebuild the
//                  host only once that copy has verified.
//   - "restoring": the server has been (or is being) wiped and reborn; the
//                  volume now holds the only copy. The files are copied back
//                  volume -> server, and server -> volume must never run here.
// The transition parking -> restoring happens exactly once, gated on the
// copy-out verifying, so an interrupted repair always resumes towards keeping
// the files rather than overwriting them.
export const vParkingVolumeStage = v.union(
	v.literal("parking"),
	v.literal("restoring")
);
export type ParkingVolumeStage = Infer<typeof vParkingVolumeStage>;

// Which product a box was bought as. The identity of a plan lives here because
// it is a stored value; everything a plan *is* - its machine, its specification,
// its capabilities - lives in `lib/box-plan.ts`, whose table is pinned to this
// union with `satisfies Record<BoxPlan, ...>`. Adding a plan therefore fails to
// compile until both halves exist, which is what keeps a sellable plan from
// having no machine behind it.
export const vBoxPlan = v.union(v.literal("air"), v.literal("pro"));
export type BoxPlan = Infer<typeof vBoxPlan>;
export const BOX_PLANS_STORED: BoxPlan[] = vBoxPlan.members.map(
	(member) => member.value
);

// The Hetzner types a box can run on: one per plan, and nothing else. Which plan
// gets which is `lib/box-plan.ts`; this union only says what may be stored.
export const vServerType = v.union(v.literal("cx23"), v.literal("cx43"));
export const vServerLocation = v.union(
	v.literal("nbg1"),
	v.literal("fsn1"),
	v.literal("hel1")
);
export type ServerType = Infer<typeof vServerType>;
export type ServerLocation = Infer<typeof vServerLocation>;
export const SERVER_TYPES = vServerType.members.map((member) => member.value);
export const SERVER_LOCATIONS = vServerLocation.members.map(
	(member) => member.value
);

export const vBoxFlagSignal = v.union(
	v.literal("egress_bandwidth"),
	v.literal("egress_pps")
);
export type BoxFlagSignal = Infer<typeof vBoxFlagSignal>;

export const vThreshold = v.object({
	signal: vBoxFlagSignal,
	value: v.number(),
	sustained_samples: v.number()
});
export type StoredThreshold = Infer<typeof vThreshold>;

// Staff-tunable snapshot behaviour. Deliberately no caps: how many snapshots a
// box gets is what its plan sells, and how they are split is its owner's, so a
// number here could only contradict one of them. What is left is timing.
export const vSnapshotPolicy = v.object({
	manual_min_interval_minutes: v.number(),
	manual_retention_days: v.number(),
	automatic_retention_days: v.number()
});
export type StoredSnapshotPolicy = Infer<typeof vSnapshotPolicy>;

// What the deployment's RUNTIME_IMAGE channel last resolved to, refreshed on a
// schedule and cached fleet-wide. Every box compares its own `runtime_image`
// against `image` here; `version` is the label read off that digest and exists
// only so the interface can say "0.2.1" instead of a hash.
export const vRuntimeRelease = v.object({
	image: v.string(),
	version: v.union(v.string(), v.null()),
	checked_at: v.number()
});
export type StoredRuntimeRelease = Infer<typeof vRuntimeRelease>;

export const vSnapshotClass = v.union(
	v.literal("manual"),
	v.literal("scheduled")
);
export const vSnapshotStatus = v.union(
	v.literal("pending"),
	v.literal("creating"),
	v.literal("complete"),
	v.literal("failed"),
	v.literal("deleting")
);

export type SnapshotStatus = Infer<typeof vSnapshotStatus>;

export const SNAPSHOT_STATUSES: SnapshotStatus[] = vSnapshotStatus.members.map(
	(member) => member.value
);

export const vStaffAlertSeverity = v.union(
	v.literal("warning"),
	v.literal("critical"),
	v.literal("resolved")
);
export const vStaffAlertQueueStatus = v.union(
	v.literal("pending"),
	v.literal("disabled"),
	v.literal("no_recipients"),
	v.literal("queued"),
	v.literal("queue_failed")
);

const vMetadata = v.optional(v.record(v.string(), v.any()));

export default defineSchema({
	users: defineTable({
		clerk_user_id: v.string(),
		email: v.string(),
		role: vUserRole,
		suspended: v.boolean(),
		suspended_reason: v.optional(v.string()),
		suspended_at: v.optional(v.number()),
		deletion_pending: v.optional(v.boolean()),
		deletion_requested_at: v.optional(v.number()),
		deletion_requested_by: v.optional(v.string()),
		deletion_finished_at: v.optional(v.number()),
		purge_at: v.optional(v.number()),
		created_at: v.number(),
		updated_at: v.number()
	})
		.index("clerk_user_id", ["clerk_user_id"])
		.index("email", ["email"])
		.index("role", ["role"])
		.index("deletion_pending", ["deletion_pending"])
		.index("purge_at", ["purge_at"])
		.index("created_at", ["created_at"]),

	box_checkout_intents: defineTable({
		user_id: v.string(),
		slug: v.string(),
		// The plan the visitor was buying when the slug was reserved. Capacity
		// admission reads it - a plan without manual snapshots commits fewer
		// snapshot slots - so a reservation has to name one, not infer it later
		// from whatever product the order happens to arrive on.
		plan: vBoxPlan,
		status: vCheckoutIntentStatus,
		polar_checkout_id: v.optional(v.string()),
		polar_checkout_url: v.optional(v.string()),
		polar_checkout_status: v.optional(v.string()),
		polar_checkout_expires_at: v.optional(v.number()),
		polar_customer_id: v.optional(v.string()),
		polar_subscription_id: v.optional(v.string()),
		polar_initial_order_id: v.optional(v.string()),
		terms_accepted_at: v.optional(v.number()),
		terms_version: v.optional(v.string()),
		created_at: v.number(),
		updated_at: v.number(),
		converted_at: v.optional(v.number()),
		released_at: v.optional(v.number()),
		release_reason: v.optional(v.string()),
		purge_at: v.optional(v.number()),
		retain_until: v.optional(v.number()),
		box_id: v.optional(v.id("boxes"))
	})
		.index("slug_status", ["slug", "status"])
		.index("status_expires", ["status", "polar_checkout_expires_at"])
		.index("status_created_at", ["status", "created_at"])
		.index("polar_checkout_id", ["polar_checkout_id"])
		.index("user_id", ["user_id"])
		.index("user_id_status", ["user_id", "status"])
		.index("user_id_slug_status", ["user_id", "slug", "status"])
		.index("box_id", ["box_id"])
		.index("purge_at", ["purge_at"])
		.index("created_at", ["created_at"]),

	boxes: defineTable({
		user_id: v.string(),
		slug: v.string(),
		status: vBoxStatus,
		// Which plan this box was bought on - the machine it gets and the snapshot
		// allowance it comes with. Fixed for the life of the box: nothing moves a
		// box between plans, so this is written once at creation and only ever read
		// afterwards.
		plan: vBoxPlan,
		// How much of the plan's snapshot allowance is set aside for snapshots the
		// owner takes themselves. The automatic half is the remainder, never stored,
		// so the two cannot drift apart or sum to more than the plan sells. Always
		// zero on a plan without manual snapshots. Read through
		// `resolveSnapshotSplit`, never directly.
		manual_snapshot_cap: v.number(),
		// A box is backed by EITHER a paid Polar subscription (these two set) OR a
		// staff comp (comped_at set, these absent). Never both, never neither. The
		// subscription-coupled paths (reconciliation, revoke, account deletion,
		// billing views) branch on which is present.
		polar_customer_id: v.optional(v.string()),
		polar_subscription_id: v.optional(v.string()),
		comped_by: v.optional(v.string()),
		comped_at: v.optional(v.number()),
		comp_reason: v.optional(v.string()),
		runtime_image: v.optional(v.string()),
		// The version label of `runtime_image`, recorded beside it so a box can say
		// what it runs without the interface asking a registry per page view. Null
		// where the registry would not tell us; the digest above is what every
		// comparison actually uses.
		runtime_version: v.optional(v.string()),
		runtime_auth_hash: v.optional(v.string()),
		// The owner's own environment variables for this box, already validated
		// against the allowlist in `boxes/runtimeConfig.ts`. Held on the row rather
		// than applied once, because every path that rewrites the box's env file
		// renders it from here - so a Reset, Repair, update, or password change
		// cannot quietly revert what the owner configured.
		runtime_config: v.optional(v.record(v.string(), v.string())),
		password_setup_pending_at: v.optional(v.number()),
		hetzner_server_id: v.optional(v.number()),
		hetzner_server_type: v.optional(vServerType),
		hetzner_location: v.optional(vServerLocation),
		hetzner_ipv4: v.optional(v.string()),
		hetzner_ipv6: v.optional(v.string()),
		dns_record_id: v.optional(v.string()),
		dns_record_aaaa_id: v.optional(v.string()),
		// Set the instant a Repair's parking volume is created and cleared only
		// after that volume is deleted, so a repair that dies mid-flight leaves a
		// recoverable pointer to the Hetzner Volume holding the box's files rather
		// than orphaning it. `parking_volume_stage` says which copy is authoritative
		// (see vParkingVolumeStage); reconciliation reclaims any volume no live box
		// still points at.
		parking_volume_id: v.optional(v.number()),
		parking_volume_stage: v.optional(vParkingVolumeStage),
		created_at: v.number(),
		updated_at: v.number(),
		ready_at: v.optional(v.number()),
		deleted_at: v.optional(v.number()),
		purge_at: v.optional(v.number())
	})
		.index("slug", ["slug"])
		.index("slug_status", ["slug", "status"])
		.index("status", ["status"])
		.index("status_purge_at", ["status", "purge_at"])
		.index("created_at", ["created_at"])
		.index("user_id", ["user_id"])
		.index("user_id_created_at", ["user_id", "created_at"])
		.index("user_id_status", ["user_id", "status"])
		.index("polar_subscription_id", ["polar_subscription_id"])
		.index("hetzner_server_id", ["hetzner_server_id"])
		.index("parking_volume_id", ["parking_volume_id"]),

	box_auth_codes: defineTable({
		box_id: v.id("boxes"),
		code_hash: v.string(),
		code_challenge: v.string(),
		redirect_uri: v.string(),
		type: vBoxAuthorizationType,
		expires_at: v.number(),
		consumed_at: v.optional(v.number()),
		created_at: v.number()
	})
		.index("code_hash", ["code_hash"])
		.index("expires_at", ["expires_at"])
		.index("box_id", ["box_id"]),

	box_auth_grants: defineTable({
		box_id: v.id("boxes"),
		token_hash: v.string(),
		expires_at: v.number(),
		consumed_at: v.optional(v.number()),
		runtime_auth_hash: v.optional(v.string()),
		created_at: v.number()
	})
		.index("token_hash", ["token_hash"])
		.index("expires_at", ["expires_at"])
		.index("box_id", ["box_id"]),

	box_operations: defineTable({
		box_id: v.id("boxes"),
		type: vBoxOperationType,
		status: vBoxOperationStatus,
		idempotency_key: v.string(),
		reserved_slug: v.optional(v.string()),
		// Who asked for this. Optional only because rows predating the column exist;
		// every new operation records one (see `startBoxOperation`).
		trigger: v.optional(vOperationTrigger),
		// The workflow carrying this operation out, recorded in the same transaction
		// that creates the row. It is what lets `boxOperationSweep` ask whether an
		// operation still has anything running behind it, instead of guessing from
		// how long it has been open. Absent on rows predating the column.
		workflow_id: v.optional(v.string()),
		started_at: v.optional(v.number()),
		finished_at: v.optional(v.number()),
		last_error: v.optional(v.string()),
		dismissed_at: v.optional(v.number()),
		dismissed_by: v.optional(v.string()),
		metadata: vMetadata,
		created_at: v.number(),
		updated_at: v.number()
	})
		.index("box_id", ["box_id"])
		.index("box_id_status", ["box_id", "status"])
		.index("box_id_created_at", ["box_id", "created_at"])
		.index("box_type_status", ["box_id", "type", "status"])
		.index("box_id_type_created_at", ["box_id", "type", "created_at"])
		.index("status_created_at", ["status", "created_at"])
		.index("status_dismissed_created_at", [
			"status",
			"dismissed_at",
			"created_at"
		])
		.index("idempotency_key", ["idempotency_key"])
		.index("idempotency_key_status", ["idempotency_key", "status"])
		.index("reserved_slug_status", ["reserved_slug", "status"]),

	box_events: defineTable({
		box_id: v.id("boxes"),
		user_id: v.string(),
		type: v.string(),
		message: v.optional(v.string()),
		metadata: vMetadata,
		created_at: v.number()
	})
		.index("box_id", ["box_id"])
		.index("box_id_created_at", ["box_id", "created_at"])
		.index("user_id", ["user_id"])
		.index("type", ["type"]),

	// One row per box, tracking whether it is answering. Only the running count
	// matters: automatic repair fires on a box that has been unreachable for
	// several consecutive checks, so a single number and the last time it was fine
	// is the whole state. Deliberately not an event stream - the cost of this has
	// to stay flat in the number of boxes, not grow with how long they run.
	box_health: defineTable({
		box_id: v.id("boxes"),
		consecutive_failures: v.number(),
		last_ok_at: v.optional(v.number()),
		updated_at: v.number()
	}).index("box_id", ["box_id"]),

	box_metrics: defineTable({
		box_id: v.id("boxes"),
		sampled_at: v.number(),
		cpu_percent: v.number(),
		ingress_bps: v.number(),
		egress_bps: v.number(),
		ingress_pps: v.number(),
		egress_pps: v.number(),
		disk_read_bps: v.number(),
		disk_write_bps: v.number()
	})
		.index("box_id_sampled_at", ["box_id", "sampled_at"])
		.index("sampled_at", ["sampled_at"]),

	box_metrics_hourly: defineTable({
		box_id: v.id("boxes"),
		hour_start: v.number(),
		sample_count: v.number(),
		cpu_percent: v.number(),
		ingress_bps: v.number(),
		egress_bps: v.number(),
		ingress_pps: v.number(),
		egress_pps: v.number(),
		disk_read_bps: v.number(),
		disk_write_bps: v.number()
	})
		.index("box_id_hour_start", ["box_id", "hour_start"])
		.index("hour_start_cpu_percent", ["hour_start", "cpu_percent"])
		.index("hour_start_ingress_bps", ["hour_start", "ingress_bps"])
		.index("hour_start_egress_bps", ["hour_start", "egress_bps"])
		.index("hour_start_ingress_pps", ["hour_start", "ingress_pps"])
		.index("hour_start_egress_pps", ["hour_start", "egress_pps"])
		.index("hour_start_disk_read_bps", ["hour_start", "disk_read_bps"])
		.index("hour_start_disk_write_bps", ["hour_start", "disk_write_bps"])
		.index("hour_start", ["hour_start"]),

	box_flags: defineTable({
		box_id: v.id("boxes"),
		signal: vBoxFlagSignal,
		message: v.string(),
		value: v.number(),
		threshold: v.number(),
		auto_suspended: v.boolean(),
		dismissed_at: v.optional(v.number()),
		dismissed_by: v.optional(v.string()),
		created_at: v.number()
	})
		.index("box_id", ["box_id"])
		.index("box_id_signal", ["box_id", "signal"])
		.index("dismissed_created_at", ["dismissed_at", "created_at"])
		.index("box_id_dismissed_created_at", [
			"box_id",
			"dismissed_at",
			"created_at"
		]),

	box_snapshots: defineTable({
		box_id: v.id("boxes"),
		user_id: v.string(),
		hetzner_image_id: v.optional(v.number()),
		hetzner_action_id: v.optional(v.number()),
		class: vSnapshotClass,
		status: vSnapshotStatus,
		size_bytes: v.optional(v.number()),
		error: v.optional(v.string()),
		created_at: v.number(),
		completed_at: v.optional(v.number()),
		expires_at: v.optional(v.number())
	})
		.index("box_id", ["box_id"])
		.index("box_id_created_at", ["box_id", "created_at"])
		.index("box_id_status", ["box_id", "status"])
		.index("box_id_class_status_created_at", [
			"box_id",
			"class",
			"status",
			"created_at"
		])
		.index("status", ["status"])
		.index("status_expires_at", ["status", "expires_at"])
		.index("expires_at", ["expires_at"])
		.index("hetzner_image_id", ["hetzner_image_id"]),

	staff_alerts: defineTable({
		key: v.string(),
		severity: vStaffAlertSeverity,
		subject: v.string(),
		text: v.string(),
		queue_status: vStaffAlertQueueStatus,
		recipient_count: v.number(),
		email_id: v.optional(v.string()),
		last_email_event: v.optional(v.string()),
		delivery_error: v.optional(v.string()),
		created_at: v.number(),
		updated_at: v.number(),
		purge_at: v.number()
	})
		.index("key", ["key"])
		.index("queue_status_created_at", ["queue_status", "created_at"])
		.index("email_id", ["email_id"])
		.index("purge_at", ["purge_at"])
		.index("created_at", ["created_at"]),

	settings: defineTable({
		key: v.literal("global"),
		checkout_enabled: v.boolean(),
		hetzner_server_limit: v.optional(v.number()),
		hetzner_snapshot_limit: v.optional(v.number()),
		auto_suspend_enabled: v.optional(v.boolean()),
		max_active_checkout_intents_per_user: v.optional(v.number()),
		thresholds: v.optional(v.array(vThreshold)),
		snapshot_policy: v.optional(vSnapshotPolicy),
		runtime_release: v.optional(vRuntimeRelease),
		// The floor below which a box is not allowed to stay: a digest, plus the
		// moment owners of older boxes stop being asked and start being updated.
		// Absent means no floor - every update is the owner's choice.
		minimum_runtime_image: v.optional(v.string()),
		minimum_runtime_version: v.optional(v.string()),
		minimum_runtime_deadline: v.optional(v.number()),
		capacity_alert_reason: v.optional(
			v.union(v.literal("server_limit"), v.literal("snapshot_limit"))
		),
		capacity_alert_started_at: v.optional(v.number()),
		updated_at: v.number(),
		updated_by: v.optional(v.string())
	}).index("key", ["key"])
});
