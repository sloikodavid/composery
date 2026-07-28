import { beforeEach, describe, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({
	alert: vi.fn(),
	openURL: vi.fn()
}));

vi.mock("react-native", () => ({
	Alert: { alert: native.alert },
	Linking: { openURL: native.openURL }
}));

// The import must follow the hoisted native mock so this pure unit test never
// initializes the real React Native runtime.
// eslint-disable-next-line import/first
import { openExternalUrl } from "@/lib/open-url";

beforeEach(() => vi.clearAllMocks());

describe("openExternalUrl", () => {
	test("opens the address without an error alert", async () => {
		native.openURL.mockResolvedValueOnce(undefined);

		await openExternalUrl("https://example.com");

		expect(native.openURL).toHaveBeenCalledWith("https://example.com");
		expect(native.alert).not.toHaveBeenCalled();
	});

	test("reports an OS refusal instead of silently swallowing it", async () => {
		native.openURL.mockRejectedValueOnce(new Error("no handler"));

		await openExternalUrl("mailto:test@example.com");

		expect(native.alert).toHaveBeenCalledWith(
			"Couldn't open link",
			"No app on this device could open that address."
		);
	});
});
