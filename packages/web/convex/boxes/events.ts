import type { Doc } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";

type WriteDbCtx = { db: DatabaseWriter };

export async function appendBoxEvent(
	ctx: WriteDbCtx,
	box: Pick<Doc<"boxes">, "_id" | "user_id">,
	type: string,
	input?: { message?: string; metadata?: Record<string, unknown> }
) {
	await ctx.db.insert("box_events", {
		box_id: box._id,
		user_id: box.user_id,
		type,
		message: input?.message,
		metadata: input?.metadata,
		created_at: Date.now()
	});
}
