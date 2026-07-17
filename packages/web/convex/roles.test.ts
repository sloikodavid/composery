import { describe, expect, it } from "vitest";
import {
	ROLE_CAPABILITIES,
	roleHasCapability,
	rolesWithCapability
} from "./roles";

describe("role capabilities", () => {
	it("gives customers no staff powers", () => {
		expect(ROLE_CAPABILITIES.user).toEqual([]);
		expect(roleHasCapability("user", "staff_console")).toBe(false);
	});

	it("makes the current admin role explicitly fully privileged", () => {
		expect(roleHasCapability("admin", "staff_console")).toBe(true);
		expect(roleHasCapability("admin", "box_operations")).toBe(true);
		expect(roleHasCapability("admin", "user_moderation")).toBe(true);
		expect(roleHasCapability("admin", "settings_management")).toBe(true);
		expect(roleHasCapability("admin", "checkout_management")).toBe(true);
		expect(roleHasCapability("admin", "staff_alerts")).toBe(true);
	});

	it("derives alert recipients from explicit role capabilities", () => {
		expect(rolesWithCapability("staff_alerts")).toEqual(["admin"]);
	});
});
