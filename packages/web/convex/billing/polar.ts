import { Polar } from "@convex-dev/polar";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { requiredEnv } from "../env";

const POLAR_API_HOSTS = {
	production: "https://api.polar.sh",
	sandbox: "https://sandbox-api.polar.sh"
} as const;

function polarEnvironment() {
	const environment = process.env.POLAR_ENVIRONMENT ?? "sandbox";
	if (environment !== "sandbox" && environment !== "production") {
		throw new Error("POLAR_ENVIRONMENT must be sandbox or production.");
	}
	return environment;
}

// Ends the subscription immediately. Idempotent: a subscription already gone
// (404) or already revoked answers success, so retrying callers never block.
export async function revokePolarSubscription(subscriptionId: string) {
	const response = await fetch(
		`${POLAR_API_HOSTS[polarEnvironment()]}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
		{
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${requiredEnv("POLAR_ORGANIZATION_TOKEN")}`
			}
		}
	);

	if (response.ok || response.status === 404) return;

	const body = await response.text().catch(() => "");
	if (body.includes("AlreadyCanceledSubscription")) return;

	throw new Error(
		`Polar subscription revoke failed for ${subscriptionId}: ${response.status} ${body}`
	);
}

export const revokeSubscription = internalAction({
	args: {
		subscriptionId: v.string()
	},
	handler: async (_ctx, args) => {
		await revokePolarSubscription(args.subscriptionId);
	}
});

// http.ts constructs the client at module top-level to register the webhook
// route, and Convex analyzes modules during push with no deployment env vars,
// so requiredEnv would break the deploy. These tolerant reads are safe by
// design: an empty token fails the Polar API call (401), an empty webhook
// secret makes signature verification fail closed, and "sandbox" is the
// fail-safe default (a missing config can never charge a real card).
export function polarServer() {
	return new Polar(components.polar, {
		products: {
			box: process.env.POLAR_BOX_PRODUCT_ID ?? ""
		},
		organizationToken: process.env.POLAR_ORGANIZATION_TOKEN ?? "",
		webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? "",
		server: polarEnvironment(),
		getUserInfo: async () => {
			throw new Error("Use explicit Composery Cloud Polar calls.");
		}
	});
}
