function toDate(value: number | string | null | undefined) {
	return value ? new Date(value) : null;
}

function dateOptions(date: Date) {
	return {
		month: "short" as const,
		day: "numeric" as const,
		...(date.getFullYear() === new Date().getFullYear()
			? {}
			: { year: "numeric" as const })
	};
}

export function formatDate(value: number | string | null | undefined) {
	const date = toDate(value);
	return date ? date.toLocaleDateString(undefined, dateOptions(date)) : "";
}

export function formatDateTime(value: number | string | null | undefined) {
	const date = toDate(value);
	return date
		? date.toLocaleString(undefined, {
				...dateOptions(date),
				hour: "2-digit",
				minute: "2-digit"
			})
		: "";
}
