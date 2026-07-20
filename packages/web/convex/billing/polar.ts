import { Polar } from "@convex-dev/polar";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { requiredEnv } from "../env";
import type { BoxBillingInterval } from "../../lib/box-billing";

const POLAR_API_HOSTS = {
	production: "https://api.polar.sh",
	sandbox: "https://sandbox-api.polar.sh"
} as const;

type PolarOrder = {
	refundable_amount: number;
};

type PolarRefundStatus = "pending" | "succeeded" | "failed" | "canceled";

type PolarRefund = {
	amount: number;
	metadata: Record<string, unknown>;
	status: PolarRefundStatus;
};

const REFUND_IDEMPOTENCY_METADATA_KEY = "composery_refund_key";

const BOX_PRODUCT_ENV = {
	month: "POLAR_BOX_MONTHLY_PRODUCT_ID",
	year: "POLAR_BOX_ANNUAL_PRODUCT_ID"
} as const satisfies Record<BoxBillingInterval, string>;

export function boxProductId(billingInterval: BoxBillingInterval) {
	return requiredEnv(BOX_PRODUCT_ENV[billingInterval]);
}

export function boxProductIds(billingInterval: BoxBillingInterval) {
	const otherInterval = billingInterval === "year" ? "month" : "year";
	return [boxProductId(billingInterval), boxProductId(otherInterval)];
}

export function isBoxProductId(productId: string | null | undefined) {
	if (!productId) return false;
	return Object.values(BOX_PRODUCT_ENV).some(
		(environmentVariable) => requiredEnv(environmentVariable) === productId
	);
}

export async function selectPolarCheckoutProduct(
	checkoutId: string,
	productId: string
) {
	await polarApi(`/v1/checkouts/${encodeURIComponent(checkoutId)}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ product_id: productId })
	});
}

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

function polarApiUrl(path: string) {
	return `${POLAR_API_HOSTS[polarEnvironment()]}${path}`;
}

async function polarApi(path: string, init: RequestInit = {}) {
	const response = await fetch(polarApiUrl(path), {
		...init,
		headers: {
			Authorization: `Bearer ${requiredEnv("POLAR_ORGANIZATION_TOKEN")}`,
			...init.headers
		}
	});
	if (response.ok) return response;

	const body = await response.text().catch(() => "");
	throw new Error(
		`Polar API ${init.method ?? "GET"} ${path} failed: ${response.status} ${body}`
	);
}

export async function getPolarOrder(orderId: string): Promise<PolarOrder> {
	const response = await polarApi(`/v1/orders/${encodeURIComponent(orderId)}`);
	const order = (await response.json()) as Partial<PolarOrder>;
	if (
		typeof order.refundable_amount !== "number" ||
		!Number.isInteger(order.refundable_amount) ||
		order.refundable_amount < 0
	) {
		throw new Error(`Polar order ${orderId} has an invalid refundable amount.`);
	}
	return { refundable_amount: order.refundable_amount };
}

export async function refundPolarOrder({
	amount,
	comment,
	idempotencyKey,
	orderId,
	reason
}: {
	amount: number;
	comment: string;
	idempotencyKey: string;
	orderId: string;
	reason: "customer_request" | "other" | "service_disruption";
}) {
	if (!Number.isInteger(amount) || amount < 1) {
		throw new Error("Polar refunds must be a positive whole number of cents.");
	}

	const listResponse = await polarApi(
		`/v1/refunds/?order_id=${encodeURIComponent(orderId)}&limit=100&sorting=-created_at`
	);
	const list = (await listResponse.json()) as {
		items?: Partial<PolarRefund>[];
	};
	const existing = list.items?.find(
		(refund) =>
			refund.metadata?.[REFUND_IDEMPOTENCY_METADATA_KEY] === idempotencyKey &&
			(refund.status === "pending" || refund.status === "succeeded")
	);
	if (existing?.status) return existing.status;

	const response = await polarApi("/v1/refunds/", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			amount,
			comment,
			metadata: { [REFUND_IDEMPOTENCY_METADATA_KEY]: idempotencyKey },
			order_id: orderId,
			reason
		})
	});
	const refund = (await response.json()) as Partial<PolarRefund>;
	if (
		refund.status !== "pending" &&
		refund.status !== "succeeded" &&
		refund.status !== "failed" &&
		refund.status !== "canceled"
	) {
		throw new Error(`Polar refund for order ${orderId} has no valid status.`);
	}
	return refund.status;
}

// A paid subscription and its order are separate Polar resources: revoking
// stops access but does not refund, while refunding does not stop access. Always
// do both for a sale Composery cannot fulfill. Retrying is safe because revoke
// is idempotent and refundPolarOrder recognizes the stable metadata key.
export async function revokeAndRefundPolarOrder({
	comment,
	idempotencyKey,
	orderId,
	reason = "service_disruption",
	subscriptionId
}: {
	comment: string;
	idempotencyKey: string;
	orderId: string;
	reason?: "other" | "service_disruption";
	subscriptionId: string;
}) {
	await revokePolarSubscription(subscriptionId);

	const order = await getPolarOrder(orderId);
	if (order.refundable_amount === 0) return;

	const status = await refundPolarOrder({
		amount: order.refundable_amount,
		comment,
		idempotencyKey,
		orderId,
		reason
	});
	if (status !== "succeeded") {
		throw new Error(`Polar refund for order ${orderId} is ${status}.`);
	}
}

export const revokeAndRefundOrder = internalAction({
	args: {
		comment: v.string(),
		idempotencyKey: v.string(),
		orderId: v.string(),
		reason: v.optional(
			v.union(v.literal("other"), v.literal("service_disruption"))
		),
		subscriptionId: v.string()
	},
	handler: async (_ctx, args) => {
		await revokeAndRefundPolarOrder(args);
	}
});

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
			boxMonthly: process.env.POLAR_BOX_MONTHLY_PRODUCT_ID ?? "",
			boxAnnual: process.env.POLAR_BOX_ANNUAL_PRODUCT_ID ?? ""
		},
		organizationToken: process.env.POLAR_ORGANIZATION_TOKEN ?? "",
		webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? "",
		server: polarEnvironment(),
		getUserInfo: async () => {
			throw new Error("Use explicit Composery Cloud Polar calls.");
		}
	});
}
