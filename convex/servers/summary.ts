import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { ServerAccess } from "./permissions";
import { serverPermissions } from "./schema";

/** What a server is to a user who may see it: its name, and what they may do with it. */
export const serverSummary = v.object({
	_id: v.id("servers"),
	name: v.string(),
	isOwner: v.boolean(),
	permissions: serverPermissions,
});

export function toServerSummary(
	server: Doc<"servers">,
	access: ServerAccess,
): Infer<typeof serverSummary> {
	return {
		_id: server._id,
		name: server.name,
		isOwner: access.isOwner,
		permissions: access.permissions,
	};
}
