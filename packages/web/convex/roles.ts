import type { Doc } from "./_generated/dataModel";
import type { UserRole } from "./schema";

export const USER_CAPABILITIES = [
	"staff_console",
	"box_operations",
	"user_moderation",
	"settings_management",
	"checkout_management",
	// Minting a free box creates real infrastructure that costs money, so it
	// gates separately from ordinary checkout/box powers - a role can hold those
	// without being able to hand out comps.
	"box_comp",
	"staff_alerts"
] as const;

export type UserCapability = (typeof USER_CAPABILITIES)[number];

// Adding a database role makes this Record fail typechecking until its powers
// are chosen explicitly. A future role can never inherit admin access merely by
// being something other than `user`.
export const ROLE_CAPABILITIES = {
	user: [],
	admin: USER_CAPABILITIES
} as const satisfies Record<UserRole, readonly UserCapability[]>;

export function roleHasCapability(role: UserRole, capability: UserCapability) {
	return (ROLE_CAPABILITIES[role] as readonly UserCapability[]).includes(
		capability
	);
}

export function isInternalRole(role: UserRole) {
	return role !== "user";
}

export function userHasCapability(
	user: Doc<"users"> | null | undefined,
	capability: UserCapability
): user is Doc<"users"> {
	return !!user && !user.suspended && roleHasCapability(user.role, capability);
}

export function rolesWithCapability(capability: UserCapability): UserRole[] {
	return (Object.keys(ROLE_CAPABILITIES) as UserRole[]).filter((role) =>
		roleHasCapability(role, capability)
	);
}
