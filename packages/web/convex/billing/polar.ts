import { Polar } from "@convex-dev/polar";
import { components } from "../_generated/api";

// http.ts constructs the client at module top-level to register the webhook
// route, and Convex analyzes modules during push with no deployment env vars,
// so requiredEnv would break the deploy. These tolerant reads are safe by
// design: an empty token fails the Polar API call (401), an empty webhook
// secret makes signature verification fail closed, and "sandbox" is the
// fail-safe default (a missing config can never charge a real card).
export function polarServer() {
	const environment = process.env.POLAR_ENVIRONMENT ?? "sandbox";

	if (environment !== "sandbox" && environment !== "production") {
		throw new Error("POLAR_ENVIRONMENT must be sandbox or production.");
	}

	return new Polar(components.polar, {
		products: {
			box: process.env.POLAR_BOX_PRODUCT_ID ?? ""
		},
		organizationToken: process.env.POLAR_ORGANIZATION_TOKEN ?? "",
		webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? "",
		server: environment,
		getUserInfo: async () => {
			throw new Error("Use explicit Composery Cloud Polar calls.");
		}
	});
}
