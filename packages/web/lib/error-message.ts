import { ConvexError } from "convex/values";

// A ConvexError carrying a title and a detail is one a page may also draw as a
// card (see `convex/users.ts` -> AccountBlock). Reading them here is what keeps
// a toast from showing the JSON of an error that already has words in it.
function stringFromConvexData(data: unknown) {
	if (typeof data === "string") return data;
	if (data && typeof data === "object") {
		const { detail, title } = data as { detail?: unknown; title?: unknown };
		if (typeof title === "string" && typeof detail === "string") {
			return `${title}. ${detail}`;
		}
	}
	try {
		return JSON.stringify(data) ?? "Something went wrong.";
	} catch {
		return "Something went wrong.";
	}
}

export function errorMessage(error: unknown) {
	if (error instanceof ConvexError) {
		return stringFromConvexData(error.data);
	}

	if (error instanceof Error) return error.message;
	return String(error);
}
