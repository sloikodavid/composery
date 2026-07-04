type BoxDeletionStatus = {
	polar_subscription_id: string;
	status: string;
};

export function deletionIdempotencyKey(subscriptionId: string) {
	return `delete:${subscriptionId}`;
}

export function accountDeletionBoxTargets<T extends BoxDeletionStatus>(
	boxes: readonly T[]
) {
	return boxes.filter((box) => box.status !== "deleted");
}

export function accountDeletionReady(boxes: readonly BoxDeletionStatus[]) {
	return boxes.every((box) => box.status === "deleted");
}

export function scrubbedAccountEmail(userId: string) {
	return `deleted-user-${userId.replace(/[^a-zA-Z0-9_-]/g, "-")}@deleted.invalid`;
}
