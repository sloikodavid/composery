import { type Infer, v } from "convex/values";

/** Platform authority only. These flags do not restrict direct SSH sessions. */
export const serverPermissions = v.object({
	rename: v.boolean(),
	power: v.boolean(),
	manageMembers: v.boolean(),
	manageSsh: v.boolean(),
	delete: v.boolean(),
});

export type ServerPermissions = Infer<typeof serverPermissions>;
export type ServerPermission = keyof ServerPermissions;

export const allServerPermissions: Readonly<ServerPermissions> = Object.freeze({
	rename: true,
	power: true,
	manageMembers: true,
	manageSsh: true,
	delete: true,
});

/** A delegate cannot grant or remove authority outside their own permissions. */
export function includesPermissions(
	available: Readonly<ServerPermissions>,
	requested: Readonly<ServerPermissions>,
) {
	return Object.entries(requested).every(
		([key, enabled]) => !enabled || available[key as ServerPermission],
	);
}
