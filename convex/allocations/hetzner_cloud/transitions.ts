import type { Doc } from "../../_generated/dataModel";
import { toRetryDelayMs } from "../retries";
import { isAllocationDeleting } from "../schema";
import { observeHetznerCloudServer } from "./observation";
import type { HetznerCloudFailure, HetznerCloudOutcome } from "./outcomes";

/** Convex removes optional fields when their patch value is undefined. */
export type AllocationPatch<Document> = {
	[Field in keyof Document]?: undefined extends Document[Field]
		? Document[Field] | undefined
		: Document[Field];
};

export const idleAllocationDueAt = Number.MAX_SAFE_INTEGER;
const recordDelayMs = 5000;

type Transition = {
	allocation: AllocationPatch<Doc<"serverAllocations">>;
	provider: AllocationPatch<Doc<"hetznerCloudAllocations">>;
	operation?: AllocationPatch<Doc<"serverOperations">>;
};

type TransitionContext = {
	allocation: Doc<"serverAllocations">;
	provider: Doc<"hetznerCloudAllocations">;
	operation: Doc<"serverOperations">;
	now: number;
};

export function getHetznerCloudTransition(
	context: TransitionContext,
	outcome: HetznerCloudOutcome,
): Transition {
	const { allocation, provider, operation, now } = context;
	const current = allocation.operationId === operation._id;
	const clearFailure = current && operation.status !== "blocked";
	const progress: Transition = {
		allocation: clearFailure ? { failure: undefined } : {},
		provider: {
			leaseExpiresAt: 0,
			dueAt: now + recordDelayMs,
			...(clearFailure ? { hetznerErrorCode: undefined } : {}),
		},
	};
	function fail(failure: HetznerCloudFailure): Transition {
		// A result for a replaced operation may account for requests, but cannot delay or block its replacement.
		if (!current) {
			return progress;
		}
		const previous = allocation.failure;
		const count = (previous?.count ?? 0) + 1;
		return {
			allocation: {
				failure: {
					code: failure.error,
					class: failure.class,
					count,
					since: previous?.since ?? now,
				},
			},
			provider: {
				leaseExpiresAt: 0,
				hetznerErrorCode: failure.hetznerErrorCode,
				dueAt:
					now +
					Math.max(
						toRetryDelayMs(failure.class, previous?.count ?? 0),
						failure.retryAfterMs ?? 0,
					),
			},
		};
	}
	function setResource(
		resource: HetznerCloudOutcome & { resource: "ipv4" | "ipv6" | "server" },
		status: Doc<"hetznerCloudAllocations">["resources"]["server"],
	) {
		return { ...provider.resources, [resource.resource]: status };
	}
	switch (outcome.kind) {
		case "waiting":
			return progress;
		case "firewallFound":
			return {
				...progress,
				provider: { ...progress.provider, firewallId: outcome.id },
			};
		case "specResolved":
			return {
				...progress,
				provider: { ...progress.provider, spec: outcome.spec },
			};
		case "resourceFound":
			return {
				allocation: {
					...progress.allocation,
					...(outcome.resource !== "server" && outcome.address !== undefined
						? { [outcome.resource]: outcome.address }
						: {}),
				},
				provider: {
					...progress.provider,
					resources: setResource(outcome, {
						status: "present",
						id: outcome.id,
					}),
					action:
						outcome.actionId === null
							? undefined
							: { id: outcome.actionId, startedAt: now },
				},
			};
		case "resourceAbsent":
			return {
				...progress,
				provider: {
					...progress.provider,
					resources: setResource(outcome, {
						status: "absent",
						...(outcome.id === undefined ? {} : { id: outcome.id }),
					}),
					action: undefined,
				},
			};
		case "createRejected": {
			const failed = fail(outcome.failure);
			return {
				...failed,
				provider: {
					...failed.provider,
					resources: setResource(outcome, { status: "pending" }),
				},
			};
		}
		case "actionStarted":
			return {
				...progress,
				provider: {
					...progress.provider,
					action: { id: outcome.id, startedAt: now },
				},
			};
		case "actionFinished":
			return {
				...progress,
				provider: { ...progress.provider, action: undefined },
			};
		case "actionFailed": {
			const failed = fail(outcome.failure);
			return { ...failed, provider: { ...failed.provider, action: undefined } };
		}
		case "failed":
			return fail(outcome.failure);
		case "serverMissing": {
			const failed = fail(outcome.failure);
			return {
				...failed,
				allocation: {
					...failed.allocation,
					...(current
						? {
								observedAt: now,
								parts: { ...allocation.parts, server: "missing" as const },
							}
						: {}),
				},
			};
		}
		case "deadlinePassed":
			return {
				...fail(outcome.failure),
				...(current
					? { operation: { status: "blocked" as const, finishedAt: now } }
					: {}),
			};
		case "observed":
			return getObservationTransition(context, outcome.server, progress);
		case "deleted":
			return getDeletionTransition(context, progress);
	}
}

function getObservationTransition(
	context: TransitionContext,
	server: Extract<HetznerCloudOutcome, { kind: "observed" }>["server"],
	progress: Transition,
): Transition {
	const { allocation, provider, operation, now } = context;
	const current = allocation.operationId === operation._id;

	const observed = observeHetznerCloudServer(provider, server);
	if (observed === null || server.status === "changing") {
		throw new Error("A completed observation must identify a settled server.");
	}
	if (!current || isAllocationDeleting(allocation)) {
		return progress;
	}
	return {
		allocation: {
			...progress.allocation,
			failure: operation.status === "blocked" ? allocation.failure : undefined,
			status: server.status,
			observedAt: now,
			parts: observed.parts,
			ipv4: observed.addresses.ipv4,
			ipv6: observed.addresses.ipv6,
		},
		provider: { ...progress.provider, dueAt: idleAllocationDueAt },
		...(operation.status === "pending"
			? { operation: { status: "succeeded" as const, finishedAt: now } }
			: {}),
	};
}

function getDeletionTransition(
	context: TransitionContext,
	progress: Transition,
): Transition {
	const { allocation, provider, operation, now } = context;

	if (
		!isAllocationDeleting(allocation) ||
		allocation.operationId !== operation._id ||
		operation.kind !== "delete" ||
		Object.values(provider.resources).some(({ status }) => status !== "absent")
	) {
		throw new Error(
			"An allocation can finish deletion only after all resources are absent.",
		);
	}
	return {
		allocation: {
			failure: undefined,
			observedAt: now,
			ipv4: undefined,
			ipv6: undefined,
		},
		provider: { ...progress.provider, dueAt: idleAllocationDueAt },
		operation: { status: "succeeded", finishedAt: now },
	};
}
