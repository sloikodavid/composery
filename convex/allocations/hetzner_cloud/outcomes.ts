import { type Infer, v } from "convex/values";
import { failureClass } from "../retries";
import { hetznerCloudServerState } from "./observation";
import { hetznerCloudResourceKind, hetznerCloudSpec } from "./schema";

export const hetznerCloudFailure = v.object({
	error: v.string(),
	class: failureClass,
	hetznerErrorCode: v.optional(v.string()),
	retryAfterMs: v.optional(v.number()),
});

/** One pass reports one transition; combinations are defined only where the provider produces them. */
export const hetznerCloudOutcome = v.union(
	v.object({ kind: v.literal("waiting") }),
	v.object({ kind: v.literal("firewallFound"), id: v.number() }),
	v.object({ kind: v.literal("specResolved"), spec: hetznerCloudSpec }),
	v.object({
		kind: v.literal("resourceFound"),
		resource: hetznerCloudResourceKind,
		id: v.number(),
		address: v.optional(v.string()),
		actionId: v.union(v.number(), v.null()),
	}),
	v.object({
		kind: v.literal("resourceAbsent"),
		resource: hetznerCloudResourceKind,
		id: v.optional(v.number()),
	}),
	v.object({
		kind: v.literal("createRejected"),
		resource: hetznerCloudResourceKind,
		failure: hetznerCloudFailure,
	}),
	v.object({ kind: v.literal("actionStarted"), id: v.number() }),
	v.object({ kind: v.literal("actionFinished") }),
	v.object({ kind: v.literal("actionFailed"), failure: hetznerCloudFailure }),
	v.object({ kind: v.literal("observed"), server: hetznerCloudServerState }),
	v.object({ kind: v.literal("failed"), failure: hetznerCloudFailure }),
	v.object({ kind: v.literal("serverMissing"), failure: hetznerCloudFailure }),
	v.object({ kind: v.literal("deadlinePassed"), failure: hetznerCloudFailure }),
	v.object({ kind: v.literal("deleted") }),
);

export type HetznerCloudFailure = Infer<typeof hetznerCloudFailure>;
export type HetznerCloudOutcome = Infer<typeof hetznerCloudOutcome>;
