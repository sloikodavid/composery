import { type Infer, v } from "convex/values";

/**
 * An expected failure. A function returns it instead of throwing, because a
 * thrown error rolls back the rate limit attempts that the function counted.
 */
export const failure = v.object({
	ok: v.literal(false),
	field: v.union(v.string(), v.null()),
	message: v.string(),
});

export type Failure = Infer<typeof failure>;

export function fail(field: string | null, message: string): Failure {
	return { ok: false, field, message };
}
