import { describe, expect, test } from "vitest";
import { clerkAppearance, signInAppearance } from "@/lib/clerk-appearance";

describe("Clerk appearance", () => {
	test("keeps transparent card styling local to the embedded sign-in flow", () => {
		expect(signInAppearance.options.elevation).toBe("flush");
		// `!`: without it Clerk's viewport-based width overflows the page padding.
		expect(signInAppearance.elements.rootBox).toBe("w-full!");
		expect(signInAppearance.elements.cardBox).toBe("w-full!");

		expect(clerkAppearance.elements).not.toHaveProperty("rootBox");
		expect(clerkAppearance.elements).not.toHaveProperty("cardBox");
		expect(clerkAppearance.elements).not.toHaveProperty("card");
		expect(clerkAppearance.elements).not.toHaveProperty("footer");
		expect(clerkAppearance.elements).not.toHaveProperty("modalContent");
	});
});
