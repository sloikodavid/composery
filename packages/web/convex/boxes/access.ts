export function ownerCanReadBox<T extends { status: string; user_id: string }>(
	box: T | null,
	userId: string
): box is T {
	return box !== null && box.user_id === userId && box.status !== "deleted";
}
