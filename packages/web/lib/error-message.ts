import { ConvexError } from "convex/values";

function stringFromConvexData(data: unknown) {
	if (typeof data === "string") return data;
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
