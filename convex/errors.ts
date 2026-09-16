import { ConvexError, type Infer, v } from "convex/values";

// biome-ignore-start lint/style/useNamingConvention: error codes use snake_case
const errorMessages = {
	edit_invalid: "This change cannot be written as a valid entry.",
	edit_uncertain:
		"The result of this change is unknown. Read the file again before you try once more.",
	file_changed: "This file changed since you read it. Read it again.",
	file_unwritable: "This file cannot be written on the server.",
	server_unreachable: "Composery cannot sign in to this server.",
	server_unsupported: "This server does not provide what this feature needs.",
	membership_limit_reached: "This server has reached its member limit.",
	membership_not_found: "This member no longer exists.",
	name_invalid:
		"Use 3 to 63 lowercase letters, digits, and single hyphens. Start and end with a letter or digit.",
	name_taken: "This name is taken.",
	permission_denied: "You do not have permission to do this.",
	power_unavailable: "This server cannot accept a power operation now.",
	rate_limited: "Too many attempts. Try again later.",
	request_id_conflict: "This request ID was used for a different request.",
	request_id_invalid:
		"Use a request ID with 8 to 100 letters, digits, hyphens, or underscores.",
	server_busy: "This server is busy. Try again shortly.",
	server_capacity_unavailable: "No capacity for new servers is available now.",
	server_deleted: "This server was deleted.",
	server_deleting: "This server is being deleted.",
	server_not_found: "You do not have access to this server.",
	server_quota_reached: "The account has reached its server quota.",
	unauthenticated: "Sign in to continue.",
	user_has_access: "This user already has access to this server.",
	user_not_found: "No user has this username.",
	user_not_unique:
		"More than one account has this username for a moment. Try again shortly.",
} as const;
// biome-ignore-end lint/style/useNamingConvention: error codes use snake_case

/** A code is public API. Add codes freely; never rename or remove one. */
export type ErrorCode = keyof typeof errorMessages;

const errorCodes = Object.keys(errorMessages) as ErrorCode[];

export const failure = v.object({
	ok: v.literal(false),
	code: v.union(...errorCodes.map((code) => v.literal(code))),
	field: v.union(v.string(), v.null()),
	message: v.string(),
});

export type Failure = Infer<typeof failure>;

/** Return a failure instead of throwing after a rate limit attempt was counted, because throwing rolls the attempt back. */
export function fail(code: ErrorCode, field: string | null = null): Failure {
	return { ok: false, code, field, message: errorMessages[code] };
}

export function toConvexError(code: ErrorCode) {
	return new ConvexError({ code, message: errorMessages[code] });
}
