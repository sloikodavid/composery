import { beforeEach, describe, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({
	impact: vi.fn(),
	notification: vi.fn(),
	os: "ios",
	selection: vi.fn()
}));

vi.mock("expo-haptics", () => ({
	impactAsync: native.impact,
	ImpactFeedbackStyle: { Light: "light" },
	notificationAsync: native.notification,
	NotificationFeedbackType: { Error: "error", Success: "success" },
	selectionAsync: native.selection
}));

vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return native.os;
		}
	}
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
	native.os = "ios";
});

describe("haptic feedback", () => {
	test("sends each native result through the matching haptic channel", async () => {
		const { errorFeedback, successFeedback, tapFeedback } =
			await import("@/lib/haptics");

		tapFeedback();
		successFeedback();
		errorFeedback();

		expect(native.impact).toHaveBeenCalledWith("light");
		expect(native.notification).toHaveBeenNthCalledWith(1, "success");
		expect(native.notification).toHaveBeenNthCalledWith(2, "error");
		expect(native.selection).not.toHaveBeenCalled();
	});

	test("leaves every native haptic channel untouched on web", async () => {
		native.os = "web";
		const { errorFeedback, successFeedback, tapFeedback } =
			await import("@/lib/haptics");

		tapFeedback();
		successFeedback();
		errorFeedback();

		expect(native.impact).not.toHaveBeenCalled();
		expect(native.notification).not.toHaveBeenCalled();
		expect(native.selection).not.toHaveBeenCalled();
	});
});
