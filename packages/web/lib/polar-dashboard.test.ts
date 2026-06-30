import { afterEach, describe, expect, it, vi } from "vitest";

const envNames = [
	"NEXT_PUBLIC_POLAR_ENVIRONMENT",
	"NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG"
] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));

async function loadDashboardUrls() {
	vi.resetModules();
	return await import("./polar-dashboard");
}

afterEach(() => {
	for (const name of envNames) {
		const value = previousEnv.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	vi.resetModules();
});

describe("Polar dashboard links", () => {
	it("uses the production dashboard only when production is configured", async () => {
		process.env.NEXT_PUBLIC_POLAR_ENVIRONMENT = "production";
		process.env.NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG = "composery";

		const { polarCustomerUrl, polarCustomersUrl, polarSubscriptionUrl } =
			await loadDashboardUrls();

		expect(polarCustomersUrl()).toBe(
			"https://polar.sh/dashboard/composery/customers"
		);
		expect(polarCustomerUrl("cus_123")).toBe(
			"https://polar.sh/dashboard/composery/customers/cus_123"
		);
		expect(polarSubscriptionUrl("sub_123")).toBe(
			"https://polar.sh/dashboard/composery/sales/subscriptions/sub_123"
		);
	});

	it("uses sandbox only when sandbox is configured", async () => {
		process.env.NEXT_PUBLIC_POLAR_ENVIRONMENT = "sandbox";
		process.env.NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG = "composery";

		const { polarCustomersUrl } = await loadDashboardUrls();

		expect(polarCustomersUrl()).toBe(
			"https://sandbox.polar.sh/dashboard/composery/customers"
		);
	});

	it("hides links when the environment or slug is missing", async () => {
		process.env.NEXT_PUBLIC_POLAR_ENVIRONMENT = "";
		process.env.NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG = "composery";
		expect((await loadDashboardUrls()).polarCustomersUrl()).toBeNull();

		process.env.NEXT_PUBLIC_POLAR_ENVIRONMENT = "production";
		process.env.NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG = "";
		expect((await loadDashboardUrls()).polarCustomersUrl()).toBeNull();
	});
});
