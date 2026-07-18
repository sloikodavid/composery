import { describe, expect, it } from "vitest";
import { clerkAppearance, signInAppearance } from "./clerk-appearance";

describe("Clerk appearance", () => {
	it("keeps transparent card styling local to the embedded sign-in flow", () => {
		expect(signInAppearance.options.elevation).toBe("flush");
		expect(signInAppearance.elements.rootBox).toBe("w-full");
		expect(signInAppearance.elements.cardBox).toBe("w-full");

		expect(clerkAppearance.elements).not.toHaveProperty("rootBox");
		expect(clerkAppearance.elements).not.toHaveProperty("cardBox");
		expect(clerkAppearance.elements).not.toHaveProperty("card");
		expect(clerkAppearance.elements).not.toHaveProperty("footer");
		expect(clerkAppearance.elements).not.toHaveProperty("modalContent");
	});
});
