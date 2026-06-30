function toDate(value: number | string | null | undefined) {
	return value ? new Date(value) : null;
}

export function formatDate(value: number | string | null | undefined) {
	return (
		toDate(value)?.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric"
		}) ?? ""
	);
}

export function formatDateTime(value: number | string | null | undefined) {
	return (
		toDate(value)?.toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		}) ?? ""
	);
}
