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

export const vBoxStatus = v.union(
	v.literal("provisioning"),
	v.literal("running"),
	v.literal("provisioning_failed"),
	v.literal("stopping"),
	v.literal("stopped"),
	v.literal("starting"),
	v.literal("resetting"),
	v.literal("reset_failed"),
	v.literal("repairing"),
	v.literal("restoring"),
	v.literal("restore_failed"),
	v.literal("rebuilding"),
	v.literal("rebuild_failed"),
	v.literal("suspending"),
	v.literal("suspended"),
	v.literal("unsuspending"),
	v.literal("deleting"),
	v.literal("delete_failed"),
	v.literal("deleted")
);

export type BoxStatus = Infer<typeof vBoxStatus>;

export const vBoxBeginStatus = v.union(
	v.literal("provisioning"),
	v.literal("stopping"),
	v.literal("starting"),
	v.literal("resetting"),
	v.literal("repairing"),
	v.literal("restoring"),
	v.literal("rebuilding"),
	v.literal("suspending"),
	v.literal("suspended"),
	v.literal("unsuspending"),
	v.literal("deleting"),
	v.literal("running")
);

export const vBoxFailureStatus = v.union(
	v.literal("provisioning_failed"),
	v.literal("reset_failed"),
	v.literal("restore_failed"),
	v.literal("rebuild_failed"),
	v.literal("delete_failed"),
	v.literal("running"),
	v.literal("stopped"),
	v.literal("suspended")
);

export const vBoxOperationType = v.union(
	v.literal("provision"),
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
	v.literal("recover"),
	v.literal("rebuild")
);

export const vBoxOperationStatus = v.union(
	v.literal("pending"),
	v.literal("running"),
	v.literal("succeeded"),
	v.literal("failed")
);

export type BoxOperationType = Infer<typeof vBoxOperationType>;
export type BoxOperationStatus = Infer<typeof vBoxOperationStatus>;

// Which half of a Rebuild ("clean host, current files") a box's parking volume
// is in. It is the crash-safety marker a resumed rebuild reads to decide the
// authoritative copy of the files:
//   - "parking":   the box's server still holds the files; the volume is being
//                  filled. Safe to re-copy server -> volume and to rebuild only
//                  once that copy has verified.
//   - "restoring": the server has been (or is being) wiped and reborn; the
//                  volume now holds the only copy. The files are copied back
//                  volume -> server, and server -> volume must never run here.
// The transition parking -> restoring happens exactly once, gated on the
// copy-out verifying, so an interrupted rebuild always resumes towards keeping
// the files rather than overwriting them.
export const vParkingVolumeStage = v.union(
	v.literal("parking"),
	v.literal("restoring")
);
export type ParkingVolumeStage = Infer<typeof vParkingVolumeStage>;

export const vServerType = v.union(v.literal("cx23"), v.literal("cx33"));
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

export const vSnapshotPolicy = v.object({
	manual_cap: v.number(),
	automatic_cap: v.number(),
	manual_min_interval_minutes: v.number(),
	manual_retention_days: v.number(),
	automatic_retention_days: v.number()
});
export type StoredSnapshotPolicy = Infer<typeof vSnapshotPolicy>;

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
		runtime_auth_hash: v.optional(v.string()),
		password_setup_pending_at: v.optional(v.number()),
		hetzner_server_id: v.optional(v.number()),
		hetzner_server_type: v.optional(vServerType),
		hetzner_location: v.optional(vServerLocation),
		hetzner_ipv4: v.optional(v.string()),
		hetzner_ipv4_id: v.optional(v.number()),
		hetzner_ipv6: v.optional(v.string()),
		hetzner_ipv6_id: v.optional(v.number()),
		dns_record_id: v.optional(v.string()),
		dns_record_aaaa_id: v.optional(v.string()),
		// Set the instant a Rebuild's parking volume is created and cleared only
		// after that volume is deleted, so a rebuild that dies mid-flight leaves a
		// recoverable pointer to the Hetzner Volume holding the box's files rather
		// than orphaning it. `parking_volume_stage` says which copy is authoritative
		// (see vParkingVolumeStage); reconciliation reclaims any volume no live box
		// still points at.
		parking_volume_id: v.optional(v.number()),
		parking_volume_stage: v.optional(vParkingVolumeStage),
		created_at: v.number(),
		updated_at: v.number(),
		provisioned_at: v.optional(v.number()),
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
		capacity_alert_reason: v.optional(
			v.union(v.literal("server_limit"), v.literal("snapshot_limit"))
		),
		capacity_alert_started_at: v.optional(v.number()),
		updated_at: v.number(),
		updated_by: v.optional(v.string())
	}).index("key", ["key"])
});
