import { defineSchema, defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

export const vUserRole = v.union(v.literal("user"), v.literal("admin"));

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

export const vBoxBeginStatus = v.union(
	v.literal("provisioning"),
	v.literal("stopping"),
	v.literal("starting"),
	v.literal("resetting"),
	v.literal("restoring"),
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
	v.literal("snapshot")
);

export const vBoxOperationStatus = v.union(
	v.literal("pending"),
	v.literal("running"),
	v.literal("succeeded"),
	v.literal("failed")
);

export type BoxOperationType = Infer<typeof vBoxOperationType>;
export type BoxOperationStatus = Infer<typeof vBoxOperationStatus>;

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

const vMetadata = v.optional(v.record(v.string(), v.any()));

export default defineSchema({
	users: defineTable({
		clerk_user_id: v.string(),
		email: v.string(),
		role: vUserRole,
		suspended: v.boolean(),
		suspended_reason: v.optional(v.string()),
		suspended_at: v.optional(v.number()),
		created_at: v.number(),
		updated_at: v.number()
	})
		.index("clerk_user_id", ["clerk_user_id"])
		.index("email", ["email"])
		.index("role", ["role"])
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
		runtime_auth_hash: v.string(),
		created_at: v.number(),
		updated_at: v.number(),
		converted_at: v.optional(v.number()),
		released_at: v.optional(v.number()),
		release_reason: v.optional(v.string()),
		box_id: v.optional(v.id("boxes"))
	})
		.index("slug_status", ["slug", "status"])
		.index("status_expires", ["status", "polar_checkout_expires_at"])
		.index("status_created_at", ["status", "created_at"])
		.index("polar_checkout_id", ["polar_checkout_id"])
		.index("user_id", ["user_id"])
		.index("user_id_slug_status", ["user_id", "slug", "status"])
		.index("box_id", ["box_id"])
		.index("created_at", ["created_at"]),

	boxes: defineTable({
		user_id: v.string(),
		slug: v.string(),
		status: vBoxStatus,
		polar_customer_id: v.string(),
		polar_subscription_id: v.string(),
		runtime_image: v.string(),
		runtime_auth_hash: v.string(),
		hetzner_server_id: v.optional(v.number()),
		hetzner_server_type: v.optional(vServerType),
		hetzner_location: v.optional(vServerLocation),
		hetzner_ipv4: v.optional(v.string()),
		hetzner_ipv4_id: v.optional(v.number()),
		hetzner_ipv6: v.optional(v.string()),
		hetzner_ipv6_id: v.optional(v.number()),
		dns_record_id: v.optional(v.string()),
		dns_record_aaaa_id: v.optional(v.string()),
		created_at: v.number(),
		updated_at: v.number(),
		provisioned_at: v.optional(v.number()),
		deleted_at: v.optional(v.number())
	})
		.index("slug", ["slug"])
		.index("slug_status", ["slug", "status"])
		.index("status", ["status"])
		.index("created_at", ["created_at"])
		.index("user_id", ["user_id"])
		.index("user_id_created_at", ["user_id", "created_at"])
		.index("user_id_status", ["user_id", "status"])
		.index("polar_subscription_id", ["polar_subscription_id"])
		.index("hetzner_server_id", ["hetzner_server_id"]),

	box_operations: defineTable({
		box_id: v.id("boxes"),
		type: vBoxOperationType,
		status: vBoxOperationStatus,
		idempotency_key: v.string(),
		reserved_slug: v.optional(v.string()),
		started_at: v.optional(v.number()),
		finished_at: v.optional(v.number()),
		last_error: v.optional(v.string()),
		metadata: vMetadata,
		created_at: v.number(),
		updated_at: v.number()
	})
		.index("box_id", ["box_id"])
		.index("box_id_status", ["box_id", "status"])
		.index("box_type_status", ["box_id", "type", "status"])
		.index("box_id_type_created_at", ["box_id", "type", "created_at"])
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
		created_at: v.number()
	})
		.index("box_id", ["box_id"])
		.index("box_id_signal", ["box_id", "signal"]),

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

	settings: defineTable({
		key: v.literal("global"),
		checkout_enabled: v.boolean(),
		auto_suspend_enabled: v.optional(v.boolean()),
		thresholds: v.optional(v.array(vThreshold)),
		snapshot_policy: v.optional(vSnapshotPolicy),
		updated_at: v.number(),
		updated_by: v.optional(v.string())
	}).index("key", ["key"])
});
